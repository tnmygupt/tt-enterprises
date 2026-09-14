import { describe, expect, it } from "vitest";
import { mergeOrderLinesIntoCart } from "./order-again";
import type { CartItem, OrderLine, Product } from "./types";

function makeProduct(stock = 10): Product {
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
    stockMatrix: { v1__c1: stock },
    media: [],
    active: true,
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function line(qty: number, extra: Partial<OrderLine> = {}): OrderLine {
  return {
    productId: "p1",
    productCode: "TARP",
    productName: { en: "HDPE", hi: "एचडीपीई" },
    variationId: "v1",
    colorId: "c1",
    unit: "kg",
    pricingMode: "bundle",
    rate: 100,
    quantity: qty,
    weightKg: qty * 35,
    lineTotal: qty * 100 * 35,
    ...extra,
  };
}

describe("mergeOrderLinesIntoCart", () => {
  it("copies in-stock lines into an empty cart", () => {
    const { cart, addedLines, skippedLines } = mergeOrderLinesIntoCart(
      [line(3)],
      [makeProduct(10)],
      []
    );
    expect(addedLines).toBe(1);
    expect(skippedLines).toBe(0);
    expect(cart).toHaveLength(1);
    expect(cart[0]).toMatchObject({
      productId: "p1",
      variationId: "v1",
      colorId: "c1",
      quantity: 3,
    });
  });

  it("skips inactive and zero-stock SKUs", () => {
    const inactive = makeProduct(8);
    inactive.active = false;
    const empty = makeProduct(0);
    empty.id = "p2";
    const { addedLines, skippedLines, cart } = mergeOrderLinesIntoCart(
      [line(2), line(2, { productId: "p2" })],
      [inactive, empty],
      []
    );
    expect(addedLines).toBe(0);
    expect(skippedLines).toBe(2);
    expect(cart).toHaveLength(0);
  });

  it("caps add qty at remaining stock and merges into the existing cart", () => {
    const existing: CartItem[] = [
      {
        key: "p1:v1:c1",
        productId: "p1",
        variationId: "v1",
        colorId: "c1",
        quantity: 8,
        weightKg: 280,
      },
    ];
    const { cart, addedLines, skippedLines } = mergeOrderLinesIntoCart(
      [line(5)],
      [makeProduct(10)],
      existing
    );
    expect(addedLines).toBe(1);
    expect(skippedLines).toBe(0);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(10);
  });
});
