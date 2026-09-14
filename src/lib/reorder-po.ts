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

/**
 * Create draft POs from reorder alerts, mutating `db` in place.
 * Groups lines by preferred supplier (required). Incoming open-PO qty is
 * already netted in suggestedQty — do not skip the whole SKU.
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

  const created: PurchaseOrder[] = [];
  for (const [supplierId, rows] of bySupplier) {
    const hasVelocity = rows.some((r) => r.coverMode === "velocity");
    const hasMin = rows.some((r) => r.coverMode !== "velocity");
    const narration =
      hasVelocity && hasMin
        ? "Auto reorder (velocity + min)"
        : hasVelocity
          ? "Auto reorder (velocity)"
          : "Auto reorder (min)";
    const lines: PurchaseOrderLine[] = rows.map((r) => {
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
    });
    if (!lines.length) continue;
    const po: PurchaseOrder = {
      id: `po_${crypto.randomUUID()}`,
      number: nextPoNumber([...db.purchaseOrders, ...created]),
      supplierId,
      date: asOf,
      status: "draft",
      lines,
      narration,
      total: roundMoney(lines.reduce((s, l) => s + l.amount, 0)),
      createdAt: new Date().toISOString(),
      createdBy,
    };
    db.purchaseOrders.unshift(po);
    created.push(po);
  }
  return created;
}
