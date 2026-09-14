import { describe, expect, it } from "vitest";
import {
  computeCommandDesk,
  salesDeltaPct,
} from "./admin-command-desk";
import type { Party, Product, Voucher } from "./types";

function party(over: Partial<Party> = {}): Party {
  return {
    id: "c1",
    type: "customer",
    name: "Kanpur Dealer",
    phone: "9000000002",
    openingBalance: 0,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

function sale(id: string, date: string, total: number, partyId = "c1"): Voucher {
  return {
    id,
    number: id,
    type: "sale",
    date,
    partyId,
    total,
    subtotal: total,
    taxAmount: 0,
    voided: false,
    lines: [
      {
        id: `${id}-l`,
        itemLabel: "HDPE 12x18",
        qty: 1,
        rate: total,
        amount: total,
        productId: "p1",
      },
    ],
    createdAt: `${date}T10:00:00.000Z`,
    createdBy: "u1",
  };
}

function product(): Product {
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
    minStockLevel: 10,
    stock: 0,
    stockSecondary: 0,
    variations: [],
    colors: [],
    media: [],
    active: true,
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("salesDeltaPct", () => {
  it("returns YoY percent and null when prior is zero with no current", () => {
    expect(salesDeltaPct(120, 100)).toBe(20);
    expect(salesDeltaPct(0, 0)).toBeNull();
    expect(salesDeltaPct(50, 0)).toBe(100);
  });
});

describe("computeCommandDesk", () => {
  it("sums MTD sales, flags season outlook, and stocked-out reorders as critical", () => {
    const desk = computeCommandDesk(
      {
        settings: {
          companyName: "TT",
          financialYearStartMonth: 4,
          autoReorderUseVelocity: true,
          autoReorderLookbackDays: 30,
          autoReorderLeadTimeDays: 10,
          autoReorderSafetyDays: 7,
          autoReorderSeasonMonths: [5, 6, 7, 8, 9],
          autoReorderSeasonMultiplier: 1.4,
        } as never,
        parties: [party()],
        products: [product()],
        categories: [
          {
            id: "tarpaulin",
            name: { en: "Tarpaulin", hi: "तिरपाल" },
            active: true,
          },
        ],
        vouchers: [
          sale("v1", "2026-08-01", 1000),
          sale("v2", "2026-08-20", 500),
          sale("v3", "2025-08-20", 800),
        ],
        stockMovements: [
          {
            id: "m1",
            date: "2026-08-01",
            type: "sale",
            productId: "p1",
            qty: 20,
            direction: "out",
            createdAt: "2026-08-01T00:00:00.000Z",
            createdBy: "u1",
          },
        ],
        accounts: [],
        ledgerEntries: [],
        billAllocations: [],
        stockBatches: [],
        orders: [],
        purchaseOrders: [
          {
            id: "po1",
            number: "PO-1",
            supplierId: "s1",
            date: "2026-08-20",
            status: "draft",
            lines: [],
            total: 0,
            createdAt: "2026-08-20T00:00:00.000Z",
            createdBy: "u1",
          },
        ],
      },
      "2026-08-26"
    );

    expect(desk.salesMtd).toBe(1500);
    expect(desk.salesMtdLastYear).toBe(800);
    expect(desk.salesFy).toBe(1500);
    expect(desk.seasonOn).toBe(true);
    expect(desk.outlookMethod).toBe("last30_season");
    expect(desk.outlookNextMonth).toBe(2100);
    expect(desk.mix.critical).toBeGreaterThan(0);
    expect(desk.draftPos).toBe(1);
    expect(desk.monthly.some((m) => m.month === "2026-08" && m.sales === 1500)).toBe(
      true
    );
  });
});
