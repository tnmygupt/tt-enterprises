import type { Account, BankReconExtra, LedgerEntry, Order } from "../types";
import { roundMoney } from "../pricing";
import { getProofItems } from "../proofs";
import { accountBalance } from "./engine";

/**
 * Tally-style BRS:
 * Balance as per books
 * − receipts/deposits not yet in the bank (uncleared debits)
 * + payments/cheques not yet presented (uncleared credits)
 * − bank charges / other statement-only debits we have not booked
 * + interest / other statement-only credits we have not booked
 * = expected statement balance
 */
export function brsExpectedStatement(input: {
  booksBalance: number;
  unclearedDebits: number;
  unclearedCredits: number;
  extraDebits: number;
  extraCredits: number;
}): number {
  return roundMoney(
    input.booksBalance -
      input.unclearedDebits +
      input.unclearedCredits -
      input.extraDebits +
      input.extraCredits
  );
}

export function brsDifference(
  statementBalance: number,
  expectedStatement: number
): number {
  return roundMoney(statementBalance - expectedStatement);
}

export function bankBookEntriesAsOf(
  entries: LedgerEntry[],
  accountId: string,
  asOf: string
): LedgerEntry[] {
  const day = asOf.slice(0, 10);
  return entries
    .filter(
      (e) =>
        !e.voided && e.accountId === accountId && e.date.slice(0, 10) <= day
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

export function summarizeBrs(input: {
  account: Account;
  entries: LedgerEntry[];
  asOf: string;
  statementBalance: number;
  clearedEntryIds: string[];
  extras: BankReconExtra[];
}): {
  booksBalance: number;
  rows: LedgerEntry[];
  uncleared: LedgerEntry[];
  cleared: LedgerEntry[];
  unclearedDebits: number;
  unclearedCredits: number;
  extraDebits: number;
  extraCredits: number;
  expectedStatement: number;
  difference: number;
  balanced: boolean;
} {
  const asOf = input.asOf.slice(0, 10);
  const rows = bankBookEntriesAsOf(input.entries, input.account.id, asOf);
  const cleared = new Set(input.clearedEntryIds);
  const uncleared = rows.filter((e) => !cleared.has(e.id));
  const unclearedDebits = roundMoney(
    uncleared.reduce((s, e) => s + (e.debit || 0), 0)
  );
  const unclearedCredits = roundMoney(
    uncleared.reduce((s, e) => s + (e.credit || 0), 0)
  );
  const extraDebits = roundMoney(
    input.extras.reduce((s, x) => s + (x.debit || 0), 0)
  );
  const extraCredits = roundMoney(
    input.extras.reduce((s, x) => s + (x.credit || 0), 0)
  );
  const booksBalance = accountBalance(input.account, input.entries, asOf);
  const expectedStatement = brsExpectedStatement({
    booksBalance,
    unclearedDebits,
    unclearedCredits,
    extraDebits,
    extraCredits,
  });
  const difference = brsDifference(input.statementBalance, expectedStatement);
  return {
    booksBalance,
    rows,
    uncleared,
    cleared: rows.filter((e) => cleared.has(e.id)),
    unclearedDebits,
    unclearedCredits,
    extraDebits,
    extraCredits,
    expectedStatement,
    difference,
    balanced: Math.abs(difference) < 0.05,
  };
}

export type BrsProofHint = {
  amount: number;
  date: string;
  payRef?: string;
  utr?: string;
  orderNumber: string;
  verified: boolean;
};

/** Proofs that may appear as bank credits (UPI / NEFT). */
export function collectBrsProofHints(orders: Order[]): BrsProofHint[] {
  const out: BrsProofHint[] = [];
  for (const o of orders) {
    const items = getProofItems(o.paymentProof);
    for (const it of items) {
      const amt =
        typeof it.amount === "number" && Number.isFinite(it.amount)
          ? roundMoney(it.amount)
          : 0;
      if (amt <= 0.009) continue;
      const raw = it.uploadedAt || o.paymentProof?.uploadedAt || "";
      const date = raw.slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      out.push({
        amount: amt,
        date,
        payRef: it.payRef?.trim() || undefined,
        utr: (it.note || o.paymentProof?.note || "").trim() || undefined,
        orderNumber: o.orderNumber,
        verified: !!o.paymentProof?.verified,
      });
    }
  }
  return out;
}

function daysApart(a: string, b: string): number {
  const da = new Date(a.slice(0, 10) + "T00:00:00");
  const db = new Date(b.slice(0, 10) + "T00:00:00");
  return Math.abs(Math.floor((da.getTime() - db.getTime()) / 86_400_000));
}

/**
 * Suggest a proof for a book line. Incoming bank (debit) only.
 * Same amount, date within ±3 days. Does not tick the row.
 */
export function matchBrsProofHint(
  entry: { date: string; debit: number; credit: number },
  hints: BrsProofHint[],
  windowDays = 3
): BrsProofHint | undefined {
  const amt = entry.debit;
  if (amt <= 0.009) return undefined;
  const matches = hints.filter(
    (h) =>
      Math.abs(h.amount - amt) <= 0.05 &&
      daysApart(h.date, entry.date) <= windowDays
  );
  if (!matches.length) return undefined;
  matches.sort(
    (a, b) => daysApart(a.date, entry.date) - daysApart(b.date, entry.date)
  );
  return matches[0];
}
