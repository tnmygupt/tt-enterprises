import { describe, expect, it } from "vitest";
import { ACCT } from "./accounting/seed";
import {
  buildOwnerMonthReport,
  itemMovementRollup,
} from "./owner-month-report";
import type { AppDatabase } from "./store/db";
import type {
  Account,
  LedgerEntry,
  Party,
  Product,
  StockBatch,
  StockMovement,
  Voucher,
} from "./types";

function account(
  id: string,
  code: string,
  name: string,
  type: Account["type"],
  opening = 0
): Account {
  return {
    id,
    code,
    name: { en: name, hi: name },
    type,
    openingBalance: opening,
    active: true,
  };
}

function entry(
  over: Partial<LedgerEntry> & Pick<LedgerEntry, "id" | "accountId" | "date">
): LedgerEntry {
  return {
    voucherId: over.voucherId || "v1",
    voucherNumber: over.voucherNumber || "SAL-1",
    voucherType: over.voucherType || "sale",
    debit: 0,
    credit: 0,
    voided: false,
    ...over,
  };
}

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
    products: [
      {
        id: "p1",
        code: "TARP",
        category: "tarpaulin",
        itemName: { en: "Tarpaulin", hi: "तिरपाल" },
        name: { en: "HDPE 12x18", hi: "एचडीपीई" },
        description: { en: "", hi: "" },
        unit: "kg",
        baseRate: 100,
        baseWeightKg: 35,
        pricingMode: "bundle",
        minOrderQty: 1,
        minStockLevel: 10,
        stock: 0,
        stockSecondary: 0,
        variations: [],
        colors: [],
        media: [],
        active: true,
        featured: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as Product,
    ],
    orders: [],
    schemes: [],
    walletTransactions: [],
    walletDeposits: [],
    shippingRules: [],
    categories: [
      {
        id: "tarpaulin",
        name: { en: "Tarpaulin", hi: "तिरपाल" },
        active: true,
      },
    ],
    settings: {
      companyName: "TT",
      financialYearStartMonth: 4,
    } as AppDatabase["settings"],
    accounts: [
      account(ACCT.cash, "1001", "Cash", "asset", 5000),
      account(ACCT.bank, "1002", "Bank", "asset", 20000),
      account(ACCT.debtors, "1100", "Debtors", "asset"),
      account(ACCT.creditors, "2100", "Creditors", "liability"),
      account(ACCT.sales, "4000", "Sales", "income"),
      account(ACCT.cogs, "5000", "COGS", "expense"),
      account(ACCT.purchase, "5001", "Purchase", "expense"),
      {
        id: "acct_plant",
        code: "1500",
        name: { en: "Plant & machinery", hi: "प्लांट" },
        type: "asset",
        openingBalance: 0,
        active: true,
      },
    ],
    parties: [
      {
        id: "c1",
        type: "customer",
        name: "Kanpur Dealer",
        phone: "9000000002",
        openingBalance: 0,
        creditLimit: 1000,
        active: true,
        createdAt: "2026-09-05T00:00:00.000Z",
        updatedAt: "2026-09-05T00:00:00.000Z",
      } as Party,
      {
        id: "s1",
        type: "supplier",
        name: "Jagdamba",
        phone: "9000000003",
        openingBalance: 0,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as Party,
    ],
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
    hrAdvances: [
      {
        id: "adv1",
        userId: "u1",
        date: "2026-09-10",
        amount: 1500,
        status: "issued",
        createdBy: "u1",
        createdAt: "2026-09-10T00:00:00.000Z",
      },
    ],
    hrPayslips: [
      {
        id: "ps1",
        userId: "u1",
        month: "2026-09",
        workingDays: 26,
        paidDays: 26,
        presentDays: 26,
        halfDays: 0,
        leavePaid: 0,
        leaveUnpaid: 0,
        absentDays: 0,
        lateDays: 0,
        otMinutes: 0,
        gross: 30000,
        otPay: 0,
        advances: 1500,
        net: 28500,
        createdAt: "2026-09-30T00:00:00.000Z",
        createdBy: "u1",
      },
    ],
    monthlyAudits: [],
  } as AppDatabase;
}

function saleVoucher(
  id: string,
  date: string,
  total: number,
  partyId = "c1",
  cogs = 0
): Voucher {
  return {
    id,
    number: id,
    type: "sale",
    date,
    partyId,
    total,
    subtotal: total,
    taxAmount: 0,
    outstanding: total,
    cogsAmount: cogs,
    voided: false,
    lines: [
      {
        id: `${id}-l`,
        itemLabel: "HDPE 12x18",
        qty: 1,
        rate: total,
        amount: total,
        productId: "p1",
      },
    ],
    createdAt: `${date}T10:00:00.000Z`,
    createdBy: "u1",
  };
}

describe("itemMovementRollup", () => {
  it("opens, receives, issues, and values closing stock per SKU", () => {
    const db = emptyDb();
    db.stockMovements = [
      {
        id: "m0",
        date: "2026-08-20",
        type: "grn",
        productId: "p1",
        qty: 10,
        secondaryQty: 10,
        direction: "in",
        createdAt: "2026-08-20T00:00:00.000Z",
        createdBy: "u1",
      },
      {
        id: "m1",
        date: "2026-09-02",
        type: "grn",
        productId: "p1",
        qty: 5,
        secondaryQty: 5,
        direction: "in",
        createdAt: "2026-09-02T00:00:00.000Z",
        createdBy: "u1",
      },
      {
        id: "m2",
        date: "2026-09-10",
        type: "sale",
        productId: "p1",
        qty: 4,
        secondaryQty: 4,
        direction: "out",
        createdAt: "2026-09-10T00:00:00.000Z",
        createdBy: "u1",
      },
    ] as StockMovement[];
    db.stockBatches = [
      {
        id: "b1",
        date: "2026-09-02",
        productId: "p1",
        qty: 11,
        originalQty: 15,
        rate: 80,
        source: "grn",
        createdAt: "2026-09-02T00:00:00.000Z",
      } as StockBatch,
    ];
    const rows = itemMovementRollup(db, "2026-09-01", "2026-09-30");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.opening).toBe(10);
    expect(rows[0]?.inbound).toBe(5);
    expect(rows[0]?.outbound).toBe(4);
    expect(rows[0]?.closing).toBe(11);
    expect(rows[0]?.value).toBe(880);
  });
});

