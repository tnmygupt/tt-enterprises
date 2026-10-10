import { ACCT, bankBookAccounts, cashBankAccounts } from "./accounting/seed";
import { accountBalance } from "./accounting/engine";
import { roundMoney } from "./pricing";
import type { Account, AppSettings, BankAccountDetails } from "./types";
import { listStoredPayableAccounts } from "./upi";

export type NewCompanyBankInput = {
  label: string;
  accountName?: string;
  accountNumber?: string;
  ifsc?: string;
  bankName?: string;
  branch?: string;
  upiId?: string;
  upiPayeeName?: string;
  openingBalance?: number;
  /** When false, the ledger is created but dealers do not see it. Default true. */
  showToDealers?: boolean;
  makeDefault?: boolean;
};

export type DraftCompanyBank = {
  account: Account;
  payable: BankAccountDetails;
  bankAccounts: BankAccountDetails[];
};

/** Next unused 10xx code after the seeded Cash (1001) / Bank (1002). */
export function nextBankLedgerCode(accounts: { code: string }[]): string {
  const used = new Set(accounts.map((a) => a.code.trim()));
  for (let n = 1003; n <= 1099; n += 1) {
    const code = String(n);
    if (!used.has(code)) return code;
  }
  return `B${Date.now().toString().slice(-6)}`;
}

export function cashInHand(
  accounts: Account[],
  entries: Parameters<typeof accountBalance>[1],
  asOf?: string
): number {
  const cash = accounts.find((a) => a.id === ACCT.cash);
  return cash ? accountBalance(cash, entries, asOf) : 0;
}

export function bankBooksTotal(
  accounts: Account[],
  entries: Parameters<typeof accountBalance>[1],
  asOf?: string
): number {
  return roundMoney(
    bankBookAccounts(accounts).reduce(
      (sum, a) => sum + accountBalance(a, entries, asOf),
      0
    )
  );
}

export function cashBankTotal(
  accounts: Account[],
  entries: Parameters<typeof accountBalance>[1],
  asOf?: string
): number {
  return roundMoney(
    cashBankAccounts(accounts).reduce(
      (sum, a) => sum + accountBalance(a, entries, asOf),
      0
    )
  );
}

/**
 * Build a new bank ledger + payable row. Does not write storage.
 * Existing payment accounts (including a migrated legacy singleton) are kept.
 */
export function draftCompanyBankAccount(opts: {
  ledgerId: string;
  payableId: string;
  accounts: Account[];
  settings: AppSettings;
  input: NewCompanyBankInput;
}): DraftCompanyBank {
  const label =
    opts.input.label.trim() ||
    opts.input.bankName?.trim() ||
    opts.input.accountName?.trim() ||
    "Bank account";
  const opening = roundMoney(Math.max(0, Number(opts.input.openingBalance) || 0));
  const showToDealers = opts.input.showToDealers !== false;
  const account: Account = {
    id: opts.ledgerId,
    code: nextBankLedgerCode(opts.accounts),
    name: { en: label, hi: label },
    type: "asset",
    openingBalance: opening,
    active: true,
    bankBook: true,
  };

  const existing = listStoredPayableAccounts(opts.settings, {
    includeInactive: true,
  }).map((row) => ({
    ...row,
    ledgerId: row.ledgerId || ACCT.bank,
  }));

  const makeDefault =
    opts.input.makeDefault === true ||
    (showToDealers && !existing.some((a) => a.isDefault && a.active !== false));

  const payable: BankAccountDetails = {
    id: opts.payableId,
    ledgerId: opts.ledgerId,
    label,
    accountName: opts.input.accountName?.trim() || "",
    accountNumber: opts.input.accountNumber?.trim() || "",
    ifsc: (opts.input.ifsc || "").trim().toUpperCase(),
    bankName: opts.input.bankName?.trim() || "",
    branch: opts.input.branch?.trim() || "",
    upiId: opts.input.upiId?.trim() || "",
    upiPayeeName: opts.input.upiPayeeName?.trim() || "",
    active: showToDealers,
    isDefault: makeDefault,
  };

  const bankAccounts = [
    ...existing.map((row) =>
      makeDefault ? { ...row, isDefault: false } : row
    ),
    payable,
  ];

  return { account, payable, bankAccounts };
}
