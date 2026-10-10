import { describe, expect, it } from "vitest";
import { ACCT } from "./accounting/seed";
import { buildOwnerCockpit } from "./owner-cockpit";
import type { AppDatabase } from "./store/db";
import type { Order } from "./types";

function emptyDb(): AppDatabase {
  return {
    users: [
      {
        id: "u1",
        name: "Ram",
        phone: "9000000001",
        passwordHash: "x",
        role: "super_admin",
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
    orders: [
      {
        id: "o1",
        number: "TT-1",
        userId: "d1",
        userName: "Kanpur Dealer",
        phone: "9000000002",
        status: "estimate",
        locale: "en",
        lines: [],
        estimatedTotal: 500,
        estimatedWeightKg: 10,
        createdAt: "2026-09-10T10:00:00.000Z",
        updatedAt: "2026-09-10T10:00:00.000Z",
      } as Order,
      {
        id: "o2",
        number: "TT-2",
        userId: "d1",
        userName: "Kanpur Dealer",
        phone: "9000000002",
        status: "confirmed",
        locale: "en",
        lines: [],
        estimatedTotal: 200,
        estimatedWeightKg: 4,
        createdAt: "2026-08-10T10:00:00.000Z",
        updatedAt: "2026-08-10T10:00:00.000Z",
      } as Order,
    ],
    schemes: [],
    walletTransactions: [],
    walletDeposits: [],
    shippingRules: [],
    categories: [],
    settings: { companyName: "TT", financialYearStartMonth: 4 } as AppDatabase["settings"],
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
    stockCounts: [],
    cashCounts: [],
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

describe("buildOwnerCockpit", () => {
  it("composes desk, month-scoped metrics, live queues, and the monthly audit", () => {
    const cockpit = buildOwnerCockpit(emptyDb(), {
      month: "2026-09",
      asOf: "2026-09-30",
    });
    expect(cockpit.month).toBe("2026-09");
    expect(cockpit.from).toBe("2026-09-01");
    expect(cockpit.to).toBe("2026-09-30");
    expect(cockpit.metrics.ordersCreated).toBe(1);
    expect(cockpit.queues.counts.need_confirm).toBe(1);
    expect(cockpit.desk.asOf).toBe("2026-09-30");
    expect(cockpit.desk.cash).toBe(1000);
    expect(cockpit.audit.month).toBe("2026-09");
    expect(cockpit.audit.stamp).toBeNull();
  });

  it("does not count orders outside the selected month in metrics", () => {
    const cockpit = buildOwnerCockpit(emptyDb(), { month: "2026-08" });
    expect(cockpit.metrics.ordersCreated).toBe(1);
    expect(cockpit.from).toBe("2026-08-01");
    expect(cockpit.to).toBe("2026-08-31");
  });
});
