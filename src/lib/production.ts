import type {
  Account,
  AppSettings,
  BatchConsumption,
  Bom,
  BomLine,
  JobCard,
  JobCardLine,
  JobCardOutput,
  LedgerEntry,
  Party,
  Product,
  PurchaseOrder,
  PurchaseOrderLine,
  StockBatch,
  StockMovement,
  SupplierContract,
  Voucher,
} from "./types";
import {
  consumeFifo,
  createBatchFromLine,
  reverseVoucherCosting,
} from "./accounting/costing";
import { postBalancedJournal, voidJournalOn } from "./accounting/journals";
import { ACCT } from "./accounting/seed";
import { accountBalance } from "./accounting/engine";
import {
  applyProductQtyDelta,
  deriveSecondaryQty,
  inventoryRows,
  secondaryPerBundle,
} from "./inventory";
import { roundMoney } from "./pricing";
import { resolveOpenContract } from "./contracts";
import { assertPeriodOpen } from "./accounting/controls";

export type ProductionDb = {
  products: Product[];
  boms: Bom[];
  jobCards: JobCard[];
  vouchers: Voucher[];
  ledgerEntries: LedgerEntry[];
  stockMovements: StockMovement[];
  stockBatches: StockBatch[];
  batchConsumptions: BatchConsumption[];
  accounts: Pick<Account, "id" | "type" | "openingBalance" | "active">[];
  settings: Pick<AppSettings, "lockedThroughDate">;
  parties?: Party[];
  purchaseOrders?: PurchaseOrder[];
  supplierContracts?: SupplierContract[];
};

export type JobOutputInput = {
  id?: string;
  productId: string;
  variationId?: string;
  colorId?: string;
  plannedQty: number;
  bomId?: string;
};

export function scaleBomLines(bom: Bom, plannedQty: number): JobCardLine[] {
  if (!(bom.outputQty > 0)) throw new Error("BOM output qty must be greater than zero");
  const factor = plannedQty / bom.outputQty;
  return bom.lines.map((line) => ({
    productId: line.productId,
    variationId: line.variationId,
    colorId: line.colorId,
    itemLabel: line.productId,
    qty: roundMoney(line.qty * factor),
    bundles: 0,
  }));
}

function skuKey(line: {
  productId?: string;
  variationId?: string;
  colorId?: string;
}): string {
  return `${line.productId ?? ""}|${line.variationId ?? ""}|${line.colorId ?? ""}`;
}

/** Sum identical raw SKUs (product + variation + color) onto one issue line. */
export function clubJobLines(lines: JobCardLine[]): JobCardLine[] {
  const map = new Map<string, JobCardLine>();
  for (const line of lines) {
    if (!line.productId || !(line.qty > 0)) continue;
    const key = skuKey(line);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...line, qty: roundMoney(line.qty) });
      continue;
    }
    prev.qty = roundMoney(prev.qty + line.qty);
    prev.bundles = roundMoney((prev.bundles || 0) + (line.bundles || 0));
    if (
      (!prev.itemLabel || prev.itemLabel === prev.productId) &&
      line.itemLabel &&
      line.itemLabel !== line.productId
    ) {
      prev.itemLabel = line.itemLabel;
    }
  }
  return [...map.values()];
}

/** Finished lines, synthesizing one from the legacy single-output fields. */
export function jobCardOutputs(job: JobCard): JobCardOutput[] {
  if (job.outputs?.length) return job.outputs;
  return [
    {
      id: `${job.id}_out`,
      productId: job.outputProductId,
      variationId: job.outputVariationId,
      colorId: job.outputColorId,
      itemLabel: job.outputProductId,
      plannedQty: job.plannedQty,
      actualQty: job.actualQty,
      bomId: job.bomId,
    },
  ];
}

function mirrorLegacyOutput(job: JobCard): void {
  const first = job.outputs?.[0];
  if (!first) return;
  job.outputProductId = first.productId;
  job.outputVariationId = first.variationId;
  job.outputColorId = first.colorId;
  job.plannedQty = first.plannedQty;
  job.bomId = first.bomId || job.bomId;
  job.actualQty = first.actualQty;
}

