import type { BillAllocation, LedgerEntry, Order, Voucher } from "../types";

export type CancelledOrderRef = Pick<Order, "id" | "status">;

export type CancelledBooksDb = {
  orders: CancelledOrderRef[];
  vouchers: Voucher[];
  ledgerEntries: LedgerEntry[];
  billAllocations: BillAllocation[];
};

export function cancelledOrderIdSet(
  orders: CancelledOrderRef[] | undefined
): Set<string> {
  const ids = new Set<string>();
  for (const o of orders ?? []) {
    if (o.status === "cancelled") ids.add(o.id);
  }
  return ids;
}

export function invoiceLinkedToCancelledOrder(
  voucher: Pick<Voucher, "linkedOrderId">,
  cancelledIds: ReadonlySet<string>
): boolean {
  return !!voucher.linkedOrderId && cancelledIds.has(voucher.linkedOrderId);
}

function collectVouchersToVoid(
  db: CancelledBooksDb,
  orderIds: ReadonlySet<string>
): Voucher[] {
  const linked = db.vouchers.filter(
    (v) => !v.voided && !!v.linkedOrderId && orderIds.has(v.linkedOrderId)
  );
  const invoiceIds = new Set(
    linked
      .filter((v) => v.type === "sale" || v.type === "purchase")
      .map((v) => v.id)
  );
  const extras = db.vouchers.filter(
    (v) =>
      !v.voided &&
      ((v.linkedInvoiceId && invoiceIds.has(v.linkedInvoiceId)) ||
        (v.linkedPurchaseId && invoiceIds.has(v.linkedPurchaseId)))
  );
  const byId = new Map<string, Voucher>();
  for (const v of [...linked, ...extras]) byId.set(v.id, v);
  const rank = (v: Voucher) =>
    v.type === "sale" || v.type === "purchase" ? 1 : 0;
  return [...byId.values()].sort((a, b) => rank(a) - rank(b));
}

function markVoucherVoidedInBooks(
  db: CancelledBooksDb,
  voucher: Voucher,
  voidedBy: string,
  at: string
): void {
  voucher.voided = true;
  voucher.voidedAt = at;
  voucher.voidedBy = voidedBy;
  if (voucher.type === "sale" || voucher.type === "purchase") {
    voucher.outstanding = 0;
  }
  for (const e of db.ledgerEntries) {
    if (e.voucherId === voucher.id) e.voided = true;
  }
  db.billAllocations = db.billAllocations.filter(
    (a) =>
      a.receiptOrPaymentVoucherId !== voucher.id &&
      a.invoiceVoucherId !== voucher.id
  );
}

function voidCollected(
  db: CancelledBooksDb,
  toVoid: Voucher[],
  voidedBy: string
): { changed: boolean; voidedNumbers: string[] } {
  if (!toVoid.length) return { changed: false, voidedNumbers: [] };
  const at = new Date().toISOString();
  const voidedNumbers: string[] = [];
  for (const v of toVoid) {
    markVoucherVoidedInBooks(db, v, voidedBy, at);
    voidedNumbers.push(v.number);
  }
  return { changed: true, voidedNumbers };
}

/** Ledger-only void so a cancelled order is not still receivable. Skips stock. */
export function voidBooksForCancelledOrders(
  db: CancelledBooksDb,
  voidedBy = "system"
): { changed: boolean; voidedNumbers: string[] } {
  return voidCollected(
    db,
    collectVouchersToVoid(db, cancelledOrderIdSet(db.orders)),
    voidedBy
  );
}

export function voidBooksForOrder(
  db: CancelledBooksDb,
  orderId: string,
  voidedBy = "system"
): { changed: boolean; voidedNumbers: string[] } {
  return voidCollected(db, collectVouchersToVoid(db, new Set([orderId])), voidedBy);
}
