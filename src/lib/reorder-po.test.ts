import { describe, expect, it } from "vitest";
import { buildDraftPosFromAlerts, type ReorderDb } from "./reorder-po";
import type {
  AppSettings,
  Party,
  Product,
  PurchaseOrder,
  StockAlertRow,
} from "./types";

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
    preferredSupplierId: "s1",
    stock: 1,
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

function db(over: Partial<ReorderDb> = {}): ReorderDb {
  const supplier: Party = {
    id: "s1",
    name: "Patel Mills",
    type: "supplier",
    openingBalance: 0,
    active: true,
    createdAt: "2026-01-01",
  };
  return {
    products: [product()],
    parties: [supplier],
    purchaseOrders: [],
    supplierContracts: [],
    stockMovements: [],
    settings: {
      companyName: "TT",
      autoReorderMinQty: 1,
      autoReorderUseVelocity: true,
    } as AppSettings,
    orders: [],
    ...over,
  };
}

function alert(over: Partial<StockAlertRow> = {}): StockAlertRow {
  return {
    productId: "p1",
    label: "HDPE",
    stock: 1,
    stockSecondary: 0,
    minStockLevel: 5,
    suggestedQty: 4,
    preferredSupplierId: "s1",
    kind: "reorder",
    coverMode: "min",
    ...over,
  };
}

describe("buildDraftPosFromAlerts", () => {
  it("does not skip a SKU just because an older open PO exists", () => {
    const oldPo: PurchaseOrder = {
      id: "po_old",
      number: "PO-1001",
      supplierId: "s1",
      date: "2026-01-01",
      status: "ordered",
      lines: [
        {
          id: "l1",
          productId: "p1",
          itemLabel: "HDPE",
          qty: 2,
          rate: 0,
          amount: 0,
          receivedQty: 2,
          billedQty: 0,
        },
      ],
      total: 0,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "u1",
    };
    const created = buildDraftPosFromAlerts(db({ purchaseOrders: [oldPo] }), "cron", {
      rows: [alert({ suggestedQty: 4, coverMode: "min" })],
      asOf: "2026-07-15",
    });
    expect(created).toHaveLength(1);
    expect(created[0]?.lines[0]?.qty).toBe(4);
    expect(created[0]?.narration).toBe("Auto reorder (min)");
  });

  it("creates no line when suggested is already 0 after incoming netting", () => {
    const created = buildDraftPosFromAlerts(db(), "cron", {
      rows: [alert({ suggestedQty: 0 })],
      asOf: "2026-07-15",
    });
    expect(created).toHaveLength(0);
  });

  it("labels velocity drafts in the narration", () => {
    const created = buildDraftPosFromAlerts(db(), "cron", {
      rows: [alert({ suggestedQty: 24, coverMode: "velocity" })],
      asOf: "2026-07-15",
    });
    expect(created[0]?.narration).toBe("Auto reorder (velocity)");
  });
});
