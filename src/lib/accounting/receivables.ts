import type {
  BillAllocation,
  LedgerEntry,
  Party,
  Voucher,
} from "../types";
import { roundMoney } from "../pricing";
import { partyBalance } from "./engine";
import {
  cancelledOrderIdSet,
  invoiceLinkedToCancelledOrder,
  type CancelledOrderRef,
} from "./cancelled-order-books";

export type AgingBucketKey =
  | "current"
  | "d1_30"
  | "d31_60"
  | "d61_90"
  | "d90_plus";

export interface AgingBuckets {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
}

export interface OpenInvoice {
  voucher: Voucher;
  outstanding: number;
  daysOverdue: number;
  bucket: AgingBucketKey;
}

function daysBetween(from: string, to: string): number {
  const a = new Date(from.slice(0, 10) + "T00:00:00");
  const b = new Date(to.slice(0, 10) + "T00:00:00");
  return Math.floor((b.getTime() - a.getTime()) / (24 * 60 * 60 * 1000));
}

function bucketForDays(daysOverdue: number): AgingBucketKey {
  if (daysOverdue <= 0) return "current";
  if (daysOverdue <= 30) return "d1_30";
  if (daysOverdue <= 60) return "d31_60";
  if (daysOverdue <= 90) return "d61_90";
  return "d90_plus";
}

/** Allocations + credit/debit notes that settle an invoice */
export function invoiceSettledAmount(
  invoiceId: string,
  vouchers: Voucher[],
  allocations: BillAllocation[]
): number {
  const allocated = allocations
    .filter((a) => a.invoiceVoucherId === invoiceId)
    .reduce((s, a) => s + a.amount, 0);
  const returns = vouchers
    .filter(
      (v) =>
        !v.voided &&
        ((v.type === "credit_note" && v.linkedInvoiceId === invoiceId) ||
          (v.type === "debit_note" && v.linkedPurchaseId === invoiceId))
    )
    .reduce((s, v) => s + v.total, 0);
  return roundMoney(allocated + returns);
}

export type InvoiceSettlementKind =
  | "receipt"
  | "payment"
  | "credit_note"
  | "debit_note";

export interface InvoiceSettlementLine {
  kind: InvoiceSettlementKind;
  voucherId: string;
  number: string;
  date: string;
  amount: number;
}

/** Receipts, payments, and linked notes that reduced this invoice. */
export function invoiceSettlementLines(
  invoiceId: string,
  vouchers: Voucher[],
  allocations: BillAllocation[]
): InvoiceSettlementLine[] {
  const lines: InvoiceSettlementLine[] = [];
  for (const a of allocations) {
    if (a.invoiceVoucherId !== invoiceId || a.amount <= 0.009) continue;
    const v = vouchers.find((x) => x.id === a.receiptOrPaymentVoucherId);
    if (!v || v.voided) continue;
    lines.push({
      kind: v.type === "payment" ? "payment" : "receipt",
      voucherId: v.id,
      number: v.number,
      date: a.date || v.date,
      amount: roundMoney(a.amount),
    });
  }
  for (const v of vouchers) {
    if (v.voided) continue;
    if (v.type === "credit_note" && v.linkedInvoiceId === invoiceId) {
      lines.push({
        kind: "credit_note",
        voucherId: v.id,
        number: v.number,
        date: v.date,
        amount: roundMoney(v.total),
      });
    }
    if (v.type === "debit_note" && v.linkedPurchaseId === invoiceId) {
      lines.push({
        kind: "debit_note",
        voucherId: v.id,
        number: v.number,
        date: v.date,
        amount: roundMoney(v.total),
      });
    }
  }
  return lines.sort(
    (a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number)
  );
}

