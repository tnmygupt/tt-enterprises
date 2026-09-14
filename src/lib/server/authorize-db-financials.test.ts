import { describe, expect, it } from "vitest";
import {
  mergeAuthorizedPush,
  staffScopedProjection,
} from "./authorize-db";
import type { AppDatabase } from "@/lib/store/db";
import type {
  Party,
  Product,
  PurchaseOrder,
  UserProfile,
  Voucher,
} from "@/lib/types";
import type { ServerSession } from "./session";
import { ACCT } from "@/lib/accounting/seed";

function user(partial: Partial<UserProfile> & Pick<UserProfile, "id" | "role">): UserProfile {
  return {
    passwordHash: "x",
    name: partial.name || "N",
    phone: partial.phone || "9000000000",
    locale: "en",
    walletBalance: 0,
    assignedSchemeIds: [],
    liftingProgressKg: 0,
    schemeProgress: {},
    active: true,
    approved: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function emptyDb(users: UserProfile[]): AppDatabase {
  return {
    users,
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
        id: ACCT.purchase,
        code: "PUR",
        name: { en: "Purchase", hi: "खरीद" },
        type: "expense",
        openingBalance: 50,
        active: true,
      },
      {
        id: ACCT.sales,
        code: "SAL",
        name: { en: "Sales", hi: "बिक्री" },
        type: "income",
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
  } as AppDatabase;
}

const plantSession: ServerSession = {
  id: "plant",
  phone: "9000000000",
  name: "Plant",
  role: "plant_manager",
  locale: "en",
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe("staff GET hides owner cost numbers", () => {
  it("accounts staff keep sale totals but not purchase rates or COGS", () => {
    const accounts = user({ id: "acc", role: "accounts", name: "Books" });
    const db = emptyDb([accounts]);
    const sale: Voucher = {
      id: "v-sale",
      number: "S-1",
      type: "sale",
      date: "2026-08-01",
      lines: [{ id: "sl", itemLabel: "Tarp", qty: 1, rate: 200, amount: 200 }],
      subtotal: 200,
      taxAmount: 0,
      total: 200,
      cogsAmount: 90,
      voided: false,
      createdBy: "t",
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    const purchase: Voucher = {
      id: "v-pur",
      number: "P-1",
      type: "purchase",
      date: "2026-08-01",
      lines: [{ id: "pl", itemLabel: "Mill", qty: 1, rate: 88, amount: 88 }],
      subtotal: 88,
      taxAmount: 0,
      total: 88,
      voided: false,
      createdBy: "t",
      createdAt: "2026-08-01T00:00:00.000Z",
    };
    db.vouchers = [sale, purchase];
    db.ledgerEntries = [
      {
        id: "e1",
        voucherId: "v-pur",
        voucherNumber: "P-1",
        voucherType: "purchase",
        date: "2026-08-01",
        accountId: ACCT.purchase,
        debit: 88,
        credit: 0,
        voided: false,
      },
      {
        id: "e2",
        voucherId: "v-sale",
        voucherNumber: "S-1",
        voucherType: "sale",
        date: "2026-08-01",
        accountId: ACCT.sales,
        debit: 0,
        credit: 200,
        voided: false,
      },
    ];
    const out = staffScopedProjection(db, { role: "accounts" });
    const saleOut = out.vouchers.find((v) => v.id === "v-sale")!;
    const purOut = out.vouchers.find((v) => v.id === "v-pur")!;
    expect(saleOut.total).toBe(200);
    expect(saleOut.cogsAmount).toBeUndefined();
    expect(purOut.total).toBe(0);
    expect(purOut.lines[0].rate).toBe(0);
    expect(out.ledgerEntries.find((e) => e.id === "e1")?.debit).toBe(0);
    expect(out.ledgerEntries.find((e) => e.id === "e2")?.credit).toBe(200);
    expect(out.accounts.find((a) => a.id === ACCT.purchase)?.openingBalance).toBe(
      0
    );
  });
});

describe("staff PUT cannot wipe mill rates", () => {
  it("keeps cloud PO rates when plant confirms a scrubbed draft", () => {
    const plant = user({ id: "plant", role: "plant_manager", name: "Plant" });
    const product = {
      id: "p1",
      code: "SKU1",
      name: { en: "Tarpaulin", hi: "तिरपाल" },
      itemName: { en: "Tarpaulin", hi: "तिरपाल" },
      description: { en: "", hi: "" },
      category: "hdpe",
      unit: "kg",
      baseRate: 100,
      pricingMode: "bundle",
      stock: 4,
      minStockLevel: 10,
      preferredSupplierId: "sup1",
      active: true,
      featured: false,
      variations: [],
      colors: [],
      media: [],
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as Product;
    const supplier: Party = {
      id: "sup1",
      name: "Mill",
      phone: "9876543210",
      type: "supplier",
      openingBalance: 999,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const po: PurchaseOrder = {
      id: "po1",
      number: "PO-1001",
      supplierId: "sup1",
      date: "2026-08-01",
      status: "draft",
      lines: [
        {
          id: "l1",
          productId: "p1",
          itemLabel: "Tarpaulin",
          qty: 20,
          rate: 88,
          amount: 1760,
        },
      ],
      total: 1760,
      createdAt: "2026-08-01T00:00:00.000Z",
      createdBy: "cron_reorder",
    };
    const cloud = emptyDb([plant]);
    cloud.products = [product];
    cloud.parties = [supplier];
    cloud.purchaseOrders = [po];
    cloud.supplierContracts = [
      {
        id: "c1",
        number: "SC-1",
        supplierId: "sup1",
        date: "2026-01-01",
        validFrom: "2026-01-01",
        scope: "product",
        productId: "p1",
        itemLabel: "Tarpaulin",
        rate: 90,
        unit: "kg",
        contractedQty: 100,
        usedQty: 0,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        createdBy: "t",
      },
    ];

    const incoming = JSON.parse(JSON.stringify(cloud)) as AppDatabase;
    incoming.purchaseOrders[0] = {
      ...incoming.purchaseOrders[0],
      status: "ordered",
      total: 0,
      lines: incoming.purchaseOrders[0].lines.map((l) => ({
        ...l,
        rate: 0,
        amount: 0,
      })),
    };
    incoming.supplierContracts[0] = {
      ...incoming.supplierContracts[0],
      rate: 0,
    };

    const { db: out } = mergeAuthorizedPush(incoming, cloud, plantSession);
    expect(out.purchaseOrders[0].status).toBe("ordered");
    expect(out.purchaseOrders[0].lines[0].rate).toBe(88);
    expect(out.purchaseOrders[0].total).toBe(1760);
    expect(out.supplierContracts[0].rate).toBe(90);
    expect(out.parties[0].openingBalance).toBe(999);
  });
});

describe("staff GET keeps only own HR rows", () => {
  it("accounts cannot read another person's salary, punches or advances", () => {
    const accounts = user({ id: "acc", role: "accounts", name: "Books" });
    const other = user({ id: "sales1", role: "sales", name: "Sales" });
    const db = emptyDb([accounts, other]);
    db.hrTerms = [
      {
        id: "ht1",
        userId: "acc",
        payBasis: "monthly",
        monthlySalary: 25000,
        otRatePerHour: 100,
        joinDate: "2026-01-01",
        weekOff: 0,
        casualDaysPerYear: 6,
        sickDaysPerYear: 6,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "ht2",
        userId: "sales1",
        payBasis: "monthly",
        monthlySalary: 18000,
        otRatePerHour: 80,
        joinDate: "2026-01-01",
        weekOff: 0,
        casualDaysPerYear: 6,
        sickDaysPerYear: 6,
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    db.hrPunches = [
      {
        id: "p1",
        userId: "acc",
        kind: "in",
        at: "2026-09-01T03:30:00.000Z",
        insideFence: true,
        createdAt: "2026-09-01T03:30:00.000Z",
      },
      {
        id: "p2",
        userId: "sales1",
        kind: "in",
        at: "2026-09-01T03:40:00.000Z",
        insideFence: true,
        createdAt: "2026-09-01T03:40:00.000Z",
      },
    ];
    db.hrAdvances = [
      {
        id: "a1",
        userId: "acc",
        date: "2026-09-01",
        amount: 500,
        createdBy: "owner",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "a2",
        userId: "sales1",
        date: "2026-09-01",
        amount: 900,
        createdBy: "owner",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    db.hrPayslips = [
      {
        id: "ps1",
        userId: "acc",
        month: "2026-09",
        workingDays: 26,
        paidDays: 26,
        presentDays: 26,
        halfDays: 0,
        leavePaid: 0,
        leaveUnpaid: 0,
        absentDays: 0,
        lateDays: 0,
        otMinutes: 60,
        gross: 25000,
        otPay: 100,
        advances: 500,
        net: 24600,
        createdAt: "2026-09-30T00:00:00.000Z",
        createdBy: "owner",
      },
      {
        id: "ps2",
        userId: "sales1",
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
        gross: 18000,
        otPay: 0,
        advances: 0,
        net: 18000,
        createdAt: "2026-09-30T00:00:00.000Z",
        createdBy: "owner",
      },
    ];
    const out = staffScopedProjection(db, { id: "acc", role: "accounts" });
    expect(out.hrTerms.map((t) => t.userId)).toEqual(["acc"]);
    expect(out.hrTerms[0].monthlySalary).toBe(0);
    expect(out.hrTerms[0].otRatePerHour).toBe(100);
    expect(out.hrPunches.map((p) => p.userId)).toEqual(["acc"]);
    expect(out.hrAdvances.map((a) => a.userId)).toEqual(["acc"]);
    expect(out.hrPayslips.map((p) => p.userId)).toEqual(["acc"]);
    expect(out.hrPayslips[0].gross).toBe(0);
    expect(out.hrPayslips[0].net).toBe(0);
    expect(out.hrPayslips[0].otPay).toBe(100);
    expect(out.hrPayslips[0].advances).toBe(500);
  });
});

describe("staff HR advance push", () => {
  const salesSession: ServerSession = {
    id: "sales1",
    phone: "9000000001",
    name: "Sales",
    role: "sales",
    locale: "en",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };

  it("lets staff insert only their own pending advance", () => {
    const sales = user({ id: "sales1", role: "sales", name: "Sales" });
    const other = user({ id: "acc", role: "accounts", name: "Books" });
    const cloud = emptyDb([sales, other]);
    cloud.hrAdvances = [
      {
        id: "a1",
        userId: "acc",
        date: "2026-09-01",
        amount: 500,
        status: "issued",
        createdBy: "owner",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const incoming = JSON.parse(JSON.stringify(cloud)) as AppDatabase;
    incoming.hrAdvances = [
      ...incoming.hrAdvances,
      {
        id: "a-new",
        userId: "sales1",
        date: "2026-09-10",
        amount: 200,
        status: "pending",
        createdBy: "sales1",
        createdAt: "2026-09-10T00:00:00.000Z",
      },
    ];
    const { db: out } = mergeAuthorizedPush(incoming, cloud, salesSession);
    expect(out.hrAdvances.some((a) => a.id === "a-new" && a.status === "pending")).toBe(
      true
    );
    expect(out.hrAdvances.find((a) => a.id === "a1")?.amount).toBe(500);
  });

  it("rejects staff inventing an issued advance or another person's pending row", () => {
    const sales = user({ id: "sales1", role: "sales", name: "Sales" });
    const other = user({ id: "acc", role: "accounts", name: "Books" });
    const cloud = emptyDb([sales, other]);
    cloud.hrAdvances = [
      {
        id: "a1",
        userId: "acc",
        date: "2026-09-01",
        amount: 500,
        status: "issued",
        createdBy: "owner",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const incoming = JSON.parse(JSON.stringify(cloud)) as AppDatabase;
    incoming.hrAdvances = [
      {
        ...incoming.hrAdvances[0],
        amount: 1,
      },
      {
        id: "a-issued",
        userId: "sales1",
        date: "2026-09-10",
        amount: 999,
        status: "issued",
        createdBy: "sales1",
        createdAt: "2026-09-10T00:00:00.000Z",
      },
      {
        id: "a-other",
        userId: "acc",
        date: "2026-09-10",
        amount: 50,
        status: "pending",
        createdBy: "sales1",
        createdAt: "2026-09-10T00:00:00.000Z",
      },
    ];
    const { db: out } = mergeAuthorizedPush(incoming, cloud, salesSession);
    expect(out.hrAdvances.map((a) => a.id)).toEqual(["a1"]);
    expect(out.hrAdvances[0]?.amount).toBe(500);
  });
});
