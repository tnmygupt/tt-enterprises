import { describe, expect, it } from "vitest";
import { liveLoginUser, liveSessionUser } from "./live-login";
import { resolveCloudActor } from "./authorize-db";
import type { ServerSession } from "./session";
import type { AppDatabase } from "@/lib/store/db";
import type { UserProfile } from "@/lib/types";

function user(partial: Partial<UserProfile> & Pick<UserProfile, "id" | "role">): UserProfile {
  return {
    passwordHash: "hash",
    name: partial.name || "N",
    phone: partial.phone || "9250205615",
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

describe("liveLoginUser", () => {
  it("refuses a tombstoned dealer even if the row is still present", () => {
    const dealer = user({
      id: "user_ef8a13cf-f678-495d-abf4-27e3f528cc5b",
      role: "customer",
      name: "TEST DEALER",
    });
    const doc = db([dealer]);
    doc.deletedUserIds = [dealer.id];
    doc.deletedUserAt = { [dealer.id]: "2026-08-21T11:01:43.557Z" };
    expect(liveLoginUser(doc, "9250205615")).toBeUndefined();
    expect(liveSessionUser(doc, dealer.id)).toBeUndefined();
  });

  it("allows an active approved dealer", () => {
    const dealer = user({
      id: "d1",
      role: "customer",
      phone: "9005014631",
    });
    expect(liveLoginUser(db([dealer]), "9005014631")?.id).toBe("d1");
  });

  it("skips a tombstoned row and logs in the live dealer on the same phone", () => {
    const old = user({
      id: "old",
      role: "customer",
      phone: "1234567890",
      name: "Tanmay Gupta",
    });
    const live = user({
      id: "new",
      role: "customer",
      phone: "1234567890",
      name: "TEST",
      createdAt: "2026-08-21T11:22:35.087Z",
    });
    const doc = db([old, live]);
    doc.deletedUserIds = ["old"];
    doc.deletedUserAt = { old: "2026-08-21T11:00:00.000Z" };
    expect(liveLoginUser(doc, "1234567890")?.id).toBe("new");
  });
});

function sessionFor(id: string): ServerSession {
  return {
    id,
    phone: "9250205615",
    name: "N",
    role: "customer",
    locale: "en",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

describe("resolveCloudActor", () => {
  it("refuses tombstoned sessions the same way login GET does", () => {
    const dealer = user({
      id: "gone",
      role: "customer",
    });
    const doc = db([dealer]);
    doc.deletedUserIds = ["gone"];
    doc.deletedUserAt = { gone: "2026-08-21T11:01:43.557Z" };
    expect(() => resolveCloudActor(doc, sessionFor("gone"))).toThrow(
      /Account not found/
    );
  });

  it("refuses disabled accounts", () => {
    const staff = user({
      id: "s1",
      role: "sales",
      active: false,
    });
    expect(() => resolveCloudActor(db([staff]), sessionFor("s1"))).toThrow(
      /disabled/
    );
  });
});
