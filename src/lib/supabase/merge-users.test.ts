import { describe, expect, it } from "vitest";
import { mergeLocalUsersIntoRemote } from "./sync";
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
    createdAt: "2026-08-09T11:52:01.442Z",
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

describe("mergeLocalUsersIntoRemote", () => {
  it("does not pull a deleted dealer back from localStorage", () => {
    const owner = user({
      id: "admin",
      role: "super_admin",
      phone: "6386685663",
    });
    const dealer = user({
      id: "d1",
      role: "customer",
      name: "TEST DEALER",
    });
    const local = db([owner, dealer]);
    const remote = db([owner]);
    remote.deletedUserIds = ["d1"];
    remote.deletedUserAt = { d1: "2026-08-21T12:00:00.000Z" };
    const merged = mergeLocalUsersIntoRemote(local, remote);
    expect(merged.users.map((u) => u.id)).toEqual(["admin"]);
  });

  it("does not re-add a local-only dealer when cloud has no row", () => {
    const owner = user({
      id: "admin",
      role: "super_admin",
      phone: "6386685663",
    });
    const dealer = user({
      id: "d1",
      role: "customer",
      name: "TEST DEALER",
    });
    const merged = mergeLocalUsersIntoRemote(db([owner, dealer]), db([owner]));
    expect(merged.users.map((u) => u.id)).toEqual(["admin"]);
  });
});
