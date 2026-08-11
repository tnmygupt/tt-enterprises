import { describe, expect, it } from "vitest";
import { trialBalance } from "./engine";
import type { Account, LedgerEntry } from "../types";

describe("trialBalance", () => {
  it("debits equal credits over a seeded voucher set", () => {
    const accounts: Account[] = [
      {
        id: "cash",
        code: "1000",
        name: { en: "Cash", hi: "नकद" },
        type: "asset",
        openingBalance: 0,
        active: true,
      },
      {
        id: "sales",
        code: "4000",
        name: { en: "Sales", hi: "बिक्री" },
        type: "income",
        openingBalance: 0,
        active: true,
      },
      {
        id: "ar",
        code: "1100",
        name: { en: "Receivable", hi: "प्राप्य" },
        type: "asset",
        openingBalance: 0,
        active: true,
      },
    ];

    const entries: LedgerEntry[] = [
      {
        id: "e1",
        voucherId: "v1",
        voucherNumber: "S-1",
        voucherType: "sale",
        date: "2026-01-10",
        accountId: "ar",
        debit: 1000,
        credit: 0,
        narration: "sale",
        voided: false,
      },
      {
        id: "e2",
        voucherId: "v1",
        voucherNumber: "S-1",
        voucherType: "sale",
        date: "2026-01-10",
        accountId: "sales",
        debit: 0,
        credit: 1000,
        narration: "sale",
        voided: false,
      },
      {
        id: "e3",
        voucherId: "v2",
        voucherNumber: "R-1",
        voucherType: "receipt",
        date: "2026-01-11",
        accountId: "cash",
        debit: 400,
        credit: 0,
        narration: "receipt",
        voided: false,
      },
      {
        id: "e4",
        voucherId: "v2",
        voucherNumber: "R-1",
        voucherType: "receipt",
        date: "2026-01-11",
        accountId: "ar",
        debit: 0,
        credit: 400,
        narration: "receipt",
        voided: false,
      },
    ];

    const tb = trialBalance(accounts, entries, "2026-01-31");
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.totalDebit).toBeGreaterThan(0);
  });
});
