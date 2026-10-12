import { describe, expect, it } from "vitest";
import { ACCT } from "./accounting/seed";
import { accountBalance } from "./accounting/engine";
import {
  cancelIssuedJobCardOn,
  clubJobLines,
  completeJobCardOn,
  createJobCardOn,
  issueJobCardOn,
  orderJobMaterialsOn,
  scaleBomLines,
  upsertBomOn,
  wipBalance,
  type ProductionDb,
} from "./production";
import { createBatchFromLine } from "./accounting/costing";
import type { Account, Party, Product } from "./types";

function acct(
  id: string,
  code: string,
  type: Account["type"]
): Account {
  return {
    id,
    code,
    name: { en: code, hi: code },
    type,
    openingBalance: 0,
    active: true,
  };
}

function product(partial: Partial<Product> & Pick<Product, "id" | "name">): Product {
  return {
    code: partial.id,
    category: "tarpaulin",
    itemName: partial.name,
    description: { en: "", hi: "" },
    unit: "kg",
    baseRate: 100,
    baseWeightKg: 1,
    pricingMode: "bundle",
    minOrderQty: 1,
    stock: 20,
    stockSecondary: 20,
    variations: [],
    colors: [],
    media: [],
    active: true,
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as Product;
}

function emptyProd(): ProductionDb {
  const rm = product({ id: "rm", name: { en: "Resin", hi: "रेजिन" } });
  const fg = product({
    id: "fg",
    name: { en: "Sheet", hi: "शीट" },
    stock: 0,
    stockSecondary: 0,
  });
  return {
    products: [rm, fg],
    boms: [],
    jobCards: [],
    vouchers: [],
    ledgerEntries: [],
    stockMovements: [],
    stockBatches: [
      createBatchFromLine({
        date: "2026-09-01",
        productId: "rm",
        qty: 20,
        rate: 8,
        unit: "kg",
        source: "purchase",
      }),
    ],
    batchConsumptions: [],
    accounts: [
      acct(ACCT.inventory, "1300", "asset"),
      acct(ACCT.wip, "1305", "asset"),
      acct(ACCT.wastage, "5106", "expense"),
      acct(ACCT.grni, "2105", "liability"),
    ],
    settings: {},
  };
}

describe("scaleBomLines", () => {
  it("scales input qty to planned output", () => {
    const bom = upsertBomOn(emptyProd(), {
      outputProductId: "fg",
      outputQty: 2,
      lines: [{ productId: "rm", qty: 4 }],
      createdBy: "t",
    });
    const lines = scaleBomLines(bom, 5);
    expect(lines[0]?.qty).toBe(10);
  });

  it("updates the existing BOM for the same output SKU", () => {
    const db = emptyProd();
    const first = upsertBomOn(db, {
      outputProductId: "fg",
      outputQty: 1,
      lines: [{ productId: "rm", qty: 2 }],
      createdBy: "t",
    });
    const second = upsertBomOn(db, {
      outputProductId: "fg",
      outputQty: 1,
      lines: [{ productId: "rm", qty: 3 }],
      createdBy: "t",
    });
    expect(second.id).toBe(first.id);
    expect(db.boms).toHaveLength(1);
    expect(db.boms[0]?.lines[0]?.qty).toBe(3);
  });
});

describe("job cards", () => {
  it("issues RM to WIP at FIFO cost and completes FG with wastage", () => {
    const db = emptyProd();
    const bom = upsertBomOn(db, {
      outputProductId: "fg",
      outputQty: 1,
      lines: [{ productId: "rm", qty: 2 }],
      createdBy: "t",
    });
    const job = createJobCardOn(db, {
      date: "2026-09-10",
      createdBy: "t",
      bomId: bom.id,
      outputProductId: "fg",
      plannedQty: 5,
    });
    expect(job.status).toBe("draft");
    issueJobCardOn(db, job.id, "t");
    expect(job.status).toBe("issued");
    expect(job.issuedCost).toBe(80);
    expect(wipBalance(db)).toBe(80);
    completeJobCardOn(db, { jobId: job.id, actualQty: 4, createdBy: "t" });
    expect(job.status).toBe("completed");
    expect(job.wastageCost).toBe(16);
    expect(wipBalance(db)).toBe(0);
    const wastage = db.accounts.find((a) => a.id === ACCT.wastage)!;
    expect(accountBalance(wastage, db.ledgerEntries)).toBe(16);
    const fgBatch = db.stockBatches.find((b) => b.source === "production");
    expect(fgBatch?.qty).toBe(4);
    expect(fgBatch?.rate).toBe(16);
  });

  it("cancels an issued job and restores RM", () => {
    const db = emptyProd();
    const bom = upsertBomOn(db, {
      outputProductId: "fg",
      outputQty: 1,
      lines: [{ productId: "rm", qty: 2 }],
      createdBy: "t",
    });
    const job = createJobCardOn(db, {
      date: "2026-09-10",
      createdBy: "t",
      bomId: bom.id,
      outputProductId: "fg",
      plannedQty: 5,
    });
    issueJobCardOn(db, job.id, "t");
    const rmBeforeCancel = db.products.find((p) => p.id === "rm")!.stockSecondary;
    cancelIssuedJobCardOn(db, job.id, "t");
    expect(job.status).toBe("cancelled");
    expect(wipBalance(db)).toBe(0);
    expect(db.products.find((p) => p.id === "rm")!.stockSecondary).toBeGreaterThan(
      rmBeforeCancel ?? 0
    );
  });

  it("clubs shared raw material across two finished SKUs", () => {
    const db = emptyProd();
    const fg2 = product({
      id: "fg2",
      name: { en: "Sheet 2", hi: "शीट 2" },
      stock: 0,
      stockSecondary: 0,
    });
    db.products.push(fg2);
    const bom1 = upsertBomOn(db, {
      outputProductId: "fg",
      outputQty: 1,
      lines: [{ productId: "rm", qty: 2 }],
      createdBy: "t",
    });
    const bom2 = upsertBomOn(db, {
      outputProductId: "fg2",
      outputQty: 1,
      lines: [{ productId: "rm", qty: 3 }],
      createdBy: "t",
    });
    const job = createJobCardOn(db, {
      date: "2026-09-10",
      createdBy: "t",
      outputs: [
        { productId: "fg", plannedQty: 2, bomId: bom1.id },
        { productId: "fg2", plannedQty: 2, bomId: bom2.id },
      ],
    });
    expect(job.outputs).toHaveLength(2);
    expect(job.inputLines).toHaveLength(1);
    expect(job.inputLines[0]?.qty).toBe(10);
    expect(job.outputProductId).toBe("fg");
    expect(job.plannedQty).toBe(2);
    issueJobCardOn(db, job.id, "t");
    expect(job.issuedCost).toBe(80);
    completeJobCardOn(db, {
      jobId: job.id,
      createdBy: "t",
      actuals: [
        { id: job.outputs![0]!.id, actualQty: 1 },
        { id: job.outputs![1]!.id, actualQty: 2 },
      ],
    });
    expect(job.wastageCost).toBe(20);
    expect(job.outputs?.[0]?.actualQty).toBe(1);
    expect(job.outputs?.[1]?.actualQty).toBe(2);
    const fgBatches = db.stockBatches.filter((b) => b.source === "production");
    expect(fgBatches.map((b) => b.qty).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(wipBalance(db)).toBe(0);
  });

  it("orders only the clubbed shortfall, one draft PO per supplier", () => {
    const db = emptyProd();
    const rm = db.products.find((p) => p.id === "rm")!;
    rm.stockSecondary = 4;
    rm.preferredSupplierId = "sup1";
    const rm2 = product({
      id: "rm2",
      name: { en: "Pigment", hi: "पिगमेंट" },
      stock: 0,
      stockSecondary: 0,
      preferredSupplierId: "sup2",
    });
    const fg2 = product({
      id: "fg2",
      name: { en: "Sheet 2", hi: "शीट 2" },
      stock: 0,
      stockSecondary: 0,
    });
    db.products.push(rm2, fg2);
    db.stockBatches.push(
      createBatchFromLine({
        date: "2026-09-01",
        productId: "rm2",
        qty: 1,
        rate: 5,
        unit: "kg",
        source: "purchase",
      })
    );
    const bom1 = upsertBomOn(db, {
      outputProductId: "fg",
      outputQty: 1,
      lines: [
        { productId: "rm", qty: 2 },
        { productId: "rm2", qty: 1 },
      ],
      createdBy: "t",
    });
    const bom2 = upsertBomOn(db, {
      outputProductId: "fg2",
      outputQty: 1,
      lines: [{ productId: "rm", qty: 3 }],
      createdBy: "t",
    });
    const job = createJobCardOn(db, {
      date: "2026-09-10",
      createdBy: "t",
      outputs: [
        { productId: "fg", plannedQty: 2, bomId: bom1.id },
        { productId: "fg2", plannedQty: 2, bomId: bom2.id },
      ],
    });
    expect(clubJobLines(job.inputLines)).toHaveLength(2);
    expect(job.inputLines.find((l) => l.productId === "rm")?.qty).toBe(10);
    expect(job.inputLines.find((l) => l.productId === "rm2")?.qty).toBe(2);
    const supplier = (id: string): Party =>
      ({
        id,
        name: id,
        phone: "9999999999",
        type: "supplier",
        openingBalance: 0,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      }) as Party;
    db.parties = [supplier("sup1"), supplier("sup2")];
    db.purchaseOrders = [];
    db.supplierContracts = [];
    const ordered = orderJobMaterialsOn(db, job.id, "t");
    expect(ordered.missingSupplier).toHaveLength(0);
    expect(ordered.orders).toHaveLength(2);
    const rmPo = ordered.orders.find((p) =>
      p.lines.some((l) => l.productId === "rm")
    );
    expect(rmPo?.status).toBe("draft");
    expect(rmPo?.narration).toContain(job.number);
    expect(rmPo?.lines.find((l) => l.productId === "rm")?.qty).toBe(6);
    expect(ordered.orders.find((p) => p.supplierId === "sup2")?.lines[0]?.qty).toBe(
      2
    );
    const again = orderJobMaterialsOn(db, job.id, "t");
    expect(again.orders).toHaveLength(0);
    expect(again.missingSupplier).toHaveLength(0);
  });

  it("does not open a blank PO when the short line has no supplier", () => {
    const db = emptyProd();
    const rm = db.products.find((p) => p.id === "rm")!;
    rm.stockSecondary = 0;
    const job = createJobCardOn(db, {
      date: "2026-09-10",
      createdBy: "t",
      outputProductId: "fg",
      plannedQty: 2,
      inputLines: [{ productId: "rm", qty: 4, bundles: 0 }],
    });
    db.parties = [];
    db.purchaseOrders = [];
    const ordered = orderJobMaterialsOn(db, job.id, "t");
    expect(ordered.orders).toHaveLength(0);
    expect(ordered.missingSupplier).toEqual([
      { itemLabel: "Resin", qty: 4 },
    ]);
    expect(db.purchaseOrders).toHaveLength(0);
  });
});
