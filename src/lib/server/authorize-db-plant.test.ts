import { describe, expect, it } from "vitest";
import { staffScopedProjection } from "./authorize-db";
import type { AppDatabase } from "@/lib/store/db";
import type { Party, Product, PurchaseOrder, UserProfile, Voucher } from "@/lib/types";

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

function dbStub(): AppDatabase {
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
  const customer: Party = {
    id: "cus1",
    name: "Dealer",
    phone: "9000000001",
    type: "customer",
    openingBalance: 500,
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
  const voucher: Voucher = {
    id: "v1",
    number: "P-1",
    type: "purchase",
    date: "2026-08-01",
    partyId: "sup1",
    lines: [],
    subtotal: 100,
    taxAmount: 0,
    total: 100,
    voided: false,
    createdBy: "t",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  return {
    users: [plant],
    products: [product],
    orders: [],
    schemes: [],
    walletTransactions: [],
    walletDeposits: [],
    shippingRules: [],
    categories: [],
    settings: { companyName: "TT" } as AppDatabase["settings"],
    accounts: [],
    parties: [supplier, customer],
    vouchers: [voucher],
    ledgerEntries: [
      {
        id: "e1",
        voucherId: "v1",
        voucherNumber: "P-1",
        voucherType: "purchase",
        date: "2026-08-01",
        accountId: "cash",
        debit: 100,
        credit: 0,
        voided: false,
      },
    ],
    stockMovements: [
      {
        id: "m1",
        date: "2026-08-01",
        productId: "p1",
        type: "adjustment",
        direction: "out",
        qty: 1,
        createdBy: "t",
        createdAt: "2026-08-01T00:00:00.000Z",
      },
    ],
    stockBatches: [],
    batchConsumptions: [],
    billAllocations: [],
    purchaseOrders: [po],
    goodsReceipts: [
      {
        id: "g1",
        number: "GRN-1",
        poId: "po1",
        date: "2026-08-01",
        lines: [],
        createdBy: "t",
        createdAt: "2026-08-01T00:00:00.000Z",
        voided: false,
      },
    ],
    supplierContracts: [
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
    ],
    tallyPosts: [],
    statementMatches: [],
    accessPlaces: [],
  } as AppDatabase;
}

describe("staffScopedProjection plant manager", () => {
  it("keeps catalog, supplier parties, draft POs and stock, not books", () => {
    const db = dbStub();
    const out = staffScopedProjection(db, { role: "plant_manager" });
    expect(out.products).toHaveLength(1);
    expect(out.purchaseOrders.map((p) => p.id)).toEqual(["po1"]);
    expect(out.stockMovements).toHaveLength(1);
    expect(out.supplierContracts).toHaveLength(1);
    expect(out.parties).toHaveLength(2);
    expect(out.parties.some((p) => p.type === "supplier")).toBe(true);
    expect(out.parties.some((p) => p.type === "customer")).toBe(true);
    expect(out.peopleActivity ?? []).toEqual([]);
    expect(out.vouchers).toEqual([]);
    expect(out.ledgerEntries).toEqual([]);
    expect(out.accounts).toEqual([]);
    expect(out.goodsReceipts).toEqual([]);
    expect(out.products[0].baseRate).toBe(100);
    expect(out.supplierContracts[0].rate).toBe(0);
    expect(out.purchaseOrders[0].total).toBe(0);
    expect(out.purchaseOrders[0].lines[0].rate).toBe(0);
    expect(out.parties[0].openingBalance).toBe(0);
  });

  it("owner still receives mill rates", () => {
    const db = dbStub();
    const out = staffScopedProjection(db, { role: "super_admin" });
    expect(out.supplierContracts[0].rate).toBe(90);
    expect(out.purchaseOrders[0].lines[0].rate).toBe(88);
    expect(out.vouchers[0].total).toBe(100);
  });
});
