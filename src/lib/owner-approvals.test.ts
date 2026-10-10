import { describe, expect, it } from "vitest";
import type { OwnerApproval, Product, Scheme, UserProfile } from "@/lib/types";
import {
  applyNewlyApprovedOwnerApprovals,
  applyOwnerApproval,
  extractSellingRates,
  mergeOwnerApprovalsForStaff,
  overlayLiveSellingRates,
  productRatesTargetKey,
  restoreAssignedSchemeIds,
  restoreSellingRatesFromCloud,
  sellingRatesEqual,
  upsertPendingApproval,
  zeroSellingRates,
} from "./owner-approvals";

function product(partial: Partial<Product> & Pick<Product, "id">): Product {
  return {
    code: partial.code || "SKU",
    category: "tarpaulin",
    itemName: { en: "Tarpaulin", hi: "तिरपाल" },
    name: { en: "HDPE", hi: "एचडीपीई" },
    description: { en: "", hi: "" },
    unit: "kg",
    baseRate: 100,
    pricingMode: "bundle",
    minOrderQty: 1,
    stock: 1,
    variations: [
      {
        id: "v1",
        label: { en: "12x18", hi: "12x18" },
        size: { en: "12x18", hi: "12x18" },
        sku: "SKU-1",
        rate: 100,
        stock: 1,
      },
    ],
    colors: [],
    media: [],
    active: true,
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function scheme(id: string, active = true): Scheme {
  return {
    id,
    name: { en: "Lift", hi: "लिफ्ट" },
    description: { en: "", hi: "" },
    termsAndConditions: { en: "", hi: "" },
    targetWeightKg: 1000,
    rewardType: "per_kg_rate",
    creditAmount: 0,
    discountPerKg: 1,
    levels: [],
    scopeType: "all",
    scopeProductIds: [],
    appliesToAllDealers: true,
    active,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function user(id: string, schemes: string[] = []): UserProfile {
  return {
    id,
    name: "Ram",
    phone: "9000000001",
    passwordHash: "x",
    role: "customer",
    locale: "en",
    walletBalance: 0,
    assignedSchemeIds: schemes,
    liftingProgressKg: 0,
    schemeProgress: {},
    active: true,
    approved: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("selling rate diff", () => {
  it("detects variation.rate changes and ignores equal snapshots", () => {
    const live = extractSellingRates(product({ id: "p1" }));
    const next = extractSellingRates(
      product({
        id: "p1",
        baseRate: 120,
        variations: [
          {
            id: "v1",
            label: { en: "12x18", hi: "12x18" },
            size: { en: "12x18", hi: "12x18" },
            sku: "SKU-1",
            rate: 120,
            stock: 1,
          },
        ],
      })
    );
    expect(sellingRatesEqual(live, live)).toBe(true);
    expect(sellingRatesEqual(live, next)).toBe(false);
  });

  it("zeros new-product rates and restores cloud rates after a staff overlay", () => {
    const live = product({ id: "p1", baseRate: 100 });
    const staff = product({
      id: "p1",
      name: { en: "Renamed", hi: "Renamed" },
      baseRate: 999,
      variations: [
        {
          id: "v1",
          label: { en: "12x18", hi: "12x18" },
          size: { en: "12x18", hi: "12x18" },
          sku: "SKU-1",
          rate: 999,
          stock: 4,
        },
      ],
    });
    overlayLiveSellingRates(staff, live);
    expect(staff.name.en).toBe("Renamed");
    expect(staff.baseRate).toBe(100);
    expect(staff.variations[0].rate).toBe(100);
    expect(staff.variations[0].stock).toBe(4);

    const created = zeroSellingRates(
      product({ id: "p2", baseRate: 80, variations: [{ ...product({ id: "x" }).variations[0], rate: 80 }] })
    );
    expect(created.baseRate).toBe(0);
    expect(created.variations[0].rate).toBe(0);

    const restored = restoreSellingRatesFromCloud(
      [
        product({ id: "p1", baseRate: 50, variations: [{ ...live.variations[0], rate: 50 }] }),
        product({ id: "p-new", baseRate: 70 }),
      ],
      [live]
    );
    expect(restored.find((p) => p.id === "p1")?.variations[0].rate).toBe(100);
    expect(restored.find((p) => p.id === "p-new")?.baseRate).toBe(0);
  });
});

describe("pending queue", () => {
  it("replaces the last pending row for the same target", () => {
    const first = upsertPendingApproval([], {
      kind: "product_rates",
      targetKey: productRatesTargetKey("p1"),
      productId: "p1",
      title: "Rate p1",
      snapshot: { proposed: { baseRate: 110, variations: [] } },
      requestedBy: "staff1",
    });
    expect(first).toHaveLength(1);
    const second = upsertPendingApproval(first, {
      kind: "product_rates",
      targetKey: productRatesTargetKey("p1"),
      productId: "p1",
      title: "Rate p1",
      snapshot: { proposed: { baseRate: 125, variations: [] } },
      requestedBy: "staff2",
    });
    expect(second).toHaveLength(1);
    expect(second[0].id).toBe(first[0].id);
    expect(second[0].requestedBy).toBe("staff2");
    expect((second[0].snapshot.proposed as { baseRate: number }).baseRate).toBe(125);
  });
});

describe("apply and reject", () => {
  it("applies product rates, scheme upsert/delete, and dealer assign", () => {
    const p = product({ id: "p1" });
    const s = scheme("s1", true);
    const dealer = user("u1", []);
    const db = {
      products: [p],
      schemes: [s],
      users: [dealer],
      ownerApprovals: [] as OwnerApproval[],
    };

    applyOwnerApproval(db, {
      id: "a1",
      kind: "product_rates",
      status: "pending",
      targetKey: productRatesTargetKey("p1"),
      productId: "p1",
      title: "rates",
      snapshot: {
        proposed: {
          baseRate: 140,
          variations: [{ id: "v1", rate: 140 }],
        },
      },
      requestedBy: "staff",
      requestedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(p.baseRate).toBe(140);
    expect(p.variations[0].rate).toBe(140);

    applyOwnerApproval(db, {
      id: "a2",
      kind: "scheme_upsert",
      status: "pending",
      targetKey: "scheme_upsert:s2",
      schemeId: "s2",
      title: "new scheme",
      snapshot: { proposed: scheme("s2", false) },
      requestedBy: "staff",
      requestedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(db.schemes.some((x) => x.id === "s2")).toBe(true);

    applyOwnerApproval(db, {
      id: "a3",
      kind: "scheme_assign",
      status: "pending",
      targetKey: "scheme_assign:u1:s1",
      dealerId: "u1",
      schemeId: "s1",
      title: "assign",
      snapshot: { proposed: { dealerId: "u1", schemeId: "s1", assigned: true } },
      requestedBy: "staff",
      requestedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(dealer.assignedSchemeIds).toEqual(["s1"]);

    applyOwnerApproval(db, {
      id: "a4",
      kind: "scheme_delete",
      status: "pending",
      targetKey: "scheme_delete:s1",
      schemeId: "s1",
      title: "delete",
      snapshot: { before: s },
      requestedBy: "staff",
      requestedAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(db.schemes.some((x) => x.id === "s1")).toBe(false);
    expect(dealer.assignedSchemeIds).toEqual([]);
  });

  it("applies newly approved rows on owner merge and ignores already-approved", () => {
    const p = product({ id: "p1" });
    const db = { products: [p], schemes: [], users: [] };
    const cloud: OwnerApproval[] = [
      {
        id: "old",
        kind: "product_rates",
        status: "approved",
        targetKey: productRatesTargetKey("p1"),
        productId: "p1",
        title: "old",
        snapshot: { proposed: { baseRate: 50, variations: [{ id: "v1", rate: 50 }] } },
        requestedBy: "s",
        requestedAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
      },
    ];
    const incoming: OwnerApproval[] = [
      cloud[0],
      {
        id: "new",
        kind: "product_rates",
        status: "approved",
        targetKey: productRatesTargetKey("p1"),
        productId: "p1",
        title: "new",
        snapshot: { proposed: { baseRate: 160, variations: [{ id: "v1", rate: 160 }] } },
        requestedBy: "s",
        requestedAt: "2026-09-01T00:00:00.000Z",
        decidedAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    ];
    applyNewlyApprovedOwnerApprovals(db, incoming, cloud);
    expect(p.baseRate).toBe(160);
  });
});

describe("staff merge cannot approve or rewrite live schemes/rates", () => {
  it("keeps decided history and only overlays pending by targetKey", () => {
    const cloud: OwnerApproval[] = [
      {
        id: "done",
        kind: "product_rates",
        status: "approved",
        targetKey: "product_rates:p0",
        productId: "p0",
        title: "done",
        snapshot: {},
        requestedBy: "s",
        requestedAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      {
        id: "pend",
        kind: "product_rates",
        status: "pending",
        targetKey: "product_rates:p1",
        productId: "p1",
        title: "pend",
        snapshot: { proposed: { baseRate: 110, variations: [] } },
        requestedBy: "s",
        requestedAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const incoming: OwnerApproval[] = [
      { ...cloud[1], status: "approved", snapshot: { proposed: { baseRate: 1, variations: [] } } },
      {
        id: "other",
        kind: "product_rates",
        status: "pending",
        targetKey: "product_rates:p2",
        productId: "p2",
        title: "p2",
        snapshot: { proposed: { baseRate: 90, variations: [] } },
        requestedBy: "s2",
        requestedAt: "2026-09-02T00:00:00.000Z",
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    ];
    const merged = mergeOwnerApprovalsForStaff(incoming, cloud, false);
    expect(merged.find((r) => r.id === "done")?.status).toBe("approved");
    const p1 = merged.find((r) => r.targetKey === "product_rates:p1");
    expect(p1?.status).toBe("pending");
    expect(merged.some((r) => r.targetKey === "product_rates:p2")).toBe(true);
  });

  it("owner review can mark a row approved", () => {
    const cloud: OwnerApproval[] = [
      {
        id: "pend",
        kind: "scheme_upsert",
        status: "pending",
        targetKey: "scheme_upsert:s1",
        schemeId: "s1",
        title: "s",
        snapshot: {},
        requestedBy: "s",
        requestedAt: "2026-09-01T00:00:00.000Z",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    const incoming: OwnerApproval[] = [
      {
        ...cloud[0],
        status: "approved",
        decidedBy: "owner",
        updatedAt: "2026-09-02T00:00:00.000Z",
      },
    ];
    const merged = mergeOwnerApprovalsForStaff(incoming, cloud, true);
    expect(merged[0].status).toBe("approved");
  });

  it("restores assignedSchemeIds from cloud for staff user merges", () => {
    const cloud = [user("u1", ["s1"])];
    const incoming = [user("u1", ["s1", "s2"])];
    const out = restoreAssignedSchemeIds(incoming, cloud);
    expect(out[0].assignedSchemeIds).toEqual(["s1"]);
  });
});