describe("buildOwnerMonthReport", () => {
  it("compares P/L to prior month and same month last year", () => {
    const db = emptyDb();
    db.ledgerEntries = [
      entry({
        id: "e1",
        accountId: ACCT.sales,
        date: "2026-09-10",
        credit: 10000,
        voucherType: "sale",
      }),
      entry({
        id: "e2",
        accountId: ACCT.cogs,
        date: "2026-09-10",
        debit: 4000,
        voucherType: "sale",
      }),
      entry({
        id: "e3",
        accountId: ACCT.sales,
        date: "2026-08-10",
        credit: 7000,
        voucherId: "v2",
      }),
      entry({
        id: "e4",
        accountId: ACCT.cogs,
        date: "2026-08-10",
        debit: 3000,
        voucherId: "v2",
      }),
      entry({
        id: "e5",
        accountId: ACCT.sales,
        date: "2025-09-10",
        credit: 5000,
        voucherId: "v3",
      }),
      entry({
        id: "e6",
        accountId: ACCT.cogs,
        date: "2025-09-10",
        debit: 2000,
        voucherId: "v3",
      }),
    ];
    const report = buildOwnerMonthReport(db, "2026-09");
    expect(report.pl.income).toBe(10000);
    expect(report.pl.expense).toBe(4000);
    expect(report.pl.net).toBe(6000);
    expect(report.plPrior.net).toBe(4000);
    expect(report.plYearAgo.net).toBe(3000);
    expect(report.vsPrior.net).toBe(2000);
    expect(report.vsYearAgo.net).toBe(3000);
    expect(report.priorMonth).toBe("2026-08");
    expect(report.yearAgoMonth).toBe("2025-09");
  });

  it("rolls gross profit by item and category and ages open invoices", () => {
    const db = emptyDb();
    db.vouchers = [
      saleVoucher("sal1", "2026-09-05", 2000, "c1", 800),
      saleVoucher("sal_old", "2026-06-01", 2500, "c1", 0),
    ];
    db.vouchers[1]!.outstanding = 2500;
    db.ledgerEntries = [
      entry({
        id: "ar1",
        accountId: ACCT.debtors,
        date: "2026-06-01",
        debit: 2500,
        partyId: "c1",
        voucherId: "sal_old",
        voucherNumber: "sal_old",
      }),
    ];
    db.batchConsumptions = [
      {
        id: "bc1",
        date: "2026-09-05",
        voucherId: "sal1",
        productId: "p1",
        qty: 1,
        rate: 800,
        costAmount: 800,
        batchId: "b1",
        createdAt: "2026-09-05T00:00:00.000Z",
      },
    ];
    const report = buildOwnerMonthReport(db, "2026-09");
    expect(report.grossProfit.totals.sales).toBe(2000);
    expect(report.grossProfit.totals.cogs).toBe(800);
    expect(report.grossProfit.totals.profit).toBe(1200);
    expect(report.grossProfit.byItem[0]?.label).toBe("HDPE 12x18");
    expect(report.grossProfit.byCategory[0]?.key).toBe("tarpaulin");
    expect(report.grossProfit.byCategory[0]?.profit).toBe(1200);
    expect(report.receivables.total).toBe(4500);
    expect(report.receivables.overdueTotal).toBe(4500);
    expect(report.receivables.overdue.some((r) => r.daysOverdue > 80)).toBe(true);
    expect(report.dealers.newDealers.map((d) => d.id)).toContain("c1");
    expect(report.dealers.creditBreaches[0]?.overBy).toBe(1500);
    expect(report.hr.payrollNet).toBe(28500);
    expect(report.hr.advancesOutstanding).toBe(1500);
  });

  it("fills cash-flow investing from fixed-asset accounts", () => {
    const db = emptyDb();
    db.vouchers = [
      {
        id: "j1",
        number: "JRN-1",
        type: "journal",
        date: "2026-09-12",
        total: 8000,
        subtotal: 8000,
        taxAmount: 0,
        voided: false,
        lines: [
          {
            id: "j1-l",
            itemLabel: "Mixer",
            accountId: "acct_plant",
            qty: 1,
            rate: 8000,
            amount: 8000,
          },
        ],
        createdAt: "2026-09-12T00:00:00.000Z",
        createdBy: "u1",
      },
    ];
    db.ledgerEntries = [
      entry({
        id: "je1",
        voucherId: "j1",
        voucherNumber: "JRN-1",
        voucherType: "journal",
        accountId: "acct_plant",
        date: "2026-09-12",
        debit: 8000,
      }),
      entry({
        id: "je2",
        voucherId: "j1",
        voucherNumber: "JRN-1",
        voucherType: "journal",
        accountId: ACCT.bank,
        date: "2026-09-12",
        credit: 8000,
      }),
    ];
    const report = buildOwnerMonthReport(db, "2026-09");
    expect(report.cashFlow.investing.total).toBe(-8000);
    expect(report.cashFlow.investing.rows.find((r) => r.label.includes("Purchase"))?.amount).toBe(
      -8000
    );
    expect(report.bankClose).toBe(12000);
  });
});
