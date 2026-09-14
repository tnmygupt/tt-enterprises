import { describe, expect, it } from "vitest";
import {
  assertPriorMonthAudited,
  monthCloseObligation,
} from "./month-close-policy";
import type { AppDatabase } from "./store/db";
import type { Voucher } from "./types";

function dbWithSepBooks(): AppDatabase {
  return {
    users: [],
    products: [],
    orders: [],
    schemes: [],
    walletTransactions: [],
    walletDeposits: [],
    shippingRules: [],
    categories: [],
    settings: {
      companyName: "TT",
      monthAuditPolicy: "escalating",
      monthAuditGraceDays: 0,
    } as AppDatabase["settings"],
    accounts: [],
    parties: [],
    vouchers: [
      {
        id: "v1",
        number: "SAL-1",
        type: "sale",
        date: "2026-09-10",
        total: 100,
        subtotal: 100,
        taxAmount: 0,
        voided: false,
        lines: [],
        createdAt: "2026-09-10T00:00:00.000Z",
        createdBy: "u1",
      } as Voucher,
    ],
    ledgerEntries: [],
    stockMovements: [],
    stockBatches: [],
    batchConsumptions: [],
    billAllocations: [],
    purchaseOrders: [],
    goodsReceipts: [],
    supplierContracts: [],
    tallyPosts: [],
    statementMatches: [],
    accessPlaces: [],
    stockCounts: [
      {
        id: "sc1",
        month: "2026-09",
        status: "submitted",
        startedBy: "u1",
        startedAt: "2026-09-01T00:00:00.000Z",
        submittedAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
        lines: [
          {
            id: "l1",
            productId: "p1",
            label: "HDPE",
            bookQty: 10,
            countedQty: 6,
            counted: true,
            unitRate: 100,
          },
        ],
      },
    ],
    cashCounts: [
      {
        id: "cc1",
        month: "2026-09",
        status: "submitted",
        startedBy: "u1",
        startedAt: "2026-09-01T00:00:00.000Z",
        bookCash: 1000,
        bookBank: 0,
        countedCash: 800,
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    ],
    hrPunches: [],
    hrTerms: [],
    hrShifts: [],
    hrSites: [],
    hrLeaves: [],
    hrAdvances: [],
    hrPayslips: [],
    monthlyAudits: [],
  } as AppDatabase;
}

describe("monthCloseObligation", () => {
  it("is ok before the last IST week of the month", () => {
    const ob = monthCloseObligation(
      dbWithSepBooks(),
      new Date("2026-09-20T06:00:00.000Z") // 11:30 IST 20 Sep
    );
    expect(ob.month).toBe("2026-09");
    expect(ob.inLastWeek).toBe(false);
    expect(ob.state).toBe("ok");
  });

  it("is due in the last 7 IST days and lists month-close blockers", () => {
    const ob = monthCloseObligation(
      dbWithSepBooks(),
      new Date("2026-09-24T18:40:00.000Z") // 25 Sep 00:10 IST
    );
    expect(ob.inLastWeek).toBe(true);
    expect(ob.state).toBe("due");
    expect(ob.blockers).toContain("pendingShortages");
    expect(ob.blockers).toContain("cashNotAccepted");
  });

  it("blocks the new month after month-end until stamped", () => {
    const ob = monthCloseObligation(
      dbWithSepBooks(),
      new Date("2026-10-01T00:00:00.000Z") // 05:30 IST 1 Oct
    );
    expect(ob.month).toBe("2026-09");
    expect(ob.state).toBe("blocking");
  });

  it("stays overdue instead of blocking when the owner records an override", () => {
    const db = dbWithSepBooks();
    db.settings.monthAuditOverrides = [
      {
        month: "2026-09",
        by: "u1",
        at: "2026-10-01T06:00:00.000Z",
        reason: "Need to bill Diwali orders",
      },
    ];
    const ob = monthCloseObligation(db, new Date("2026-10-01T06:00:00.000Z"));
    expect(ob.state).toBe("overdue");
    expect(ob.override?.reason).toMatch(/Diwali/);
  });

  it("never blocks under reminder policy", () => {
    const db = dbWithSepBooks();
    db.settings.monthAuditPolicy = "reminder";
    const ob = monthCloseObligation(db, new Date("2026-10-02T06:00:00.000Z"));
    expect(ob.state).toBe("overdue");
  });
});

describe("assertPriorMonthAudited", () => {
  it("never throws for a sale dated inside the unaudited month", () => {
    const db = dbWithSepBooks();
    expect(() =>
      assertPriorMonthAudited("2026-09-28", db, new Date("2026-09-28T06:00:00.000Z"))
    ).not.toThrow();
    expect(() =>
      assertPriorMonthAudited("2026-09-30", db, new Date("2026-10-02T06:00:00.000Z"))
    ).not.toThrow();
  });

  it("throws for a new-month voucher until override or stamp", () => {
    const db = dbWithSepBooks();
    expect(() =>
      assertPriorMonthAudited("2026-10-01", db, new Date("2026-10-01T06:00:00.000Z"))
    ).toThrow(/2026-09/);
    db.settings.monthAuditOverrides = [
      {
        month: "2026-09",
        by: "u1",
        at: "2026-10-01T06:00:00.000Z",
        reason: "billing",
      },
    ];
    expect(() =>
      assertPriorMonthAudited("2026-10-01", db, new Date("2026-10-01T06:00:00.000Z"))
    ).not.toThrow();
  });

  it("does not block when the prior month has no books", () => {
    const db = dbWithSepBooks();
    db.vouchers = [];
    db.stockCounts = [];
    db.cashCounts = [];
    expect(() =>
      assertPriorMonthAudited("2026-10-01", db, new Date("2026-10-01T06:00:00.000Z"))
    ).not.toThrow();
  });
  it("waits grace days before escalating to blocking", () => {
    const db = dbWithSepBooks();
    db.settings.monthAuditGraceDays = 3;
    const during = monthCloseObligation(
      db,
      new Date("2026-10-02T06:00:00.000Z")
    );
    expect(during.state).toBe("overdue");
    const after = monthCloseObligation(
      db,
      new Date("2026-10-04T06:00:00.000Z")
    );
    expect(after.state).toBe("blocking");
  });
});
