import { describe, expect, it } from "vitest";
import {
  autoReorderOwnerPoSummaries,
  buildDraftPosFromAlerts,
  runAutoReorder,
  type ReorderDb,
} from "./reorder-po";
import { stockAlertsFromDb } from "./accounting/analysis";
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
    expect(created[0]?.status).toBe("draft");
  });
});

describe("runAutoReorder", () => {
  it("confirms new POs as ordered without leaving drafts", () => {
    const snap = db();
    const result = runAutoReorder(snap, "cron", {
      rows: [alert({ suggestedQty: 4, coverMode: "min" })],
      asOf: "2026-07-15",
    });
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.status).toBe("ordered");
    expect(result.created[0]?.narration).toBe("Auto reorder (min)");
    expect(snap.purchaseOrders[0]?.status).toBe("ordered");
    expect(result.alertCount).toBe(1);
    const summaries = autoReorderOwnerPoSummaries(
      result.created,
      snap.parties
    );
    expect(summaries[0]).toMatchObject({
      millName: "Patel Mills",
      lines: [{ itemLabel: "HDPE", qty: 4 }],
    });
  });

  it("does not duplicate qty already sitting on an open ordered PO", () => {
    const snap = db();
    const first = runAutoReorder(snap, "cron", { asOf: "2026-07-15" });
    expect(first.created).toHaveLength(1);
    expect(first.created[0]?.status).toBe("ordered");
    const leftover = stockAlertsFromDb(snap, { asOf: "2026-07-15" }).filter(
      (r) => r.kind === "reorder" && r.suggestedQty > 0
    );
    expect(leftover).toEqual([]);
    const second = runAutoReorder(snap, "cron", { asOf: "2026-07-15" });
    expect(second.created).toHaveLength(0);
    expect(snap.purchaseOrders).toHaveLength(1);
  });

  it("merges into an existing draft PO for the same supplier", () => {
    const draftPo: PurchaseOrder = {
      id: "po_draft",
      number: "PO-1002",
      supplierId: "s1",
      date: "2026-07-01",
      status: "draft",
      lines: [
        {
          id: "l1",
          productId: "p1",
          itemLabel: "HDPE",
          qty: 2,
          rate: 10,
          amount: 20,
          receivedQty: 0,
          billedQty: 0,
        },
      ],
      total: 20,
      createdAt: "2026-07-01T00:00:00.000Z",
      createdBy: "u1",
    };
    const store = db({ purchaseOrders: [draftPo] });
    const touched = buildDraftPosFromAlerts(store, "cron", {
      rows: [alert({ suggestedQty: 4, coverMode: "min" })],
      asOf: "2026-07-15",
    });
    expect(touched).toHaveLength(1);
    expect(touched[0]?.id).toBe("po_draft");
    expect(store.purchaseOrders).toHaveLength(1);
    expect(touched[0]?.lines).toHaveLength(1);
    expect(touched[0]?.lines[0]?.qty).toBe(6);
    expect(touched[0]?.lines[0]?.rate).toBe(10);
  });

  it("skips missing-supplier blockers instead of creating a PO", () => {
    const created = buildDraftPosFromAlerts(db(), "cron", {
      rows: [
        alert({
          preferredSupplierId: undefined,
          blockers: ["missing_supplier"],
          suggestedQty: 8,
        }),
      ],
      asOf: "2026-07-15",
    });
    expect(created).toHaveLength(0);
  });
});
