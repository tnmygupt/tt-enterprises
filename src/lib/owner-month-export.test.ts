import { describe, expect, it } from "vitest";
import { ownerMonthReportSections, ownerMonthReportSheets } from "./owner-month-export";
import { buildOwnerMonthReport } from "./owner-month-report";
import type { AppDatabase } from "./store/db";
import { ACCT } from "./accounting/seed";

describe("owner month pack export", () => {
  it("emits P/L, cash flow, items, people, and audit sections", () => {
    const db = {
      users: [],
      products: [],
      orders: [],
      schemes: [],
      walletTransactions: [],
      walletDeposits: [],
      shippingRules: [],
      categories: [],
      settings: { companyName: "TT", financialYearStartMonth: 4 },
      accounts: [
        {
          id: ACCT.cash,
          code: "1001",
          name: { en: "Cash", hi: "नकद" },
          type: "asset",
          openingBalance: 0,
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
    } as unknown as AppDatabase;
    const report = buildOwnerMonthReport(db, "2026-09");
    const sections = ownerMonthReportSections(report);
    expect(sections.map((s) => s.title)).toEqual(
      expect.arrayContaining([
        "Profit & Loss",
        "Cash flow",
        "Item movement",
        "Dealers",
        "HR payroll",
        "Audit exceptions",
      ])
    );
    expect(ownerMonthReportSheets(report).length).toBe(sections.length);
    expect(ownerMonthReportSheets(report)[0]?.name.length).toBeLessThanOrEqual(31);
  });
});
