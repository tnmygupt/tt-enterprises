import { describe, expect, it } from "vitest";
import {
  computeReorderSuggestion,
  parseSeasonMonthsFromText,
  roundUpToMultiple,
  stockAlerts,
} from "./analysis";
import type {
  AppSettings,
  Order,
  Product,
  PurchaseOrder,
  StockMovement,
} from "../types";

function product(over: Partial<Product> = {}): Product {
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
    minStockLevel: 5,
    stock: 0,
    stockSecondary: 0,
    variations: [],
    colors: [],
    media: [],
    active: true,
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function movement(over: Partial<StockMovement> = {}): StockMovement {
  return {
    id: "m1",
    date: "2026-07-01",
    type: "sale",
    productId: "p1",
    qty: 30,
    direction: "out",
    createdAt: "2026-07-01T00:00:00.000Z",
    createdBy: "u1",
    ...over,
  };
}

function settings(over: Partial<AppSettings> = {}): AppSettings {
  return {
    companyName: "TT",
    autoReorderUseVelocity: true,
    autoReorderLookbackDays: 30,
    autoReorderLeadTimeDays: 10,
    autoReorderSafetyDays: 7,
    autoReorderSeasonMonths: [5, 6, 7, 8, 9],
    autoReorderSeasonMultiplier: 1.4,
    ...over,
  } as AppSettings;
}

describe("computeReorderSuggestion", () => {
  it("uses velocity × cover days × season when lookback has OUT", () => {
    const row = computeReorderSuggestion({
      onHand: 0,
      staffMin: 5,
      avgDailyOut: 1,
      hadVelocity: true,
      coverDays: 17,
      season: 1.4,
      committed: 0,
      incoming: 0,
      useVelocity: true,
    });
    expect(row.triggerMin).toBe(24);
    expect(row.suggestedQty).toBe(24);
    expect(row.coverMode).toBe("velocity");
  });

  it("nets incoming PO remaining", () => {
    const row = computeReorderSuggestion({
      onHand: 1,
      staffMin: 5,
      avgDailyOut: 0,
      hadVelocity: false,
      coverDays: 17,
      season: 1,
      committed: 0,
      incoming: 10,
      useVelocity: true,
    });
    expect(row.suggestedQty).toBe(0);
    expect(row.coverMode).toBe("min");
  });

  it("adds committed open-estimate qty", () => {
    const row = computeReorderSuggestion({
      onHand: 10,
      staffMin: 5,
      avgDailyOut: 0,
      hadVelocity: false,
      coverDays: 17,
      season: 1,
      committed: 8,
      incoming: 0,
      useVelocity: true,
    });
    expect(row.suggestedQty).toBe(3);
  });

  it("rounds up to MOQ when minOrderQty > 1", () => {
    const row = computeReorderSuggestion({
      onHand: 0,
      staffMin: 5,
      avgDailyOut: 0,
      hadVelocity: false,
      coverDays: 17,
      season: 1,
      committed: 0,
      incoming: 0,
      minOrderQty: 10,
      useVelocity: true,
    });
    expect(row.suggestedQty).toBe(10);
  });

  it("falls back to staff min when there is no velocity", () => {
    const row = computeReorderSuggestion({
      onHand: 1,
      staffMin: 5,
      avgDailyOut: 0,
      hadVelocity: false,
      coverDays: 17,
      season: 1.4,
      committed: 0,
      incoming: 0,
      useVelocity: true,
    });
    expect(row.triggerMin).toBe(5);
    expect(row.suggestedQty).toBe(4);
    expect(row.coverMode).toBe("min");
  });
});

describe("roundUpToMultiple / season months", () => {
  it("leaves qty 0 at 0", () => {
    expect(roundUpToMultiple(0, 10)).toBe(0);
  });

  it("parses 5-9 and comma lists", () => {
    expect(parseSeasonMonthsFromText("5-9")).toEqual([5, 6, 7, 8, 9]);
    expect(parseSeasonMonthsFromText("5, 6, 7")).toEqual([5, 6, 7]);
  });
});

describe("stockAlerts formula", () => {
  it("applies monsoon lift for tarpaulin velocity", () => {
    const rows = stockAlerts(
      [product({ stock: 0, minStockLevel: 5 })],
      [movement({ qty: 30, date: "2026-07-01" })],
      { settings: settings(), asOf: "2026-07-15" }
    ).filter((r) => r.kind === "reorder");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.suggestedQty).toBe(24);
    expect(rows[0]?.coverMode).toBe("velocity");
    expect(rows[0]?.avgDailyOut).toBe(1);
  });

  it("does not apply season multiplier to shade net", () => {
    const rows = stockAlerts(
      [product({ category: "shade_net", stock: 0, minStockLevel: 5 })],
      [movement({ qty: 30, date: "2026-07-01" })],
      { settings: settings(), asOf: "2026-07-15" }
    ).filter((r) => r.kind === "reorder");
    expect(rows[0]?.suggestedQty).toBe(17);
    expect(rows[0]?.coverMode).toBe("velocity");
  });

  it("falls back to staff min when lookback has no OUT", () => {
    const rows = stockAlerts(
      [product({ stock: 1, minStockLevel: 5 })],
      [],
      { settings: settings(), asOf: "2026-07-15" }
    ).filter((r) => r.kind === "reorder");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.suggestedQty).toBe(4);
    expect(rows[0]?.coverMode).toBe("min");
  });

  it("ignores estimate_reserve when computing velocity", () => {
    const rows = stockAlerts(
      [product({ stock: 1, minStockLevel: 5 })],
      [
        movement({
          id: "res",
          type: "estimate_reserve",
          qty: 90,
          date: "2026-07-10",
        }),
      ],
      { settings: settings(), asOf: "2026-07-15" }
    ).filter((r) => r.kind === "reorder");
    expect(rows[0]?.coverMode).toBe("min");
    expect(rows[0]?.suggestedQty).toBe(4);
  });

  it("nets incoming open PO remaining so suggested can drop to 0", () => {
    const po: PurchaseOrder = {
      id: "po1",
      number: "PO-1001",
      supplierId: "s1",
      date: "2026-07-01",
      status: "ordered",
      lines: [
        {
          id: "l1",
          productId: "p1",
          itemLabel: "HDPE",
          qty: 10,
          rate: 0,
          amount: 0,
          receivedQty: 0,
          billedQty: 0,
        },
      ],
      total: 0,
      createdAt: "2026-07-01T00:00:00.000Z",
      createdBy: "u1",
    };
    const rows = stockAlerts(
      [product({ stock: 1, minStockLevel: 5 })],
      [],
      { settings: settings(), purchaseOrders: [po], asOf: "2026-07-15" }
    ).filter((r) => r.kind === "reorder");
    expect(rows).toHaveLength(0);
  });

  it("adds committed qty from open estimates", () => {
    const estimate = {
      id: "o1",
      orderNumber: "TT-1",
      userId: "u1",
      userName: "Ram",
      userEmail: "",
      status: "estimate",
      stockReserved: true,
      lines: [
        {
          productId: "p1",
          productCode: "TARP",
          productName: { en: "HDPE", hi: "" },
          unit: "kg",
          pricingMode: "bundle",
          rate: 100,
          quantity: 8,
          weightKg: 0,
          lineTotal: 0,
        },
      ],
      subtotal: 0,
      shippingAmount: 0,
      walletUsed: 0,
      estimatedTotal: 0,
      fullTruckRequested: false,
      deliveryAddress: "",
      timeline: [],
      createdAt: "2026-07-10T00:00:00.000Z",
      updatedAt: "2026-07-10T00:00:00.000Z",
    } as Order;
    const rows = stockAlerts(
      [product({ stock: 10, minStockLevel: 5 })],
      [],
      { settings: settings(), orders: [estimate], asOf: "2026-07-15" }
    ).filter((r) => r.kind === "reorder");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.committedQty).toBe(8);
    expect(rows[0]?.suggestedQty).toBe(3);
  });

  it("tracks last OUT per colour SKU for slow/dead", () => {
    const v = {
      id: "v1",
      label: { en: "12x18", hi: "12x18" },
      size: { en: "12x18", hi: "12x18" },
      sku: "A",
      rate: 100,
      stock: 0,
    };
    const blue = { id: "c-blue", name: { en: "Blue", hi: "नीला" }, hex: "#00f" };
    const green = { id: "c-green", name: { en: "Green", hi: "हरा" }, hex: "#0f0" };
    const p = product({
      minStockLevel: 0,
      stock: 8,
      variations: [v],
      colors: [blue, green],
      minStockMatrix: { "v1__c-blue": 2 },
      stockMatrix: { "v1__c-blue": 1, "v1__c-green": 8 },
    });
    const rows = stockAlerts(
      [p],
      [
        movement({
          variationId: "v1",
          colorId: "c-blue",
          date: "2026-07-14",
          qty: 1,
        }),
      ],
      { settings: settings(), asOf: "2026-07-15", deadDays: 90, slowDays: 45 }
    );
    const greenRow = rows.find((r) => r.colorId === "c-green");
    expect(greenRow?.kind).toBe("dead");
    expect(greenRow?.lastOutDate).toBeUndefined();
  });
});
