import type {
  AppSettings,
  LedgerEntry,
  Voucher,
  VoucherLine,
} from "../types";
import { roundMoney } from "../pricing";
import { assertPeriodOpen } from "./controls";
import { buildLedgerEntries, nextVoucherNumber } from "./engine";

export type JournalDb = {
  vouchers: Voucher[];
  ledgerEntries: LedgerEntry[];
  settings: Pick<AppSettings, "lockedThroughDate">;
};

export type JournalLeg = {
  accountId: string;
  debit?: number;
  credit?: number;
  itemLabel?: string;
};

/** Post a balanced journal. Credit legs use taxPercent -1 (engine convention). */
export function postBalancedJournal(
  db: JournalDb,
  input: {
    date: string;
    narration: string;
    createdBy: string;
    legs: JournalLeg[];
    partyId?: string;
    linkedGrnId?: string;
    linkedJobId?: string;
  }
): Voucher {
  assertPeriodOpen(input.date, db.settings);
  const lines: VoucherLine[] = [];
  let debitSum = 0;
  let creditSum = 0;
  for (const leg of input.legs) {
    const debit = roundMoney(Math.max(0, leg.debit ?? 0));
    const credit = roundMoney(Math.max(0, leg.credit ?? 0));
    if (debit < 0.005 && credit < 0.005) continue;
    if (debit > 0 && credit > 0) {
      throw new Error("Journal leg cannot be both debit and credit");
    }
    const amount = debit > 0 ? debit : credit;
    if (debit > 0) debitSum = roundMoney(debitSum + amount);
    else creditSum = roundMoney(creditSum + amount);
    lines.push({
      id: `vl_${crypto.randomUUID()}`,
      itemLabel: leg.itemLabel || input.narration,
      accountId: leg.accountId,
      qty: 1,
      secondaryQty: 1,
      rate: amount,
      amount,
      taxPercent: credit > 0 ? -1 : 0,
    });
  }
  if (lines.length < 2) {
    throw new Error("Journal needs debit and credit");
  }
  if (Math.abs(debitSum - creditSum) > 0.02) {
    throw new Error(`Journal not balanced: Dr ${debitSum} ≠ Cr ${creditSum}`);
  }
  const voucher: Voucher = {
    id: `vch_${crypto.randomUUID()}`,
    number: nextVoucherNumber(db.vouchers, "journal"),
    type: "journal",
    date: input.date.slice(0, 10),
    partyId: input.partyId,
    narration: input.narration.trim(),
    lines,
    subtotal: debitSum,
    taxAmount: 0,
    roundOff: 0,
    total: debitSum,
    linkedGrnId: input.linkedGrnId,
    linkedJobId: input.linkedJobId,
    inventorySkipped: true,
    voided: false,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
  };
  const entries = buildLedgerEntries(voucher);
  db.vouchers.unshift(voucher);
  db.ledgerEntries.push(...entries);
  return voucher;
}

export function voidJournalOn(
  db: JournalDb,
  voucherId: string,
  voidedBy: string
): void {
  const v = db.vouchers.find((x) => x.id === voucherId);
  if (!v || v.voided) return;
  assertPeriodOpen(v.date, db.settings);
  v.voided = true;
  v.voidedAt = new Date().toISOString();
  v.voidedBy = voidedBy;
  for (const e of db.ledgerEntries) {
    if (e.voucherId === voucherId) e.voided = true;
  }
}