export function invoiceOutstanding(
  invoice: Voucher,
  vouchers: Voucher[],
  allocations: BillAllocation[]
): number {
  if (invoice.voided) return 0;
  if (invoice.type !== "sale" && invoice.type !== "purchase") return 0;
  const settled = invoiceSettledAmount(invoice.id, vouchers, allocations);
  return Math.max(0, roundMoney(invoice.total - settled));
}

export function refreshInvoiceOutstanding(
  invoice: Voucher,
  vouchers: Voucher[],
  allocations: BillAllocation[]
): number {
  const o = invoiceOutstanding(invoice, vouchers, allocations);
  invoice.outstanding = o;
  return o;
}

export function openInvoicesForParty(
  partyId: string,
  vouchers: Voucher[],
  allocations: BillAllocation[],
  asOf: string,
  kind: "sale" | "purchase" = "sale",
  orders?: CancelledOrderRef[]
): OpenInvoice[] {
  const asOfD = asOf.slice(0, 10);
  const cancelledIds = cancelledOrderIdSet(orders);
  return vouchers
    .filter(
      (v) =>
        !v.voided &&
        v.type === kind &&
        v.partyId === partyId &&
        v.date.slice(0, 10) <= asOfD &&
        !invoiceLinkedToCancelledOrder(v, cancelledIds)
    )
    .map((voucher) => {
      const outstanding = invoiceOutstanding(voucher, vouchers, allocations);
      const due = (voucher.dueDate || voucher.date).slice(0, 10);
      const daysOverdue = daysBetween(due, asOfD);
      return {
        voucher,
        outstanding,
        daysOverdue,
        bucket: bucketForDays(daysOverdue),
      };
    })
    .filter((x) => x.outstanding > 0.009)
    .sort((a, b) => a.voucher.date.localeCompare(b.voucher.date));
}

export function partyAging(
  partyId: string,
  vouchers: Voucher[],
  allocations: BillAllocation[],
  asOf: string,
  kind: "sale" | "purchase" = "sale",
  orders?: CancelledOrderRef[]
): AgingBuckets {
  const open = openInvoicesForParty(
    partyId,
    vouchers,
    allocations,
    asOf,
    kind,
    orders
  );
  const buckets: AgingBuckets = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
    total: 0,
  };
  for (const row of open) {
    buckets[row.bucket] = roundMoney(buckets[row.bucket] + row.outstanding);
    buckets.total = roundMoney(buckets.total + row.outstanding);
  }
  return buckets;
}

export function allOpenReceivables(
  parties: Party[],
  vouchers: Voucher[],
  allocations: BillAllocation[],
  asOf: string,
  orders?: CancelledOrderRef[]
): OpenInvoice[] {
  const customers = parties.filter((p) => p.active && p.type === "customer");
  const rows: OpenInvoice[] = [];
  for (const p of customers) {
    rows.push(
      ...openInvoicesForParty(
        p.id,
        vouchers,
        allocations,
        asOf,
        "sale",
        orders
      )
    );
  }
  return rows.sort((a, b) => a.voucher.date.localeCompare(b.voucher.date));
}

/** Open supplier bills (payables) */
export function allOpenPayables(
  parties: Party[],
  vouchers: Voucher[],
  allocations: BillAllocation[],
  asOf: string
): OpenInvoice[] {
  const suppliers = parties.filter((p) => p.active && p.type === "supplier");
  const rows: OpenInvoice[] = [];
  for (const p of suppliers) {
    rows.push(
      ...openInvoicesForParty(p.id, vouchers, allocations, asOf, "purchase")
    );
  }
  return rows.sort((a, b) => a.voucher.date.localeCompare(b.voucher.date));
}

/** Payment plan: overdue first, then by due date */
export function paymentPlanPayables(
  parties: Party[],
  vouchers: Voucher[],
  allocations: BillAllocation[],
  asOf: string
): OpenInvoice[] {
  const asOfD = asOf.slice(0, 10);
  return allOpenPayables(parties, vouchers, allocations, asOf).sort((a, b) => {
    const dueA = (a.voucher.dueDate || a.voucher.date).slice(0, 10);
    const dueB = (b.voucher.dueDate || b.voucher.date).slice(0, 10);
    const overA = dueA < asOfD ? 0 : 1;
    const overB = dueB < asOfD ? 0 : 1;
    if (overA !== overB) return overA - overB;
    return dueA.localeCompare(dueB);
  });
}

