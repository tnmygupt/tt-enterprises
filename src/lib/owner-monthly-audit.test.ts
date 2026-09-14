import { describe, expect, it } from "vitest";
import { ACCT } from "./accounting/seed";
import { buildMonthlyAuditReport, monthCloseReady } from "./owner-monthly-audit";
import type { AppDatabase } from "./store/db";

function emptyDb(): AppDatabase {
  return {
    users: [
      {
        id: "u1",
        name: "Ram",
        phone: "9000000001",
        passwordHash: "x",
        role: "dispatch",
        locale: "en",
        walletBalance: 0,
        assignedSchemeIds: [],
        liftingProgressKg: 0,
        schemeProgress: {},
        active: true,
        approved: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    products: [],
    orders: [],
    schemes: [],
    walletTransactions: [],
    walletDeposits: [],
    shippingRules: [],
    categories: [],
    settings: { companyName: "TT" } as AppDatabase["settings"],
    accounts: [
      {
        id: ACCT.cash,
        code: "CASH",
        name: { en: "Cash", hi: "नकद" },
        type: "asset",
        openingBalance: 1000,
        active: true,
      },
    ],
    parties: [],
    vouchers: [],
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
            label: "HDPE 12x18",
            bookQty: 10,
            countedQty: 6,
            counted: true,
            unitRate: 100,
          },
          {
            id: "l2",
            productId: "p2",
            label: "Shade 90",
            bookQty: 5,
            counted: false,
          },
          {
            id: "l3",
            productId: "p3",
            label: "Rope",
            bookQty: 2,
            countedQty: 4,
            counted: true,
            unitRate: 40,
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
        statementBank: 0,
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    ],
    hrPunches: [
      {
        id: "p1",
        userId: "u1",
        kind: "in",
        at: "2026-09-03T03:40:00.000Z",
        insideFence: false,
        weakGps: true,
        accuracyM: 250,
        createdAt: "2026-09-03T03:40:00.000Z",
      },
    ],
    hrTerms: [],
    hrShifts: [],
    hrSites: [],
    hrLeaves: [],
    hrAdvances: [],
    hrPayslips: [],
    monthlyAudits: [],
  } as AppDatabase;
}

describe("monthly owner audit", () => {
  it("leads with stock shortage value, cash short, and GPS flags", () => {
    const report = buildMonthlyAuditReport(emptyDb(), "2026-09");
    expect(report.stockShortages[0]?.shortageValue).toBe(400);
    expect(report.stockShortages[0]?.variance).toBe(-4);
    expect(report.cash?.cashDiff).toBe(-200);
    expect(report.gpsFlags.length).toBeGreaterThan(0);
    expect(report.gpsFlags[0]?.insideFence).toBe(false);
    expect(report.uncountedLines.map((l) => l.label)).toEqual(["Shade 90"]);
    expect(report.surplusLines[0]?.label).toBe("Rope");
    expect(report.surplusLines[0]?.variance).toBe(2);
    expect(report.stamp).toBeNull();
    expect(report.ready.ready).toBe(false);
    expect(report.ready.reasons).toContain("pendingShortages");
    expect(report.ready.reasons).toContain("cashNotAccepted");
  });

  it("is ready to stamp when shortages are decided and cash is accepted", () => {
    const db = emptyDb();
    db.stockCounts[0]!.lines = db.stockCounts[0]!.lines.map((l) => ({
      ...l,
      counted: true,
      countedQty: l.countedQty ?? l.bookQty,
      ownerDecision: "approved",
    }));
    db.cashCounts[0]!.ownerDecision = "approved";
    const ready = monthCloseReady({
      stock: db.stockCounts[0],
      cash: db.cashCounts[0],
    });
    expect(ready.ready).toBe(true);
    db.monthlyAudits = [
      {
        id: "ma_2026-09",
        month: "2026-09",
        closedAt: "2026-09-30T00:00:00.000Z",
        closedBy: "u1",
      },
    ];
    const report = buildMonthlyAuditReport(db, "2026-09");
    expect(report.stamp?.closedByName).toBe("Ram");
    expect(report.ready.ready).toBe(true);
  });
});
