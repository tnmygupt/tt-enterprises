import type {
  Account,
  AppSettings,
  BatchConsumption,
  Bom,
  BomLine,
  JobCard,
  JobCardLine,
  LedgerEntry,
  Product,
  StockBatch,
  StockMovement,
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
  secondaryPerBundle,
} from "./inventory";
import { roundMoney } from "./pricing";
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

export function createJobCardOn(
  db: ProductionDb,
  input: {
    date: string;
    createdBy: string;
    bomId?: string;
    outputProductId: string;
    outputVariationId?: string;
    outputColorId?: string;
    plannedQty: number;
    inputLines?: Omit<JobCardLine, "itemLabel">[];
  }
): JobCard {
  assertPeriodOpen(input.date, db.settings);
  if (!(input.plannedQty > 0)) throw new Error("Planned qty must be greater than zero");
  let lines: JobCardLine[] = [];
  if (input.bomId) {
    const bom = db.boms.find((b) => b.id === input.bomId && b.active);
    if (!bom) throw new Error("BOM not found");
    lines = fillLineLabels(db, scaleBomLines(bom, input.plannedQty));
  } else if (input.inputLines?.length) {
    lines = fillLineLabels(
      db,
      input.inputLines.map((l) => ({
        ...l,
        itemLabel: l.productId,
      }))
    );
  } else {
    throw new Error("Pick a BOM or enter input lines");
  }
  const job: JobCard = {
    id: `job_${crypto.randomUUID()}`,
    number: nextJobNumber(db.jobCards),
    bomId: input.bomId,
    date: input.date.slice(0, 10),
    outputProductId: input.outputProductId,
    outputVariationId: input.outputVariationId,
    outputColorId: input.outputColorId,
    plannedQty: roundMoney(input.plannedQty),
    status: "draft",
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
  input: { jobId: string; actualQty: number; createdBy: string }
): JobCard {
  const job = db.jobCards.find((j) => j.id === input.jobId);
  if (!job) throw new Error("Job card not found");
  if (job.status !== "issued") throw new Error("Issue materials before completing");
  assertPeriodOpen(job.date, db.settings);
  const actual = roundMoney(input.actualQty);
  if (!(actual >= 0)) throw new Error("Enter actual output qty");
  const issuedCost = job.issuedCost ?? 0;
  const yieldPct =
    job.plannedQty > 0 ? Math.min(1, actual / job.plannedQty) : 1;
  const wastageCost =
    actual + 0.0001 < job.plannedQty
      ? roundMoney(issuedCost * (1 - yieldPct))
      : 0;
  const fgCost = roundMoney(issuedCost - wastageCost);

  const product = db.products.find((p) => p.id === job.outputProductId);
  if (!product) throw new Error("Finished product not found");
  const per = secondaryPerBundle(product, job.outputVariationId) || 1;
  const bundles = per > 0 ? roundMoney(actual / per) || (actual > 0 ? 1 : 0) : actual;
  if (actual > 0) {
    moveStock(
      db,
      {
        productId: job.outputProductId,
        variationId: job.outputVariationId,
        colorId: job.outputColorId,
        itemLabel: product.name.en,
        qty: actual,
        bundles: bundles || 1,
      },
      "in",
      job.date,
      input.createdBy,
      `${job.number} complete`
    );
    const rate = actual > 0 ? roundMoney(fgCost / actual) : 0;
    db.stockBatches.push(
      createBatchFromLine({
        date: job.date,
        productId: job.outputProductId,
        variationId: job.outputVariationId,
        colorId: job.outputColorId,
        qty: actual,
        rate,
        unit: product.unit,
        source: "production",
        voucherId: undefined,
        provisional: false,
      })
    );
  }

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
  const fgBatch = db.stockBatches[db.stockBatches.length - 1];
  if (fgBatch && fgBatch.source === "production" && !fgBatch.voucherId) {
    fgBatch.voucherId = voucher.id;
  }

  job.status = "completed";
  job.completedAt = new Date().toISOString();
  job.actualQty = actual;
  job.wastageQty = roundMoney(Math.max(0, job.plannedQty - actual));
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
