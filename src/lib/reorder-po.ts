import {
  stockAlertsFromDb,
  type StockAlertRow,
} from "./accounting/analysis";
import { resolveOpenContract } from "./contracts";
import { roundMoney } from "./pricing";
import type {
  Party,
  Product,
  PurchaseOrder,
  PurchaseOrderLine,
  StockMovement,
  SupplierContract,
  AppSettings,
  Order,
} from "./types";

/** Slice of the app DB the reorder builder needs — avoids importing store/db. */
export type ReorderDb = {
  products: Product[];
  parties: Party[];
  purchaseOrders: PurchaseOrder[];
  supplierContracts: SupplierContract[];
  stockMovements: StockMovement[];
  settings: AppSettings;
  orders?: Order[];
};

function nextPoNumber(orders: PurchaseOrder[]): string {
  let max = 1000;
  for (const o of orders) {
    const n = Number(o.number.replace(/\D/g, ""));
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `PO-${max + 1}`;
}

function skuKey(line: Pick<PurchaseOrderLine, "productId" | "variationId" | "colorId">): string {
  return `${line.productId ?? ""}|${line.variationId ?? ""}|${line.colorId ?? ""}`;
}

function mergeLineInto(
  lines: PurchaseOrderLine[],
  incoming: PurchaseOrderLine
): void {
  const i = lines.findIndex((l) => skuKey(l) === skuKey(incoming));
  if (i < 0) {
    lines.push(incoming);
    return;
  }
  const cur = lines[i]!;
  const qty = cur.qty + incoming.qty;
  const secondary =
    (cur.secondaryQty ?? cur.qty) + (incoming.secondaryQty ?? incoming.qty);
  const rate = cur.rate > 0 ? cur.rate : incoming.rate;
  lines[i] = {
    ...cur,
    qty,
    secondaryQty: secondary,
    rate,
    amount: roundMoney(qty * rate),
    contractId: cur.contractId || incoming.contractId,
  };
}

function retotal(po: PurchaseOrder): void {
  po.total = roundMoney(po.lines.reduce((s, l) => s + l.amount, 0));
}

function narrationFor(rows: StockAlertRow[]): string {
  const hasVelocity = rows.some((r) => r.coverMode === "velocity");
  const hasMin = rows.some((r) => r.coverMode !== "velocity");
  if (hasVelocity && hasMin) return "Auto reorder (velocity + min)";
  if (hasVelocity) return "Auto reorder (velocity)";
  return "Auto reorder (min)";
}

function rowToLine(
  db: ReorderDb,
  supplierId: string,
  r: StockAlertRow,
  asOf: string
): PurchaseOrderLine {
  const product = db.products.find((p) => p.id === r.productId);
  const contract = resolveOpenContract(
    db.supplierContracts,
    db.products,
    supplierId,
    r.productId,
    asOf,
    { variationId: r.variationId }
  );
  const rate = contract?.rate ?? 0;
  const qty = r.suggestedQty;
  return {
    id: `pol_${crypto.randomUUID()}`,
    productId: r.productId,
    variationId: r.variationId,
    colorId: r.colorId,
    itemLabel: r.label,
    qty,
    secondaryQty: qty,
    unit: product?.unit,
    rate,
    amount: roundMoney(qty * rate),
    contractId: contract?.id,
    receivedQty: 0,
    billedQty: 0,
  };
}

/**
 * Create or merge draft POs from reorder alerts, mutating `db` in place.
 * Groups lines by preferred supplier (required). Incoming open-PO qty is
 * already netted in suggestedQty — do not skip the whole SKU.
 * Existing **draft** POs for the same supplier are reused instead of
 * stacking a new draft every cron run.
 */
export function buildDraftPosFromAlerts(
  db: ReorderDb,
  createdBy: string,
  opts: {
    minQty?: number;
    rows?: StockAlertRow[];
    asOf?: string;
  } = {}
): PurchaseOrder[] {
  const asOf = opts.asOf || new Date().toISOString().slice(0, 10);
  const minQty = opts.minQty ?? db.settings.autoReorderMinQty ?? 1;

  const alerts =
    opts.rows ??
    stockAlertsFromDb(db, { asOf }).filter((r) => r.kind === "reorder");

  const bySupplier = new Map<string, StockAlertRow[]>();
  for (const row of alerts) {
    if (row.kind !== "reorder") continue;
    if (row.blockers?.includes("missing_supplier")) continue;
    if (row.blockers?.includes("contract_exhausted")) continue;
    if (row.suggestedQty < minQty) continue;
    const supplierId = row.preferredSupplierId;
    if (!supplierId) continue;
    const party = db.parties.find(
      (p) => p.id === supplierId && p.type === "supplier" && p.active
    );
    if (!party) continue;
    const list = bySupplier.get(supplierId) ?? [];
    list.push(row);
    bySupplier.set(supplierId, list);
  }

  const touched: PurchaseOrder[] = [];
  for (const [supplierId, rows] of bySupplier) {
    const existing = db.purchaseOrders.find(
      (p) => p.supplierId === supplierId && p.status === "draft"
    );
    const lines = rows.map((r) => rowToLine(db, supplierId, r, asOf));
    if (!lines.length) continue;
    const note = narrationFor(rows);

    if (existing) {
      const seen = new Set(existing.lines.map(skuKey));
      for (const line of lines) mergeLineInto(existing.lines, line);
      const addedNewSku = lines.some((l) => !seen.has(skuKey(l)));
      if (existing.narration && existing.narration !== note) {
        existing.narration = `${existing.narration}; ${note}`;
      } else if (!existing.narration) {
        existing.narration = note;
      } else if (addedNewSku && !existing.narration.includes(note)) {
        existing.narration = `${existing.narration}; ${note}`;
      }
      retotal(existing);
      if (!touched.some((p) => p.id === existing.id)) touched.push(existing);
      continue;
    }

    const po: PurchaseOrder = {
      id: `po_${crypto.randomUUID()}`,
      number: nextPoNumber([...db.purchaseOrders, ...touched]),
      supplierId,
      date: asOf,
      status: "draft",
      lines,
      narration: note,
      total: roundMoney(lines.reduce((s, l) => s + l.amount, 0)),
      createdAt: new Date().toISOString(),
      createdBy,
    };
    db.purchaseOrders.unshift(po);
    touched.push(po);
  }
  return touched;
}

export function countReorderBlockers(rows: StockAlertRow[]): {
  missingSupplier: number;
  contractExhausted: number;
} {
  let missingSupplier = 0;
  let contractExhausted = 0;
  for (const r of rows) {
    if (r.kind !== "reorder") continue;
    if (r.blockers?.includes("missing_supplier") || !r.preferredSupplierId) {
      missingSupplier += 1;
    }
    if (r.blockers?.includes("contract_exhausted")) contractExhausted += 1;
  }
  return { missingSupplier, contractExhausted };
}