function outputLabel(
  db: ProductionDb,
  productId: string,
  variationId?: string
): string {
  const product = db.products.find((p) => p.id === productId);
  if (!product) throw new Error("Finished product not found");
  const variation = variationId
    ? product.variations.find((v) => v.id === variationId)
    : undefined;
  return [product.name.en, variation?.label.en].filter(Boolean).join(" · ");
}

export function onHandSecondary(
  db: { products: Product[] },
  line: { productId: string; variationId?: string; colorId?: string }
): number {
  const row = inventoryRows({ products: db.products, stockMovements: [] }).find(
    (r) => skuKey(r) === skuKey(line)
  );
  if (row) return row.stockSecondary;
  const product = db.products.find((p) => p.id === line.productId);
  return product?.stockSecondary ?? 0;
}

function fillLineLabels(
  db: ProductionDb,
  lines: JobCardLine[]
): JobCardLine[] {
  return lines.map((line) => {
    const product = db.products.find((p) => p.id === line.productId);
    if (!product) throw new Error("BOM input product not found");
    const per = secondaryPerBundle(product, line.variationId) || 1;
    const qty = line.qty;
    const bundles =
      line.bundles > 0 ? line.bundles : roundMoney(qty / per) || (qty > 0 ? 1 : 0);
    const variation = line.variationId
      ? product.variations.find((v) => v.id === line.variationId)
      : undefined;
    return {
      ...line,
      itemLabel:
        line.itemLabel && line.itemLabel !== line.productId
          ? line.itemLabel
          : [product.name.en, variation?.label.en].filter(Boolean).join(" · "),
      qty,
      bundles,
    };
  });
}