/**
 * Allocate a receipt/payment to open bills oldest → newest (FIFO).
 * Any leftover is unallocated advance / on-account.
 */
export function allocateOldestFirst(
  bills: { voucher: { id: string }; outstanding: number }[],
  amount: number
): Record<string, number> {
  let left = roundMoney(Math.max(0, amount));
  const out: Record<string, number> = {};
  for (const row of bills) {
    if (left <= 0.009) {
      out[row.voucher.id] = 0;
      continue;
    }
    const take = roundMoney(Math.min(row.outstanding, left));
    out[row.voucher.id] = take;
    left = roundMoney(left - take);
  }
  return out;
}

/** Receipts with leftover not applied to any sale invoice. */
export function leftoverReceipts(
  vouchers: Voucher[],
  allocations: BillAllocation[]
): { voucher: Voucher; leftover: number }[] {
  return vouchers
    .filter((v) => v.type === "receipt" && !v.voided && v.partyId)
    .map((v) => {
      const allocated: Record<string, number> = {};
      for (const a of allocations) {
        if (a.receiptOrPaymentVoucherId !== v.id) continue;
        allocated[a.invoiceVoucherId] = roundMoney(
          (allocated[a.invoiceVoucherId] || 0) + a.amount
        );
      }
      return {
        voucher: v,
        leftover: unallocatedAdvance(v.total, allocated),
      };
    })
    .filter((row) => row.leftover > 0.05);
}

/** Portion of payment/receipt not applied to any bill → advance. */
export function unallocatedAdvance(
  amount: number,
  allocations: Record<string, number>
): number {
  const used = roundMoney(
    Object.values(allocations).reduce((s, a) => s + (a || 0), 0)
  );
  return Math.max(0, roundMoney(amount - used));
}

/** Supplier-wise creditors closing + open bill totals. */
export function creditorsClosingList(
  parties: Party[],
  vouchers: Voucher[],
  allocations: BillAllocation[],
  ledgerEntries: LedgerEntry[],
  asOf: string
): {
  partyId: string;
  name: string;
  closing: number;
  billsOutstanding: number;
  billCount: number;
}[] {
  const asOfD = asOf.slice(0, 10);
  const rows: {
    partyId: string;
    name: string;
    closing: number;
    billsOutstanding: number;
    billCount: number;
  }[] = [];
  for (const p of parties.filter((x) => x.active && x.type === "supplier")) {
    const bills = openInvoicesForParty(
      p.id,
      vouchers,
      allocations,
      asOfD,
      "purchase"
    );
    const billsOutstanding = roundMoney(
      bills.reduce((s, b) => s + b.outstanding, 0)
    );
    const closing = partyBalance(p, ledgerEntries, asOfD);
    if (Math.abs(closing) < 0.01 && billsOutstanding < 0.01) continue;
    rows.push({
      partyId: p.id,
      name: p.name,
      closing,
      billsOutstanding,
      billCount: bills.length,
    });
  }
  return rows.sort((a, b) => b.closing - a.closing);
}

export function creditLimitBreach(
  party: Party,
  currentReceivable: number,
  newSaleTotal: number
): { ok: boolean; overBy: number } {
  if (!party.creditLimit || party.creditLimit <= 0) {
    return { ok: true, overBy: 0 };
  }
  const projected = roundMoney(currentReceivable + newSaleTotal);
  if (projected <= party.creditLimit + 0.009) {
    return { ok: true, overBy: 0 };
  }
  return { ok: false, overBy: roundMoney(projected - party.creditLimit) };
}
