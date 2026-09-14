import { describe, expect, it } from "vitest";
import { mergeAuthorizedPush } from "./authorize-db";
import type { AppDatabase } from "@/lib/store/db";
import type { UserProfile } from "@/lib/types";
import type { ServerSession } from "./session";

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

const ownerSession: ServerSession = {
  id: "admin",
  phone: "6386685663",
  name: "tanmay",
  role: "super_admin",
  locale: "en",
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe("owner push after dealer delete", () => {
  it("does not resurrect a dealer the cloud already dropped", () => {
    const owner = user({
      id: "admin",
      role: "super_admin",
      name: "tanmay",
      phone: "6386685663",
    });
    const dealer = user({
      id: "d1",
      role: "customer",
      name: "TEST DEALER",
      phone: "0000000000",
    });
    const cloud = db([owner]);
    cloud.deletedUserIds = ["d1"];
    cloud.deletedUserAt = { d1: "2026-08-21T12:00:00.000Z" };
    const incoming = db([owner, dealer]);
    const { db: out } = mergeAuthorizedPush(incoming, cloud, ownerSession);
    expect(out.users.map((u) => u.id)).toEqual(["admin"]);
    expect(out.deletedUserIds).toContain("d1");
  });

  it("does not re-add a stale local dealer when cloud has no tomb yet", () => {
    const owner = user({
      id: "admin",
      role: "super_admin",
      name: "tanmay",
      phone: "6386685663",
    });
    const dealer = user({
      id: "d1",
      role: "customer",
      name: "TEST DEALER",
    });
    const cloud = db([owner]);
    const incoming = db([owner, dealer]);
    const { db: out } = mergeAuthorizedPush(incoming, cloud, ownerSession);
    expect(out.users.map((u) => u.id)).toEqual(["admin"]);
  });

  it("keeps a dealer password-reset request when the owner push omits it", () => {
    const owner = user({
      id: "admin",
      role: "super_admin",
      name: "tanmay",
      phone: "6386685663",
    });
    const dealer = user({
      id: "d1",
      role: "customer",
      name: "TEST DEALER",
      passwordHash: "same",
    });
    const cloud = db([
      owner,
      {
        ...dealer,
        passwordResetRequestedAt: "2026-08-24T08:00:00.000Z",
      },
    ]);
    const incoming = db([owner, dealer]);
    const { db: out } = mergeAuthorizedPush(incoming, cloud, ownerSession);
    const saved = out.users.find((u) => u.id === "d1");
    expect(saved?.passwordResetRequestedAt).toBe("2026-08-24T08:00:00.000Z");
  });
});