function nextJobNumber(jobs: JobCard[]): string {
  let max = 1000;
  for (const j of jobs) {
    const n = Number(j.number.replace(/\D/g, ""));
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `JC-${max + 1}`;
}

function moveStock(
  db: ProductionDb,
  line: JobCardLine,
  direction: "in" | "out",
  date: string,
  createdBy: string,
  note: string
): void {
  const product = db.products.find((p) => p.id === line.productId);
  if (!product) throw new Error(`Product not found for ${line.itemLabel}`);
  const bundles = line.bundles > 0 ? line.bundles : 1;
  const secondary = deriveSecondaryQty(
    product,
    bundles,
    line.variationId,
    line.qty
  );
  const signedB = direction === "in" ? bundles : -bundles;
  const signedS = direction === "in" ? secondary : -secondary;
  applyProductQtyDelta(
    product,
    line.variationId,
    line.colorId,
    signedB,
    signedS,
    { strict: direction === "out" }
  );
  product.updatedAt = new Date().toISOString();
  db.stockMovements.unshift({
    id: `sm_${crypto.randomUUID()}`,
    date: date.slice(0, 10),
    type: "production",
    productId: line.productId,
    variationId: line.variationId,
    colorId: line.colorId,
    qty: bundles,
    secondaryQty: secondary,
    unit: product.unit,
    direction,
    note,
    createdAt: new Date().toISOString(),
    createdBy,
  });
}

export function upsertBomOn(
  db: ProductionDb,
  input: {
    id?: string;
    outputProductId: string;
    outputVariationId?: string;
    outputColorId?: string;
    outputQty: number;
    lines: Omit<BomLine, "id">[];
    createdBy: string;
    active?: boolean;
  }
): Bom {
  if (!(input.outputQty > 0)) throw new Error("Output qty must be greater than zero");
  const cleaned = input.lines.filter((l) => l.productId && l.qty > 0);
  if (!cleaned.length) throw new Error("Add at least one input");
  const now = new Date().toISOString();
  const existingSameOutput = input.id
    ? undefined
    : db.boms.find(
        (b) =>
          b.active &&
          b.outputProductId === input.outputProductId &&
          (b.outputVariationId || "") === (input.outputVariationId || "") &&
          (b.outputColorId || "") === (input.outputColorId || "")
      );
  const bom: Bom = {
    id: input.id || existingSameOutput?.id || `bom_${crypto.randomUUID()}`,
    outputProductId: input.outputProductId,
    outputVariationId: input.outputVariationId,
    outputColorId: input.outputColorId,
    outputQty: roundMoney(input.outputQty),
    lines: cleaned.map((l) => ({
      id: `bl_${crypto.randomUUID()}`,
      productId: l.productId,
      variationId: l.variationId,
      colorId: l.colorId,
      qty: roundMoney(l.qty),
    })),
    active: input.active !== false,
    createdAt: now,
    createdBy: input.createdBy,
  };
  const i = db.boms.findIndex((b) => b.id === bom.id);
  if (i >= 0) {
    bom.createdAt = db.boms[i]!.createdAt;
    db.boms[i] = bom;
  } else {
    db.boms.unshift(bom);
  }
  return bom;
}

function explodeOutputs(
  db: ProductionDb,
  outputs: JobOutputInput[]
): JobCardLine[] {
  const raw: JobCardLine[] = [];
  for (const output of outputs) {
    if (!output.bomId || !(output.plannedQty > 0)) continue;
    const bom = db.boms.find((b) => b.id === output.bomId && b.active);
    if (!bom) throw new Error("BOM not found");
    raw.push(...scaleBomLines(bom, output.plannedQty));
  }
  return raw;
}

export function createJobCardOn(
  db: ProductionDb,
  input: {
    date: string;
    createdBy: string;
    bomId?: string;
    outputProductId?: string;
    outputVariationId?: string;
    outputColorId?: string;
    plannedQty?: number;
    inputLines?: Omit<JobCardLine, "itemLabel">[];
    outputs?: JobOutputInput[];
  }
): JobCard {
  assertPeriodOpen(input.date, db.settings);
  const explicitOutputs = (input.outputs ?? []).filter(
    (o) => o.productId && o.plannedQty > 0
  );
  const outputs: JobOutputInput[] = explicitOutputs.length
    ? explicitOutputs
    : [
        {
          productId: input.outputProductId || "",
          variationId: input.outputVariationId,
          colorId: input.outputColorId,
          plannedQty: input.plannedQty || 0,
          bomId: input.bomId,
        },
      ];
  if (!outputs.some((o) => o.productId && o.plannedQty > 0)) {
    throw new Error("Planned qty must be greater than zero");
  }

  const manual = (input.inputLines ?? []).filter((l) => l.productId && l.qty > 0);
  let raw: JobCardLine[];
  if (explicitOutputs.length && manual.length) {
    raw = manual.map((l) => ({ ...l, itemLabel: l.productId, bundles: l.bundles || 0 }));
  } else if (explicitOutputs.length) {
    raw = explodeOutputs(db, outputs);
  } else if (input.bomId) {
    const bom = db.boms.find((b) => b.id === input.bomId && b.active);
    if (!bom) throw new Error("BOM not found");
    raw = scaleBomLines(bom, input.plannedQty || 0);
  } else if (manual.length) {
    raw = manual.map((l) => ({ ...l, itemLabel: l.productId, bundles: l.bundles || 0 }));
  } else {
    raw = [];
  }
  if (!raw.length) throw new Error("Pick a BOM or enter input lines");
  const lines = fillLineLabels(db, clubJobLines(raw));

  const finished: JobCardOutput[] = outputs
    .filter((o) => o.productId && o.plannedQty > 0)
    .map((o) => ({
      id: o.id || `jo_${crypto.randomUUID()}`,
      productId: o.productId,
      variationId: o.variationId,
      colorId: o.colorId,
      itemLabel: outputLabel(db, o.productId, o.variationId),
      plannedQty: roundMoney(o.plannedQty),
      bomId: o.bomId,
    }));

  const job: JobCard = {
    id: `job_${crypto.randomUUID()}`,
    number: nextJobNumber(db.jobCards),
    bomId: finished[0]?.bomId,
    date: input.date.slice(0, 10),
    outputProductId: finished[0]!.productId,
    outputVariationId: finished[0]?.variationId,
    outputColorId: finished[0]?.colorId,
    plannedQty: finished[0]!.plannedQty,
    status: "draft",
    outputs: finished,
    inputLines: lines,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
  };
  db.jobCards.unshift(job);
  return job;
}

export function issueJobCardOn(db: ProductionDb, jobId: string, createdBy: string): JobCard {
  const job = db.jobCards.find((j) => j.id === jobId);
  if (!job) throw new Error("Job card not found");
  if (job.status !== "draft") throw new Error("Job is not a draft");
  assertPeriodOpen(job.date, db.settings);
  db.stockBatches = db.stockBatches || [];
  db.batchConsumptions = db.batchConsumptions || [];

  const fifoLines = job.inputLines
    .filter((l) => l.qty > 0)
    .map((l) => ({
      productId: l.productId,
      variationId: l.variationId,
      colorId: l.colorId,
      qty: l.qty,
    }));
  if (!fifoLines.length) throw new Error("Job has no inputs to issue");

  const voucherStubId = `vch_${crypto.randomUUID()}`;
  const fifo = consumeFifo(db.stockBatches, db.batchConsumptions, {
    voucherId: voucherStubId,
    date: job.date,
    lines: fifoLines,
    allowShortfall: false,
  });
  const cost = fifo.totalCost;
  if (!(cost > 0.009)) {
    throw new Error("Cannot issue — input stock has no cost (price the GRN first)");
  }

  for (const line of job.inputLines) {
    if (line.qty <= 0) continue;
    moveStock(db, line, "out", job.date, createdBy, `${job.number} issue`);
  }

  const voucher = postBalancedJournal(db, {
    date: job.date,
    narration: `Issue ${job.number}`,
    createdBy,
    linkedJobId: job.id,
    legs: [
      { accountId: ACCT.wip, debit: cost, itemLabel: `WIP ${job.number}` },
      { accountId: ACCT.inventory, credit: cost, itemLabel: `RM ${job.number}` },
    ],
  });
  for (const c of db.batchConsumptions) {
    if (c.voucherId === voucherStubId) c.voucherId = voucher.id;
  }

  job.status = "issued";
  job.issuedAt = new Date().toISOString();
  job.issuedCost = cost;
  job.issueVoucherId = voucher.id;
  return job;
}

export function completeJobCardOn(
  db: ProductionDb,
  input: {
    jobId: string;
    actualQty?: number;
    actuals?: { id?: string; actualQty: number }[];
    createdBy: string;
  }
): JobCard {
  const job = db.jobCards.find((j) => j.id === input.jobId);
  if (!job) throw new Error("Job card not found");
  if (job.status !== "issued") throw new Error("Issue materials before completing");
  assertPeriodOpen(job.date, db.settings);
  if (!job.outputs?.length) job.outputs = jobCardOutputs(job);

  const outputs = job.outputs;
  if (input.actuals?.length) {
    outputs.forEach((output, index) => {
      const match =
        input.actuals!.find((a) => a.id && a.id === output.id) ??
        input.actuals![index];
      output.actualQty = roundMoney(match?.actualQty ?? 0);
    });
  } else if (outputs.length <= 1) {
    const actual = roundMoney(input.actualQty ?? 0);
    if (!(actual >= 0)) throw new Error("Enter actual output qty");
    if (outputs[0]) outputs[0].actualQty = actual;
  } else {
    throw new Error("Enter actual qty for each finished item");
  }

  const plannedTotal = roundMoney(
    outputs.reduce((s, o) => s + (o.plannedQty || 0), 0)
  );
  const actualTotal = roundMoney(
    outputs.reduce((s, o) => s + (o.actualQty ?? 0), 0)
  );
  if (!(actualTotal >= 0)) throw new Error("Enter actual output qty");
  const issuedCost = job.issuedCost ?? 0;
  const yieldPct =
    plannedTotal > 0 ? Math.min(1, actualTotal / plannedTotal) : 1;
  const wastageCost =
    actualTotal + 0.0001 < plannedTotal
      ? roundMoney(issuedCost * (1 - yieldPct))
      : 0;
  const fgCost = roundMoney(issuedCost - wastageCost);

  const positive = outputs.filter((o) => (o.actualQty ?? 0) > 0);
  const batchIds: string[] = [];
  let allocated = 0;
  positive.forEach((output, index) => {
    const actual = output.actualQty ?? 0;
    const lineCost =
      index === positive.length - 1
        ? roundMoney(fgCost - allocated)
        : roundMoney(actualTotal > 0 ? (fgCost * actual) / actualTotal : 0);
    allocated = roundMoney(allocated + lineCost);
    const product = db.products.find((p) => p.id === output.productId);
    if (!product) throw new Error("Finished product not found");
    const per = secondaryPerBundle(product, output.variationId) || 1;
    const bundles =
      per > 0 ? roundMoney(actual / per) || 1 : actual;
    moveStock(
      db,
      {
        productId: output.productId,
        variationId: output.variationId,
        colorId: output.colorId,
        itemLabel: output.itemLabel || product.name.en,
        qty: actual,
        bundles: bundles || 1,
      },
      "in",
      job.date,
      input.createdBy,
      `${job.number} complete`
    );
    const batch = createBatchFromLine({
      date: job.date,
      productId: output.productId,
      variationId: output.variationId,
      colorId: output.colorId,
      qty: actual,
      rate: actual > 0 ? roundMoney(lineCost / actual) : 0,
      unit: product.unit,
      source: "production",
      voucherId: undefined,
      provisional: false,
    });
    db.stockBatches.push(batch);
    batchIds.push(batch.id);
  });

  const legs = [
    ...(fgCost > 0.009
      ? [
          {
            accountId: ACCT.inventory,
            debit: fgCost,
            itemLabel: `FG ${job.number}`,
          },
        ]
      : []),
    ...(wastageCost > 0.009
      ? [
          {
            accountId: ACCT.wastage,
            debit: wastageCost,
            itemLabel: `Wastage ${job.number}`,
          },
        ]
      : []),
    {
      accountId: ACCT.wip,
      credit: issuedCost,
      itemLabel: `WIP ${job.number}`,
    },
  ];
  const voucher = postBalancedJournal(db, {
    date: job.date,
    narration: `Complete ${job.number}`,
    createdBy: input.createdBy,
    linkedJobId: job.id,
    legs,
  });
  for (const id of batchIds) {
    const batch = db.stockBatches.find((b) => b.id === id);
    if (batch && !batch.voucherId) batch.voucherId = voucher.id;
  }

  job.status = "completed";
  job.completedAt = new Date().toISOString();
  mirrorLegacyOutput(job);
  job.wastageQty = roundMoney(Math.max(0, plannedTotal - actualTotal));
  job.wastageCost = wastageCost;
  job.completeVoucherId = voucher.id;
  return job;
}

export function cancelIssuedJobCardOn(
  db: ProductionDb,
  jobId: string,
  createdBy: string
): JobCard {
  const job = db.jobCards.find((j) => j.id === jobId);
  if (!job) throw new Error("Job card not found");
  if (job.status !== "issued") throw new Error("Only issued jobs can be reversed");
  if (job.completeVoucherId) throw new Error("Completed job cannot be cancelled");
  assertPeriodOpen(job.date, db.settings);

  const issueCons = (db.batchConsumptions ?? []).filter(
    (c) => c.voucherId === job.issueVoucherId
  );
  if (job.issueVoucherId && !issueCons.length) {
    throw new Error(
      "Cannot reverse issue — FIFO layers already consumed or reversed"
    );
  }
  if (job.issueVoucherId) {
    reverseVoucherCosting(
      db.stockBatches,
      db.batchConsumptions,
      job.issueVoucherId
    );
    voidJournalOn(db, job.issueVoucherId, createdBy);
  }
  for (const line of job.inputLines) {
    if (line.qty <= 0) continue;
    moveStock(db, line, "in", job.date, createdBy, `${job.number} cancel issue`);
  }
  job.status = "cancelled";
  job.cancelledAt = new Date().toISOString();
  return job;
}

export type MaterialOrderResult = {
  orders: PurchaseOrder[];
  missingSupplier: { itemLabel: string; qty: number }[];
};

function nextPoNumber(orders: PurchaseOrder[]): string {
  let max = 1000;
  for (const order of orders) {
    const n = Number(order.number.replace(/\D/g, ""));
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `PO-${max + 1}`;
}

function alreadyOrderedForJob(
  orders: PurchaseOrder[],
  jobNumber: string,
  key: string
): number {
  let qty = 0;
  for (const po of orders) {
    if (po.status === "cancelled") continue;
    if (!po.narration?.includes(jobNumber)) continue;
    for (const line of po.lines) {
      if (skuKey(line) !== key) continue;
      qty += line.secondaryQty ?? line.qty;
    }
  }
  return roundMoney(qty);
}

/** Draft purchase orders for clubbed inputs that stock cannot cover. */
export function orderJobMaterialsOn(
  db: ProductionDb,
  jobId: string,
  createdBy: string
): MaterialOrderResult {
  const job = db.jobCards.find((j) => j.id === jobId);
  if (!job) throw new Error("Job card not found");
  if (job.status !== "draft") {
    throw new Error("Material orders are for draft jobs");
  }
  if (!db.purchaseOrders) db.purchaseOrders = [];
  if (!db.parties) db.parties = [];
  if (!db.supplierContracts) db.supplierContracts = [];

  const missingSupplier: MaterialOrderResult["missingSupplier"] = [];
  const bySupplier = new Map<string, { line: JobCardLine; short: number }[]>();

  for (const line of job.inputLines) {
    if (!(line.qty > 0)) continue;
    const onHand = onHandSecondary(db, line);
    const already = alreadyOrderedForJob(
      db.purchaseOrders,
      job.number,
      skuKey(line)
    );
    const short = roundMoney(line.qty - onHand - already);
    if (!(short > 0.009)) continue;
    const product = db.products.find((p) => p.id === line.productId);
    const supplierId = product?.preferredSupplierId;
    const party = supplierId
      ? db.parties.find(
          (p) => p.id === supplierId && p.type === "supplier" && p.active
        )
      : undefined;
    if (!party) {
      missingSupplier.push({
        itemLabel: line.itemLabel || line.productId,
        qty: short,
      });
      continue;
    }
    const list = bySupplier.get(party.id) ?? [];
    list.push({ line, short });
    bySupplier.set(party.id, list);
  }

  if (!bySupplier.size) {
    return { orders: [], missingSupplier };
  }

  const orders: PurchaseOrder[] = [];
  const now = new Date().toISOString();
  for (const [supplierId, rows] of bySupplier) {
    const lines: PurchaseOrderLine[] = rows.map(({ line, short }) => {
      const product = db.products.find((p) => p.id === line.productId);
      const contract = resolveOpenContract(
        db.supplierContracts ?? [],
        db.products,
        supplierId,
        line.productId,
        job.date,
        { variationId: line.variationId }
      );
      const rate = contract?.rate ?? 0;
      return {
        id: `pol_${crypto.randomUUID()}`,
        productId: line.productId,
        variationId: line.variationId,
        colorId: line.colorId,
        itemLabel: line.itemLabel,
        qty: short,
        secondaryQty: short,
        unit: product?.unit,
        rate,
        amount: roundMoney(short * rate),
        contractId: contract?.id,
        receivedQty: 0,
        billedQty: 0,
      };
    });
    const po: PurchaseOrder = {
      id: `po_${crypto.randomUUID()}`,
      number: nextPoNumber(db.purchaseOrders),
      supplierId,
      date: job.date,
      status: "draft",
      lines,
      narration: `Materials for ${job.number}`,
      total: roundMoney(lines.reduce((s, l) => s + l.amount, 0)),
      createdAt: now,
      createdBy,
    };
    db.purchaseOrders.unshift(po);
    orders.push(po);
  }
  return { orders, missingSupplier };
}

export function wipBalance(
  db: Pick<ProductionDb, "accounts" | "ledgerEntries">,
  asOf?: string
): number {
  const wip = db.accounts.find((a) => a.id === ACCT.wip);
  if (!wip) return 0;
  return accountBalance(
    {
      id: wip.id,
      code: "1305",
      name: { en: "WIP", hi: "WIP" },
      type: wip.type,
      openingBalance: wip.openingBalance,
      active: wip.active,
    },
    db.ledgerEntries,
    asOf
  );
}
