import { describe, expect, it } from "vitest";
import {
  applyOrderEstimateStock,
  getSizeColorStock,
  orderLineSecondaryQty,
  rebalanceOrderReservation,
} from "./inventory";
import { DEFAULT_SETTINGS } from "./seed";
import { placeEstimateOnDatabase } from "./place-estimate";
import type { AppDatabase } from "./store/db";
import type { Product, UserProfile } from "./types";

function makeProduct(): Product {
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
    stock: 10,
    stockSecondary: 350,
    variations: [
      {
        id: "v1",
        label: { en: "12x18", hi: "12x18" },
        size: { en: "12x18", hi: "12x18" },
        sku: "T-1218",
        rate: 100,
        weightKg: 35,
        stock: 10,
        stockSecondary: 350,
      },
    ],
    colors: [{ id: "c1", name: { en: "Blue", hi: "नीला" }, hex: "#00f" }],
    stockMatrix: { "v1__c1": 10 },
    media: [],
    active: true,
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeDealer(): UserProfile {
  return {
    id: "user_dealer",
    passwordHash: "x",
    name: "TEST DEALER",
    phone: "9250205615",
    role: "customer",
    locale: "en",
    walletBalance: 0,
    assignedSchemeIds: [],
    liftingProgressKg: 0,
    schemeProgress: {},
    active: true,
    approved: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function emptyDb(): AppDatabase {
  return {
    users: [makeDealer()],
    products: [makeProduct()],
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
  };
}

describe("placeEstimateOnDatabase", () => {
  it("creates an estimate, reserves stock, and numbers the order", () => {
    const db = emptyDb();
    const order = placeEstimateOnDatabase(db, {
      userId: "user_dealer",
      cart: [
        {
          key: "p1-v1-c1",
          productId: "p1",
          variationId: "v1",
          colorId: "c1",
          quantity: 2,
          weightKg: 70,
        },
      ],
      deliveryAddress: "Kanpur — PIN 208001",
      checkoutName: "TEST DEALER",
      phone: "9250205615",
      walletToUse: 0,
      fullTruckRequested: false,
    });
    expect(order.status).toBe("estimate");
    expect(order.orderNumber).toMatch(/^TT-EST-00001-/);
    expect(order.stockReserved).toBe(true);
    expect(db.orders).toHaveLength(1);
    expect(db.stockMovements.some((m) => m.type === "estimate_reserve")).toBe(
      true
    );
    expect(db.products[0].stock).toBe(8);
    expect(getSizeColorStock(db.products[0], "v1", "c1")).toBe(8);
  });

  it("blocks a second estimate that would oversell, then restores bundles on release", () => {
    const db = emptyDb();
    const base = {
      userId: "user_dealer",
      deliveryAddress: "Kanpur — PIN 208001",
      checkoutName: "TEST DEALER",
      phone: "9250205615",
      walletToUse: 0,
      fullTruckRequested: false,
    } as const;
    const cart = (
      quantity: number
    ): Parameters<typeof placeEstimateOnDatabase>[1]["cart"] => [
      {
        key: "p1-v1-c1",
        productId: "p1",
        variationId: "v1",
        colorId: "c1",
        quantity,
        weightKg: quantity * 35,
      },
    ];

    const first = placeEstimateOnDatabase(db, { ...base, cart: cart(2) });
    expect(getSizeColorStock(db.products[0], "v1", "c1")).toBe(8);

    expect(() =>
      placeEstimateOnDatabase(db, { ...base, cart: cart(9) })
    ).toThrow(/Insufficient stock/);
    expect(getSizeColorStock(db.products[0], "v1", "c1")).toBe(8);
    expect(db.orders).toHaveLength(1);

    const second = placeEstimateOnDatabase(db, { ...base, cart: cart(8) });
    expect(second.stockReserved).toBe(true);
    expect(getSizeColorStock(db.products[0], "v1", "c1")).toBe(0);

    applyOrderEstimateStock(db, first, "user_dealer", "release");
    expect(getSizeColorStock(db.products[0], "v1", "c1")).toBe(2);
  });

  it("packing actual-weight rebalance does not put bundles back", () => {
    const db = emptyDb();
    const order = placeEstimateOnDatabase(db, {
      userId: "user_dealer",
      cart: [
        {
          key: "p1-v1-c1",
          productId: "p1",
          variationId: "v1",
          colorId: "c1",
          quantity: 2,
          weightKg: 70,
        },
      ],
      deliveryAddress: "Kanpur — PIN 208001",
      checkoutName: "TEST DEALER",
      phone: "9250205615",
      walletToUse: 0,
      fullTruckRequested: false,
    });
    const reservedSecondary = order.lines.map((line) =>
      orderLineSecondaryQty(db, line)
    );
    expect(reservedSecondary[0]).toBe(70);

    order.lines[0].weightKg = 12;
    rebalanceOrderReservation(db, order, reservedSecondary, "staff1");

    expect(getSizeColorStock(db.products[0], "v1", "c1")).toBe(8);
    expect(db.products[0].stock).toBe(8);
    const weightMove = db.stockMovements.find(
      (m) => m.type === "estimate_release" && m.qty === 0
    );
    expect(weightMove?.secondaryQty).toBe(58);
  });

  it("rejects unapproved dealers", () => {
    const db = emptyDb();
    db.users[0].approved = false;
    expect(() =>
      placeEstimateOnDatabase(db, {
        userId: "user_dealer",
        cart: [
          {
            key: "p1-v1-c1",
            productId: "p1",
            variationId: "v1",
            colorId: "c1",
            quantity: 1,
            weightKg: 35,
          },
        ],
        deliveryAddress: "Kanpur — PIN 208001",
        checkoutName: "TEST DEALER",
        phone: "9250205615",
        walletToUse: 0,
        fullTruckRequested: false,
      })
    ).toThrow(/pending approval/i);
  });
});
