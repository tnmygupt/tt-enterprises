import { describe, expect, it } from "vitest";
import { ACCT, SEED_ACCOUNTS } from "./accounting/seed";
import {
  bankBooksTotal,
  cashBankTotal,
  cashInHand,
  draftCompanyBankAccount,
  nextBankLedgerCode,
} from "./bank-accounts";
import type { Account, AppSettings, BankAccountDetails, LedgerEntry } from "./types";
import { listPayableAccounts, listStoredPayableAccounts } from "./upi";

function settings(partial?: Partial<AppSettings>): AppSettings {
  return {
    companyName: "TT Enterprises",
    phone: "",
    address: "",
    gstin: "",
    fullTruckMinWeightKg: 0,
    fullTruckMinValue: 0,
    upiId: "old@okicici",
    upiPayeeName: "Sudhir",
    bankAccount: {
      accountName: "Sudhir Gupta",
      accountNumber: "111",
      ifsc: "ICIC0001",
      bankName: "ICICI",
      branch: "",
    },
    paymentNote: "",
    ...partial,
  } as AppSettings;
}

describe("nextBankLedgerCode", () => {
  it("skips seeded 1001/1002", () => {
    expect(nextBankLedgerCode(SEED_ACCOUNTS)).toBe("1003");
  });

  it("skips codes already used", () => {
    expect(
      nextBankLedgerCode([
        ...SEED_ACCOUNTS,
        { code: "1003" },
        { code: "1004" },
      ])
    ).toBe("1005");
  });
});

describe("draftCompanyBankAccount", () => {
  it("creates a bank-book ledger and a dealer payable, keeping the legacy row", () => {
    const drafted = draftCompanyBankAccount({
      ledgerId: "acct_bank_hdfc",
      payableId: "bank_hdfc",
      accounts: SEED_ACCOUNTS,
      settings: settings(),
      input: {
        label: "HDFC Current",
        bankName: "HDFC Bank",
        accountName: "TT Enterprises",
        accountNumber: "222",
        ifsc: "hdfc0000123",
        upiId: "tt@hdfcbank",
        openingBalance: 5000,
      },
    });
    expect(drafted.account.code).toBe("1003");
    expect(drafted.account.bankBook).toBe(true);
    expect(drafted.account.type).toBe("asset");
    expect(drafted.account.openingBalance).toBe(5000);
    expect(drafted.payable.ledgerId).toBe("acct_bank_hdfc");
    expect(drafted.payable.ifsc).toBe("HDFC0000123");
    expect(drafted.payable.isDefault).toBe(false);
    expect(drafted.bankAccounts).toHaveLength(2);
    expect(drafted.bankAccounts[0]?.label).toMatch(/ICICI|Sudhir|Account/);
    expect(drafted.bankAccounts[0]?.isDefault).toBe(true);
    expect(drafted.bankAccounts[1]?.id).toBe("bank_hdfc");
  });

  it("can hide the new row from dealers", () => {
    const drafted = draftCompanyBankAccount({
      ledgerId: "acct_bank_2",
      payableId: "bank_2",
      accounts: SEED_ACCOUNTS,
      settings: settings({
        upiId: "",
        bankAccount: {
          accountName: "",
          accountNumber: "",
          ifsc: "",
          bankName: "",
          branch: "",
        },
        bankAccounts: [],
      }),
      input: { label: "OD account", showToDealers: false },
    });
    expect(drafted.payable.active).toBe(false);
    expect(
      listPayableAccounts({
        ...settings({
          upiId: "",
          bankAccount: {
            accountName: "",
            accountNumber: "",
            ifsc: "",
            bankName: "",
            branch: "",
          },
        }),
        bankAccounts: drafted.bankAccounts,
      })
    ).toHaveLength(0);
  });

  it("makes the first dealer-facing account the default", () => {
    const drafted = draftCompanyBankAccount({
      ledgerId: "acct_bank_2",
      payableId: "bank_2",
      accounts: SEED_ACCOUNTS,
      settings: settings({
        upiId: "",
        bankAccount: {
          accountName: "",
          accountNumber: "",
          ifsc: "",
          bankName: "",
          branch: "",
        },
        bankAccounts: [],
      }),
      input: { label: "SBI", showToDealers: true },
    });
    expect(drafted.payable.isDefault).toBe(true);
    expect(drafted.bankAccounts).toHaveLength(1);
  });
});

describe("listStoredPayableAccounts", () => {
  it("keeps inactive rows for the editor", () => {
    const s = settings({
      bankAccounts: [
        {
          id: "a",
          label: "Live",
          accountName: "A",
          accountNumber: "1",
          ifsc: "ICIC0001",
          bankName: "ICICI",
          branch: "",
          active: true,
        },
        {
          id: "b",
          label: "Old",
          accountName: "B",
          accountNumber: "2",
          ifsc: "HDFC0001",
          bankName: "HDFC",
          branch: "",
          active: false,
        },
      ] as BankAccountDetails[],
    });
    expect(listStoredPayableAccounts(s)).toHaveLength(1);
    expect(listStoredPayableAccounts(s, { includeInactive: true })).toHaveLength(2);
  });
});

describe("cash/bank totals", () => {
  const extra: Account = {
    id: "acct_bank_hdfc",
    code: "1003",
    name: { en: "HDFC", hi: "HDFC" },
    type: "asset",
    openingBalance: 3000,
    active: true,
    bankBook: true,
  };
  const accounts = [
    ...SEED_ACCOUNTS.map((a) =>
      a.id === ACCT.cash
        ? { ...a, openingBalance: 1000 }
        : a.id === ACCT.bank
          ? { ...a, openingBalance: 2000 }
          : a
    ),
    extra,
  ];
  const entries: LedgerEntry[] = [];

  it("sums extra bank ledgers separately from cash", () => {
    expect(cashInHand(accounts, entries)).toBe(1000);
    expect(bankBooksTotal(accounts, entries)).toBe(5000);
    expect(cashBankTotal(accounts, entries)).toBe(6000);
  });
});
