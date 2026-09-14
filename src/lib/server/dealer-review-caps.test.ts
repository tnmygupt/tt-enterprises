import { describe, expect, it } from "vitest";
import { actorMayApproveDealers, actorMayViewDealers } from "./dealer-review";
import type { AppDatabase } from "@/lib/store/db";
import type { UserProfile } from "@/lib/types";

function user(partial: Partial<UserProfile> & Pick<UserProfile, "id" | "role">): UserProfile {
  return {
    passwordHash: "x",
    name: partial.name || "N",
    phone: partial.phone || "0000000000",
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

function db(users: UserProfile[]): AppDatabase {
  return {
    users,
    products: [],
    orders: [],
    schemes: [],
    walletTransactions: [],
    walletDeposits: [],
    shippingRules: [],
    categories: [],
    settings: {} as AppDatabase["settings"],
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
  };
}

describe("dealer review caps", () => {
  it("lets accounts and plant manage dealer files; owner keeps staff CRUD", () => {
    const accounts = user({ id: "a", role: "accounts" });
    const owner = user({ id: "o", role: "super_admin" });
    const plant = user({ id: "p", role: "plant_manager" });
    const books = db([accounts, owner, plant]);
    expect(actorMayApproveDealers(accounts, books)).toBe(true);
    expect(actorMayViewDealers(accounts, books)).toBe(true);
    expect(actorMayApproveDealers(owner, books)).toBe(true);
    expect(actorMayApproveDealers(plant, books)).toBe(true);
    expect(actorMayViewDealers(plant, books)).toBe(true);
  });
});
