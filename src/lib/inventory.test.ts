import { describe, expect, it } from "vitest";
import {
  applyGrnStock,
  applyOrderEstimateStock,
  firstInStockSelection,
  getSizeColorStock,
  secondaryPerBundle,
  voucherLineAmount,
} from "./inventory";
import type { GoodsReceipt, OrderLine, Product } from "./types";

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
    colors: [
      {
        id: "c1",
        name: { en: "Blue", hi: "नीला" },
        hex: "#00f",
      },
    ],
    stockMatrix: { "v1__c1": 10 },
    media: [],
    active: true,
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("inventory", () => {
  it("GRN apply then reverse returns stock to starting matrix", () => {
    const product = makeProduct();
    const db = { products: [product], stockMovements: [] as never[] };
    const grn: GoodsReceipt = {
      id: "grn1",
      number: "GRN-1",
      poId: "po1",
      date: "2026-01-02",
      lines: [
        {
          id: "gl1",
          poLineId: "pl1",
          productId: "p1",
          variationId: "v1",
          colorId: "c1",
          itemLabel: "HDPE 12x18",
          qty: 3,
          secondaryQty: 105,
          unit: "kg",
        },
      ],
      createdAt: "2026-01-02T00:00:00.000Z",
      createdBy: "test",
      voided: false,
    };

    applyGrnStock(db, grn, "test", false);
    expect(getSizeColorStock(product, "v1", "c1")).toBe(13);

    applyGrnStock(db, grn, "test", true);
    expect(getSizeColorStock(product, "v1", "c1")).toBe(10);
  });

  it("reserve beyond stock throws instead of clamping", () => {
    const product = makeProduct();
    product.stockMatrix = { "v1__c1": 2 };
    product.variations[0].stock = 2;
    product.stock = 2;
    const db = { products: [product], stockMovements: [] as never[] };
    const lines: OrderLine[] = [
      {
        productId: "p1",
        productCode: "TARP",
        productName: { en: "HDPE", hi: "एचडीपीई" },
        size: { en: "12x18", hi: "12x18" },
        colorName: { en: "Blue", hi: "नीला" },
        variationId: "v1",
        colorId: "c1",
        quantity: 5,
        unit: "kg",
        rate: 100,
        weightKg: 175,
        lineTotal: 17500,
        pricingMode: "bundle",
      },
    ];

    expect(() =>
      applyOrderEstimateStock(
        db,
        { id: "o1", orderNumber: "EST-1", lines },
        "user1",
        "reserve"
      )
    ).toThrow(/Insufficient stock/);

    // Rolled back — stock unchanged and no movements left
    expect(getSizeColorStock(product, "v1", "c1")).toBe(2);
    expect(db.stockMovements).toHaveLength(0);
  });

  it("successful reserve deducts stock", () => {
    const product = makeProduct();
    const db = { products: [product], stockMovements: [] as never[] };
    const lines: OrderLine[] = [
      {
        productId: "p1",
        productCode: "TARP",
        productName: { en: "HDPE", hi: "एचडीपीई" },
        size: { en: "12x18", hi: "12x18" },
        colorName: { en: "Blue", hi: "नीला" },
        variationId: "v1",
        colorId: "c1",
        quantity: 2,
        unit: "kg",
        rate: 100,
        weightKg: 70,
        lineTotal: 7000,
        pricingMode: "bundle",
      },
    ];

    applyOrderEstimateStock(
      db,
      { id: "o1", orderNumber: "EST-1", lines },
      "user1",
      "reserve"
    );
    expect(getSizeColorStock(product, "v1", "c1")).toBe(8);
    expect(db.stockMovements).toHaveLength(1);
  });

  it("firstInStockSelection skips a zero first color when another color has stock", () => {
    const product = makeProduct();
    product.colors = [
      { id: "c0", name: { en: "Red", hi: "लाल" }, hex: "#f00" },
      { id: "c1", name: { en: "Blue", hi: "नीला" }, hex: "#00f" },
    ];
    product.stockMatrix = { "v1__c0": 0, "v1__c1": 13 };
    product.variations[0].stock = 13;
    product.stock = 13;
    expect(firstInStockSelection(product)).toEqual({
      variationId: "v1",
      colorId: "c1",
    });
    expect(getSizeColorStock(product, "v1", "c0")).toBe(0);
    expect(getSizeColorStock(product, "v1", "c1")).toBe(13);
  });

  it("sqft secondary is pcs per packet; voucher amount uses ₹/sqft", () => {
    const p: Product = {
      ...makeProduct(),
      unit: "sqft",
      pricingMode: "pcs",
      lengthFt: 12,
      widthFt: 18,
      pcsPerPacket: 10,
      ratePerSqft: 2,
      baseRate: 2,
      variations: [
        {
          ...makeProduct().variations[0],
          lengthFt: 12,
          widthFt: 18,
          pcsPerPacket: 10,
          ratePerSqft: 2,
          rate: 4320,
        },
      ],
    };
    expect(secondaryPerBundle(p, "v1")).toBe(10);
    expect(
      voucherLineAmount(
        { qty: 2, rate: 2, unit: "sqft", variationId: "v1" },
        p
      )
    ).toBe(8640);
  });
});
