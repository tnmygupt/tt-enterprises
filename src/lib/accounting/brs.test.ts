import { describe, expect, it } from "vitest";
import {
  brsDifference,
  brsExpectedStatement,
  collectBrsProofHints,
  matchBrsProofHint,
  summarizeBrs,
} from "./brs";
import type { Account, LedgerEntry, Order } from "../types";

const bank: Account = {
  id: "acct_bank",
  code: "BANK",
  name: { en: "Bank", hi: "बैंक" },
  type: "asset",
  openingBalance: 10000,
  active: true,
  bankBook: true,
};

function entry(
  partial: Pick<LedgerEntry, "id" | "date" | "debit" | "credit">
): LedgerEntry {
  return {
    voucherId: "v1",
    voucherNumber: "R-1",
    voucherType: "receipt",
    accountId: "acct_bank",
    voided: false,
    ...partial,
  };
}

describe("BRS", () => {
  it("expected statement = books − uncleared deposits + uncleared payments", () => {
    expect(
      brsExpectedStatement({
        booksBalance: 10000,
        unclearedDebits: 2000,
        unclearedCredits: 500,
        extraDebits: 0,
        extraCredits: 0,
      })
    ).toBe(8500);
  });

  it("applies bank-only charges and interest", () => {
    expect(
      brsExpectedStatement({
        booksBalance: 10000,
        unclearedDebits: 0,
        unclearedCredits: 0,
        extraDebits: 118,
        extraCredits: 25,
      })
    ).toBe(9907);
  });

  it("is balanced when statement matches expected", () => {
    expect(brsDifference(8500, 8500)).toBe(0);
  });

  it("ticks cleared receipts so they leave the uncleared list", () => {
    const entries = [
      entry({ id: "le1", date: "2026-08-20", debit: 2000, credit: 0 }),
      entry({ id: "le2", date: "2026-08-21", debit: 0, credit: 500 }),
    ];
    const open = summarizeBrs({
      account: bank,
      entries,
      asOf: "2026-08-21",
      statementBalance: 10000,
      clearedEntryIds: [],
      extras: [],
    });
    expect(open.booksBalance).toBe(11500);
    expect(open.uncleared).toHaveLength(2);
    expect(open.expectedStatement).toBe(10000);
    expect(open.balanced).toBe(true);

    const afterTick = summarizeBrs({
      account: bank,
      entries,
      asOf: "2026-08-21",
      statementBalance: 12000,
      clearedEntryIds: ["le1"],
      extras: [],
    });
    expect(afterTick.uncleared).toHaveLength(1);
    expect(afterTick.uncleared[0]?.id).toBe("le2");
    expect(afterTick.expectedStatement).toBe(12000);
    expect(afterTick.balanced).toBe(true);
  });

  it("suggests a proof with the same amount and nearby date", () => {
    const hints = collectBrsProofHints([
      {
        orderNumber: "TT-104",
        paymentProof: {
          verified: true,
          uploadedAt: "2026-08-20T10:00:00.000Z",
          items: [
            {
              id: "pp1",
              url: "x",
              type: "image",
              uploadedAt: "2026-08-20T10:00:00.000Z",
              amount: 10000,
              payRef: "TT-104-P2",
              note: "UTR123",
            },
          ],
        },
      } as Order,
    ]);
    expect(hints[0]?.payRef).toBe("TT-104-P2");
    const hit = matchBrsProofHint(
      { date: "2026-08-21", debit: 10000, credit: 0 },
      hints
    );
    expect(hit?.utr).toBe("UTR123");
    expect(
      matchBrsProofHint({ date: "2026-08-21", debit: 0, credit: 10000 }, hints)
    ).toBeUndefined();
    expect(
      matchBrsProofHint({ date: "2026-09-10", debit: 10000, credit: 0 }, hints)
    ).toBeUndefined();
  });
});
