import { describe, expect, it } from "vitest";
import { purgeOpsDataKeepCatalog } from "./purge-ops";
import type { AppDatabase } from "@/lib/store/db";
import type { Product, UserProfile } from "@/lib/types";

function user(
  partial: Partial<UserProfile> & Pick<UserProfile, "id" | "role" | "phone">
): UserProfile {
  return {
    passwordHash: "hash",
    name: partial.name || "N",
    locale: "en",
    walletBalance: 99,
    assignedSchemeIds: [],
    liftingProgressKg: 10,
    schemeProgress: { s1: 4 },
    active: true,
    approved: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

function db(partial: Partial<AppDatabase> = {}): AppDatabase {
  return {
    users: [],
    products: [],
    orders: [],
    schemes: [],
    walletTransactions: [],
    walletDeposits: [],
    shippingRules: [],
    categories: [],
    settings: { companyName: "TT Enterprises" } as AppDatabase["settings"],
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
    ...partial,
  };
}

describe("purgeOpsDataKeepCatalog", () => {
  it("keeps catalog stock and all owners, wipes orders and dealers", () => {
    const ownerA = user({
      id: "oa",
      role: "super_admin",
      phone: "6386685663",
      name: "Owner A",
    });
    const ownerB = user({
      id: "ob",
      role: "super_admin",
      phone: "9000000001",
      name: "Owner B",
    });
    const dealer = user({
      id: "d1",
      role: "customer",
      phone: "9000000002",
      name: "Dealer",
    });
    const product = {
      id: "p1",
      code: "HD-1",
      stock: 42,
      stockMatrix: { a__b: 42 },
    } as unknown as Product;

    const { db: next, result } = purgeOpsDataKeepCatalog(
      db({
        users: [ownerA, ownerB, dealer],
        products: [product],
        schemes: [{ id: "sc1" } as unknown as AppDatabase["schemes"][number]],
        orders: [{ id: "o1" } as unknown as AppDatabase["orders"][number]],
        parties: [{ id: "pt1" } as unknown as AppDatabase["parties"][number]],
        vouchers: [{ id: "v1" } as unknown as AppDatabase["vouchers"][number]],
      }),
      "6386685663"
    );

    expect(result.ok).toBe(true);
    expect(result.keptUsers).toBe(2);
    expect(result.removedUsers).toBe(1);
    expect(result.removedOrders).toBe(1);
    expect(result.keptProducts).toBe(1);
    expect(next.users.map((u) => u.id).sort()).toEqual(["oa", "ob"]);
    expect(next.users.every((u) => u.walletBalance === 0)).toBe(true);
    expect(next.products[0]?.stock).toBe(42);
    expect(next.products[0]?.stockMatrix?.a__b).toBe(42);
    expect(next.schemes).toHaveLength(1);
    expect(next.orders).toEqual([]);
    expect(next.parties).toEqual([]);
    expect(next.vouchers).toEqual([]);
    expect(next.settings.opsPurgeAt).toBeTruthy();
  });

  it("does not wipe catalog unless clearCatalog is true", () => {
    const owner = user({
      id: "oa",
      role: "super_admin",
      phone: "6386685663",
    });
    const product = { id: "p1", stock: 7 } as unknown as Product;
    const kept = purgeOpsDataKeepCatalog(
      db({ users: [owner], products: [product] }),
      "6386685663"
    );
    expect(kept.result.keptProducts).toBe(1);

    const wiped = purgeOpsDataKeepCatalog(
      db({ users: [owner], products: [product] }),
      "6386685663",
      { clearCatalog: true }
    );
    expect(wiped.result.keptProducts).toBe(0);
    expect(wiped.db.products).toEqual([]);
  });
});
