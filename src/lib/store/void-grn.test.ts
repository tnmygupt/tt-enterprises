import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSizeColorStock } from "../inventory";
import type {
  GoodsReceipt,
  Product,
  PurchaseOrder,
  StockBatch,
} from "../types";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function seedProduct(): Product {
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
    stock: 13,
    stockSecondary: 455,
    variations: [
      {
        id: "v1",
        label: { en: "12x18", hi: "12x18" },
        size: { en: "12x18", hi: "12x18" },
        sku: "T-1218",
        rate: 100,
        weightKg: 35,
        stock: 13,
        stockSecondary: 455,
      },
    ],
    colors: [{ id: "c1", name: { en: "Blue", hi: "नीला" }, hex: "#00f" }],
    stockMatrix: { "v1__c1": 13 },
    media: [],
    active: true,
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("voidGoodsReceipt", () => {
  beforeEach(() => {
    const ls = memoryStorage();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("window", {
      localStorage: ls,
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("crypto", {
      randomUUID: () => `id_${Math.random().toString(16).slice(2)}`,
    });
  });

  it("restores stock when GRN is not billed", async () => {
    const { loadDb, voidGoodsReceipt, saveDb } = await import("./db");
    const product = seedProduct();
    const po: PurchaseOrder = {
      id: "po1",
      number: "PO-1",
      supplierId: "s1",
      date: "2026-01-02",
      status: "received",
      total: 1000,
      lines: [
        {
          id: "pl1",
          productId: "p1",
          variationId: "v1",
          colorId: "c1",
          itemLabel: "HDPE",
          qty: 10,
          receivedQty: 3,
          rate: 100,
          amount: 1000,
          unit: "kg",
        },
      ],
      createdAt: "2026-01-02T00:00:00.000Z",
      createdBy: "test",
    };
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
          itemLabel: "HDPE",
          qty: 3,
          secondaryQty: 105,
          unit: "kg",
        },
      ],
      createdAt: "2026-01-02T00:00:00.000Z",
      createdBy: "test",
      voided: false,
    };
    const batch: StockBatch = {
      id: "b1",
      date: "2026-01-02",
      productId: "p1",
      variationId: "v1",
      colorId: "c1",
      qty: 105,
      originalQty: 105,
      rate: 0,
      unit: "kg",
      source: "grn",
      grnId: "grn1",
      provisional: true,
      createdAt: "2026-01-02T00:00:00.000Z",
    };

    const db = loadDb();
    db.products = [product];
    db.parties = [
      {
        id: "s1",
        name: "Supplier",
        phone: "9999999999",
        type: "supplier",
        openingBalance: 0,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    db.purchaseOrders = [po];
    db.goodsReceipts = [grn];
    db.stockBatches = [batch];
    db.vouchers = [];
    db.batchConsumptions = [];
    saveDb(db);

    voidGoodsReceipt("grn1", "tester");

    const next = loadDb();
    expect(next.goodsReceipts[0].voided).toBe(true);
    expect(next.purchaseOrders[0].lines[0].receivedQty).toBe(0);
    expect(next.stockBatches.some((b) => b.grnId === "grn1")).toBe(false);
    expect(getSizeColorStock(next.products[0], "v1", "c1")).toBe(10);
  });

  it("refuses when a purchase bill is linked", async () => {
    const { loadDb, voidGoodsReceipt, saveDb } = await import("./db");
    const db = loadDb();
    db.products = [seedProduct()];
    db.purchaseOrders = [
      {
        id: "po1",
        number: "PO-1",
        supplierId: "s1",
        date: "2026-01-02",
        status: "billed",
        total: 300,
        lines: [
          {
            id: "pl1",
            productId: "p1",
            itemLabel: "HDPE",
            qty: 3,
            receivedQty: 3,
            rate: 100,
            amount: 300,
            unit: "kg",
          },
        ],
        createdAt: "2026-01-02T00:00:00.000Z",
        createdBy: "test",
      },
    ];
    db.goodsReceipts = [
      {
        id: "grn1",
        number: "GRN-1",
        poId: "po1",
        date: "2026-01-02",
        lines: [
          {
            id: "gl1",
            poLineId: "pl1",
            productId: "p1",
            itemLabel: "HDPE",
            qty: 3,
            unit: "kg",
          },
        ],
        createdAt: "2026-01-02T00:00:00.000Z",
        createdBy: "test",
        voided: false,
      },
    ];
    db.vouchers = [
      {
        id: "v1",
        number: "P-1",
        type: "purchase",
        date: "2026-01-03",
        partyId: "s1",
        lines: [],
        subtotal: 100,
        taxAmount: 0,
        total: 100,
        outstanding: 100,
        linkedGrnId: "grn1",
        voided: false,
        createdAt: "2026-01-03T00:00:00.000Z",
        createdBy: "test",
      },
    ];
    saveDb(db);

    expect(() => voidGoodsReceipt("grn1", "tester")).toThrow(
      /purchase bill first/i
    );
  });
});
