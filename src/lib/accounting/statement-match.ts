import type {
  LedgerEntry,
  Party,
  StatementMatch,
  StatementMatchExtra,
} from "../types";
import { roundMoney } from "../pricing";
import { partyBalance } from "./engine";

/** How one ledger line moves our party balance (positive = balance up). */
export function entryBalanceEffect(
  party: Party,
  entry: Pick<LedgerEntry, "debit" | "credit">
): number {
  if (party.type === "customer") {
    return roundMoney(entry.debit - entry.credit);
  }
  // Supplier payable rises on credit
  return roundMoney(entry.credit - entry.debit);
}

/** How a row from their statement moves the claimed balance. */
export function extraBalanceEffect(extra: StatementMatchExtra): number {
  return extra.side === "increase"
    ? roundMoney(extra.amount)
    : roundMoney(-extra.amount);
}

export function matchDiff(input: {
  party: Party;
  ourClosing: number;
  theirClosing: number;
  entries: LedgerEntry[];
  matchedEntryIds: string[];
  theirExtraRows: StatementMatchExtra[];
}): {
  difference: number;
  unmatchedOur: { entry: LedgerEntry; effect: number }[];
  unmatchedOurTotal: number;
  theirExtraTotal: number;
  unexplained: number;
} {
  const matched = new Set(input.matchedEntryIds);
  const unmatchedOur = input.entries
    .filter((e) => !matched.has(e.id))
    .map((entry) => ({
      entry,
      effect: entryBalanceEffect(input.party, entry),
    }));
  const unmatchedOurTotal = roundMoney(
    unmatchedOur.reduce((s, r) => s + r.effect, 0)
  );
  const theirExtraTotal = roundMoney(
    input.theirExtraRows.reduce((s, r) => s + extraBalanceEffect(r), 0)
  );
  const difference = roundMoney(input.theirClosing - input.ourClosing);
  // Their extras explain part of (their − ours). Unticked our lines also do.
  const unexplained = roundMoney(
    difference - theirExtraTotal + unmatchedOurTotal
  );
  return {
    difference,
    unmatchedOur,
    unmatchedOurTotal,
    theirExtraTotal,
    unexplained,
  };
}

export function computeOurClosing(
  party: Party,
  ledgerEntries: LedgerEntry[],
  asOf: string
): number {
  return partyBalance(party, ledgerEntries, asOf);
}

/** Suggest voucher type when posting an entry they have and we don’t. */
export function suggestedVoucherForExtra(
  party: Party,
  extra: StatementMatchExtra
): "sale" | "purchase" | "receipt" | "payment" | "credit_note" | "debit_note" {
  if (party.type === "customer") {
    return extra.side === "increase" ? "sale" : "receipt";
  }
  return extra.side === "increase" ? "purchase" : "payment";
}

export function isMatchBalanced(match: StatementMatch, unexplained: number): boolean {
  return Math.abs(unexplained) < 0.02;
}
