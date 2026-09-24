import { describe, expect, it } from "vitest";
import {
  dealerScopedProjection,
  mergeAuthorizedPush,
  staffScopedProjection,
} from "./authorize-db";
import type { AppDatabase } from "@/lib/store/db";
import type { OwnerApproval, Product, Scheme, UserProfile } from "@/lib/types";
import type { ServerSession } from "./session";

function user(
  partial: Partial<UserProfile> & Pick<UserProfile, "id" | "role">
): UserProfile {
  return {
    passwordHash: "x",
    name: partial.name || "N",
    phone: partial.phone || "9000000000",
    locale: "en",
    walletBalance: 0,
    assignedSchemeIds: [],
    liftingProgressKg: 0,
    schemeProgress: {},
    active: true,
    approved: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
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
    pricingMode: "bundle",
    minOrderQty: 1,
    stock: 4,
    variations: [
      {
        id: "v1",
        label: { en: "12x18", hi: "12x18" },
        size: { en: "12x18", hi: "12x18" },
        sku: "TARP-1",
        rate: 100,
        stock: 4,
      },
    ],
    colors: [],
    media: [],
    active: true,
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function scheme(): Scheme {
  return {
    id: "s1",
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
    active: true,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function emptyDb(users: UserProfile[]): AppDatabase {
  return {
    users,
    products: [product()],
    orders: [],
    schemes: [scheme()],
    walletTransactions: [],
    walletDeposits: [],
    shippingRules: [],
    categories: [],
    settings: { companyName: "TT" } as AppDatabase["settings"],
    accounts: [],
    parties: [],
    vouchers: [],
    ledgerEntries: [],
    stockMovements: [],
    stockBatches: [],
    batchConsumptions: [],
    billAllocations: [],
    purchaseOrders: [],
    goodsReceipts: [],
    supplierContracts: [],
    tallyPosts: [],
    statementMatches: [],
    accessPlaces: [],
    ownerApprovals: [],
  } as AppDatabase;
}

const plantSession: ServerSession = {
  id: "plant",
  phone: "9000000000",
  name: "Plant",
  role: "plant_manager",
  locale: "en",
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const accountsSession: ServerSession = {
  id: "acc",
  phone: "9000000001",
  name: "Books",
  role: "accounts",
  locale: "en",
  exp: Math.floor(Date.now() / 1000) + 3600,
};

const ownerSession: ServerSession = {
  id: "owner",
  phone: "9000000002",
  name: "Owner",
  role: "super_admin",
  locale: "en",
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe("staff merge cannot change live selling rates or schemes", () => {
  it("restores variation.rate from cloud after a plant product push", () => {
    const plant = user({ id: "plant", role: "plant_manager", name: "Plant" });
    const owner = user({ id: "owner", role: "super_admin", name: "Owner" });
    const cloud = emptyDb([owner, plant]);
    const incoming = emptyDb([owner, plant]);
    incoming.products = [
      {
        ...product(),
        name: { en: "Renamed", hi: "Renamed" },
        baseRate: 999,
        variations: [
          {
            ...product().variations[0],
            rate: 999,
          },
        ],
        updatedAt: "2026-09-19T12:00:00.000Z",
      },
    ];
    const { db: out } = mergeAuthorizedPush(incoming, cloud, plantSession);
    expect(out.products[0].name.en).toBe("Renamed");
    expect(out.products[0].baseRate).toBe(100);
    expect(out.products[0].variations[0].rate).toBe(100);
  });

  it("ignores staff scheme list replacement", () => {
    const accounts = user({ id: "acc", role: "accounts", name: "Books" });
    const owner = user({ id: "owner", role: "super_admin", name: "Owner" });
    const cloud = emptyDb([owner, accounts]);
    const incoming = emptyDb([owner, accounts]);
    incoming.schemes = [{ ...scheme(), active: false, discountPerKg: 9 }];
    const { db: out } = mergeAuthorizedPush(incoming, cloud, accountsSession);
    expect(out.schemes[0].active).toBe(true);
    expect(out.schemes[0].discountPerKg).toBe(1);
  });

  it("accepts staff pending ownerApprovals without applying them", () => {
    const plant = user({ id: "plant", role: "plant_manager", name: "Plant" });
    const owner = user({ id: "owner", role: "super_admin", name: "Owner" });
    const cloud = emptyDb([owner, plant]);
    const incoming = emptyDb([owner, plant]);
    const pending: OwnerApproval = {
      id: "oa1",
      kind: "product_rates",
      status: "pending",
      targetKey: "product_rates:p1",
      productId: "p1",
      title: "Rate · TARP",
      snapshot: {
        proposed: { baseRate: 140, variations: [{ id: "v1", rate: 140 }] },
      },
      requestedBy: "plant",
      requestedAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    };
    incoming.ownerApprovals = [pending];
    incoming.products = [
      {
        ...product(),
        baseRate: 140,
        variations: [{ ...product().variations[0], rate: 140 }],
        updatedAt: "2026-09-19T00:00:00.000Z",
      },
    ];
    const { db: out } = mergeAuthorizedPush(incoming, cloud, plantSession);
    expect(out.ownerApprovals?.some((r) => r.id === "oa1" && r.status === "pending")).toBe(
      true
    );
    expect(out.products[0].variations[0].rate).toBe(100);
  });

  it("staff cannot flip a pending row to approved", () => {
    const plant = user({ id: "plant", role: "plant_manager", name: "Plant" });
    const owner = user({ id: "owner", role: "super_admin", name: "Owner" });
    const pending: OwnerApproval = {
      id: "oa1",
      kind: "product_rates",
      status: "pending",
      targetKey: "product_rates:p1",
      productId: "p1",
      title: "Rate",
      snapshot: {
        proposed: { baseRate: 140, variations: [{ id: "v1", rate: 140 }] },
      },
      requestedBy: "plant",
      requestedAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    };
    const cloud = emptyDb([owner, plant]);
    cloud.ownerApprovals = [pending];
    const incoming = emptyDb([owner, plant]);
    incoming.ownerApprovals = [
      { ...pending, status: "approved", updatedAt: "2026-09-19T01:00:00.000Z" },
    ];
    const { db: out } = mergeAuthorizedPush(incoming, cloud, plantSession);
    expect(out.ownerApprovals?.[0].status).toBe("pending");
    expect(out.products[0].variations[0].rate).toBe(100);
  });
});

describe("owner merge can apply selling rates and schemes", () => {
  it("writes live variation.rate and schemes from the owner document", () => {
    const plant = user({ id: "plant", role: "plant_manager", name: "Plant" });
    const owner = user({ id: "owner", role: "super_admin", name: "Owner" });
    const cloud = emptyDb([owner, plant]);
    const incoming = emptyDb([owner, plant]);
    incoming.products = [
      {
        ...product(),
        baseRate: 140,
        variations: [{ ...product().variations[0], rate: 140 }],
        updatedAt: "2026-09-19T12:00:00.000Z",
      },
    ];
    incoming.schemes = [{ ...scheme(), active: false, discountPerKg: 2 }];
    const { db: out } = mergeAuthorizedPush(incoming, cloud, ownerSession);
    expect(out.products[0].variations[0].rate).toBe(140);
    expect(out.schemes[0].active).toBe(false);
    expect(out.schemes[0].discountPerKg).toBe(2);
  });

  it("applies a newly approved rate payload if products lagged", () => {
    const plant = user({ id: "plant", role: "plant_manager", name: "Plant" });
    const owner = user({ id: "owner", role: "super_admin", name: "Owner" });
    const pending: OwnerApproval = {
      id: "oa1",
      kind: "product_rates",
      status: "pending",
      targetKey: "product_rates:p1",
      productId: "p1",
      title: "Rate",
      snapshot: {
        proposed: { baseRate: 155, variations: [{ id: "v1", rate: 155 }] },
      },
      requestedBy: "plant",
      requestedAt: "2026-09-19T00:00:00.000Z",
      updatedAt: "2026-09-19T00:00:00.000Z",
    };
    const cloud = emptyDb([owner, plant]);
    cloud.ownerApprovals = [pending];
    const incoming = emptyDb([owner, plant]);
    incoming.ownerApprovals = [
      {
        ...pending,
        status: "approved",
        decidedBy: "owner",
        decidedAt: "2026-09-19T02:00:00.000Z",
        updatedAt: "2026-09-19T02:00:00.000Z",
      },
    ];
    const { db: out } = mergeAuthorizedPush(incoming, cloud, ownerSession);
    expect(out.products[0].variations[0].rate).toBe(155);
    expect(out.ownerApprovals?.[0].status).toBe("approved");
  });
});

describe("projections", () => {
  it("staff GET keeps pending ownerApprovals; dealer GET omits them", () => {
    const plant = user({ id: "plant", role: "plant_manager", name: "Plant" });
    const owner = user({ id: "owner", role: "super_admin", name: "Owner" });
    const dealer = user({ id: "d1", role: "customer", name: "Dealer" });
    const db = emptyDb([owner, plant, dealer]);
    db.ownerApprovals = [
      {
        id: "oa1",
        kind: "product_rates",
        status: "pending",
        targetKey: "product_rates:p1",
        productId: "p1",
        title: "Rate",
        snapshot: {},
        requestedBy: "plant",
        requestedAt: "2026-09-19T00:00:00.000Z",
        updatedAt: "2026-09-19T00:00:00.000Z",
      },
    ];
    const staff = staffScopedProjection(db, plant);
    expect(staff.ownerApprovals).toHaveLength(1);
    const dealerView = dealerScopedProjection(db, {
      id: "d1",
      phone: "9000000000",
      name: "Dealer",
      role: "customer",
      locale: "en",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    expect(dealerView.ownerApprovals ?? []).toEqual([]);
  });
});
