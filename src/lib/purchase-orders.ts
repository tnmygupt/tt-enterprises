import type { PurchaseOrder, PurchaseOrderLine } from "./types";

const OPEN_STATUSES: PurchaseOrder["status"][] = [
  "draft",
  "ordered",
  "partial",
];

export function poLineRemaining(line: PurchaseOrderLine): number {
  return Math.max(0, line.qty - (line.receivedQty ?? 0));
}

export function poRemainingQty(po: PurchaseOrder): number {
  return po.lines.reduce((s, l) => s + poLineRemaining(l), 0);
}

/** Draft / ordered / partial POs that still have qty to receive. */
export function listOpenPurchaseOrders(
  pos: PurchaseOrder[] | undefined
): PurchaseOrder[] {
  return (pos ?? [])
    .filter((p) => OPEN_STATUSES.includes(p.status) && poRemainingQty(p) > 0.001)
    .sort(
      (a, b) =>
        b.date.localeCompare(a.date) || b.number.localeCompare(a.number)
    );
}

/** Move a draft PO to ordered. Throws if the PO is not a draft. */
export function confirmDraftPurchaseOrder<
  T extends { status: PurchaseOrder["status"] },
>(po: T): T {
  if (po.status !== "draft") {
    throw new Error("Only draft purchase orders can be confirmed");
  }
  return { ...po, status: "ordered" };
}
