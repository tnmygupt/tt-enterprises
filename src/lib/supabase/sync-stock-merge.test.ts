import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../seed";
import { mergeLocalPendingIntoRemote } from "./sync";
import type { AppDatabase } from "../store/db";
import type { Order, Product } from "../types";

function product(stock: number, updatedAt: string): Product {
  return {
    id: "p1",
    code: "TARP",
    category: "tarpaulin",
    itemName: { en: "Tarpaulin", hi: "तिरपाल" },
    name: { en: "HDPE", hi: "एचडीपीई" },
    description: { en: "", hi: "" },
    unit: "kg",
    baseRate: 100,
    baseWeightKg: 35,
    pricingMode: "bundle",
    minOrderQty: 1,
    stock,
    stockSecondary: stock * 35,
    variations: [
      {
        id: "v1",
        label: { en: "12x18", hi: "12x18" },
        size: { en: "12x18", hi: "12x18" },
        sku: "T-1218",
        rate: 100,
        weightKg: 35,
        stock,
        stockSecondary: stock * 35,
      },
    ],
    colors: [{ id: "c1", name: { en: "Blue", hi: "नीला" }, hex: "#00f" }],
    stockMatrix: { "v1__c1": stock },
    media: [],
    active: true,
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt,
  };
}

function order(): Order {
  return {
    id: "ord_new",
    orderNumber: "TT-EST-00099-TEST",
    userId: "user_dealer",
    userName: "TEST DEALER",
    userEmail: "9250205615",
    status: "estimate",
    lines: [],
    subtotal: 0,
    shippingAmount: 0,
    walletUsed: 0,
    estimatedTotal: 0,
    stockReserved: true,
    fullTruckRequested: false,
    deliveryAddress: "Kanpur",
    checkoutName: "TEST DEALER",
    phone: "9250205615",
    timeline: [],
    createdAt: "2026-08-24T11:17:03.859Z",
    updatedAt: "2026-08-24T11:17:03.859Z",
  };
}

function db(partial: Partial<AppDatabase>): AppDatabase {
  return {
    users: [],
    products: [],
    orders: [],
    schemes: [],
    walletTransactions: [],
    walletDeposits: [],
    shippingRules: [],
    categories: [],
    settings: structuredClone(DEFAULT_SETTINGS),
    accounts: [],
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
    ...partial,
  };
}

describe("mergeLocalPendingIntoRemote after cloud estimate", () => {
  it("keeps cloud-deducted catalog stock after the client adds the new order locally", () => {
    const placed = order();
    const local = db({
      products: [product(10, "2026-08-24T10:00:00.000Z")],
      orders: [placed],
      stockMovements: [],
    });
    const remote = db({
      products: [product(8, "2026-08-24T11:17:03.860Z")],
      orders: [placed],
      stockMovements: [
        {
          id: "sm_reserve",
          date: "2026-08-24",
          type: "estimate_reserve",
          productId: "p1",
          variationId: "v1",
          colorId: "c1",
          qty: 2,
          secondaryQty: 70,
          unit: "kg",
          direction: "out",
          orderId: placed.id,
          note: "Reserved",
          createdAt: "2026-08-24T11:17:03.860Z",
          createdBy: "user_dealer",
        },
      ],
    });

    const merged = mergeLocalPendingIntoRemote(local, remote);
    expect(merged.products[0].stock).toBe(8);
    expect(merged.products[0].stockMatrix?.["v1__c1"]).toBe(8);
  });

  it("does not keep undeducted local catalog when dealer pull has no movement ledger", () => {
    const placed = order();
    const local = db({
      products: [product(10, "2026-08-24T10:00:00.000Z")],
      orders: [placed],
      stockMovements: [
        {
          id: "sm_local_leftover",
          date: "2026-08-24",
          type: "estimate_reserve",
          productId: "p1",
          qty: 1,
          direction: "out",
          createdAt: "2026-08-24T10:00:00.000Z",
          createdBy: "user_dealer",
        },
      ],
    });
    const remote = db({
      products: [product(8, "2026-08-24T11:32:34.165Z")],
      orders: [placed],
      stockMovements: [],
    });

    const merged = mergeLocalPendingIntoRemote(local, remote);
    expect(merged.products[0].stock).toBe(8);
    expect(merged.products[0].stockMatrix?.["v1__c1"]).toBe(8);
  });
});
