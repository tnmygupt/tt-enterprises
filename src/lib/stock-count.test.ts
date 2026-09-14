import { describe, expect, it } from "vitest";
import type { Product, StockCount } from "./types";
import {
  adjustmentsFromApprovedLines,
  freezeStockCountLines,
  isSurplus,
  isUncountedLine,
  lineVariance,
  mergeStockCountsForStaff,
  setCountedQty,
  shortageValue,
  startStockCountSession,
  stripStockCountRates,
  surplusLines,
  uncountedLines,
} from "./stock-count";

function product(): Product {
  return {
    id: "p1",
    code: "TARP",
    category: "tarpaulin",
    itemName: { en: "Tarpaulin", hi: "तिरपाल" },
    name: { en: "HDPE", hi: "एचडीपीई" },
    description: { en: "", hi: "" },
    unit: "kg",
    baseRate: 120,
    baseWeightKg: 35,
    pricingMode: "bundle",
    minOrderQty: 1,
    active: true,
    featured: false,
    colors: [],
    variations: [
      {
        id: "v1",
        label: { en: "12x18", hi: "12x18" },
        size: { en: "12x18", hi: "12x18" },
        sku: "TARP-1218",
        rate: 120,
        stock: 10,
        weightKg: 35,
      },
    ],
    media: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as Product;
}

describe("stock count freeze and variance", () => {
  it("freezes book qty and treats counted < book as shortage", () => {
    const lines = freezeStockCountLines([product()]);
    expect(lines[0]?.bookQty).toBe(10);
    const session = startStockCountSession({
      month: "2026-09",
      startedBy: "staff",
      products: [product()],
    });
    const counted = setCountedQty(session, session.lines[0]!.id, 7);
    expect(counted.lines[0]!.bookQty).toBe(10);
    expect(lineVariance(counted.lines[0]!)).toBe(-3);
    expect(shortageValue({ ...counted.lines[0]!, unitRate: 100 })).toBe(300);
  });

  it("staff merge cannot change frozen book qty or post owner decisions", () => {
    const cloud: StockCount[] = [
      {
        id: "sc1",
        month: "2026-09",
        status: "submitted",
        startedBy: "s",
        startedAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
        lines: [
          {
            id: "l1",
            productId: "p1",
            bookQty: 10,
            countedQty: 7,
            counted: true,
            unitRate: 90,
            ownerDecision: "pending",
          },
        ],
      },
    ];
    const incoming: StockCount[] = [
      {
        ...cloud[0]!,
        status: "owner_reviewed",
        lines: [
          {
            id: "l1",
            productId: "p1",
            bookQty: 1,
            countedQty: 7,
            counted: true,
            unitRate: 1,
            ownerDecision: "approved",
            postedMovementId: "fake",
          },
        ],
      },
    ];
    const merged = mergeStockCountsForStaff(incoming, cloud, false);
    expect(merged[0]!.lines[0]!.bookQty).toBe(10);
    expect(merged[0]!.lines[0]!.ownerDecision).toBe("pending");
    expect(merged[0]!.lines[0]!.postedMovementId).toBeUndefined();
    expect(merged[0]!.status).toBe("submitted");
    expect(stripStockCountRates(cloud)[0]!.lines[0]!.unitRate).toBeUndefined();
  });

  it("builds FIFO adjustment only for approved unposted variance", () => {
    const session: StockCount = {
      id: "sc1",
      month: "2026-09",
      status: "submitted",
      startedBy: "s",
      startedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      lines: [
        {
          id: "l1",
          productId: "p1",
          bookQty: 10,
          countedQty: 7,
          counted: true,
        },
      ],
    };
    const adj = adjustmentsFromApprovedLines(session, ["l1"], "owner");
    expect(adj).toHaveLength(1);
    expect(adj[0]!.direction).toBe("out");
    expect(adj[0]!.qty).toBe(3);
    expect(adj[0]!.note).toBe("Month count 2026-09");
  });

  it("flags uncounted book qty and surplus over-count", () => {
    const session: StockCount = {
      id: "sc1",
      month: "2026-09",
      status: "draft",
      startedBy: "s",
      startedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      lines: [
        { id: "u1", productId: "p1", bookQty: 8, counted: false },
        {
          id: "s1",
          productId: "p2",
          bookQty: 4,
          countedQty: 6,
          counted: true,
        },
      ],
    };
    expect(isUncountedLine(session.lines[0]!)).toBe(true);
    expect(isSurplus(session.lines[1]!)).toBe(true);
    expect(uncountedLines(session)).toHaveLength(1);
    expect(surplusLines(session)[0]?.id).toBe("s1");
  });
});
