import type {
  BillAllocation,
  LedgerEntry,
  Order,
  Party,
  Voucher,
} from "../types";
import { roundMoney } from "../pricing";
import { partyBalance } from "./engine";
import {
  allOpenReceivables,
  creditLimitBreach,
  type OpenInvoice,
} from "./receivables";

export function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date.slice(0, 10)}T00:00:00`);
  d.setDate(d.getDate() + (Number(days) || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function saleDueDate(billDate: string, creditDays?: number): string {
  return addDaysIso(billDate.slice(0, 10), Math.max(0, creditDays || 0));
}

export function assertSaleUnderCredit(input: {
  party?: Party | null;
  ledgerEntries: LedgerEntry[];
  saleTotal: number;
  allowOverCredit?: boolean;
}): { ok: true } | { ok: false; overBy: number; message: string } {
  const party = input.party;
  if (!party || input.allowOverCredit) return { ok: true };
  const recv = partyBalance(party, input.ledgerEntries);
  const check = creditLimitBreach(party, recv, input.saleTotal);
  if (check.ok) return { ok: true };
  return {
    ok: false,
    overBy: check.overBy,
    message: `Credit limit exceeded by ₹${check.overBy}. Enable override to continue.`,
  };
}

export function overdueOpenReceivables(
  parties: Party[],
  vouchers: Voucher[],
  allocations: BillAllocation[],
  asOf: string
): OpenInvoice[] {
  return allOpenReceivables(parties, vouchers, allocations, asOf).filter(
    (row) => row.daysOverdue > 0
  );
}

export function overLimitCustomers(
  parties: Party[],
  ledgerEntries: LedgerEntry[]
): { party: Party; receivable: number; overBy: number }[] {
  const rows: { party: Party; receivable: number; overBy: number }[] = [];
  for (const party of parties.filter((p) => p.active && p.type === "customer")) {
    if (!party.creditLimit || party.creditLimit <= 0) continue;
    const receivable = partyBalance(party, ledgerEntries);
    const check = creditLimitBreach(party, receivable, 0);
    if (check.ok) continue;
    rows.push({ party, receivable, overBy: check.overBy });
  }
  return rows.sort((a, b) => b.overBy - a.overBy);
}

export function creditBlockedOrders(orders: Order[]): Order[] {
  return orders.filter(
    (o) =>
      o.status !== "cancelled" &&
      o.actualBillAmount == null &&
      (o.creditBlockedOverBy ?? 0) > 0.009
  );
}

export function overdueAmount(rows: OpenInvoice[]): number {
  return roundMoney(rows.reduce((s, r) => s + r.outstanding, 0));
}
