import { describe, expect, it } from "vitest";
import { ACCT } from "./accounting/seed";
import { accountBalance } from "./accounting/engine";
import {
  cancelIssuedJobCardOn,
  completeJobCardOn,
  createJobCardOn,
  issueJobCardOn,
  scaleBomLines,
  upsertBomOn,
  wipBalance,
  type ProductionDb,
} from "./production";
import { createBatchFromLine } from "./accounting/costing";
import type { Account, Product } from "./types";

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
});
