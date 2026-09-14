import { describe, expect, it } from "vitest";
import { applyDeleteLogin } from "./dealer-review";
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

describe("applyDeleteLogin", () => {
  it("tombs a dealer and unlinks the party", () => {
    const dealer = user({
      id: "u1",
      role: "customer",
      name: "TEST DEALER",
    });
    const owner = user({
      id: "admin",
      role: "super_admin",
      name: "tanmay",
    });
    const doc = db([owner, dealer]);
    doc.parties = [
      {
        id: "p1",
        name: "TEST DEALER",
        phone: "0000000000",
        type: "customer",
        linkedUserId: "u1",
        openingBalance: 0,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    applyDeleteLogin(doc, "u1", "admin");
    expect(doc.users.map((u) => u.id)).toEqual(["admin"]);
    expect(doc.deletedUserIds).toContain("u1");
    expect(doc.parties[0].linkedUserId).toBeUndefined();
    expect(doc.parties[0].active).toBe(false);
  });

  it("refuses to delete the last owner", () => {
    const owner = user({ id: "admin", role: "super_admin", name: "tanmay" });
    const other = user({
      id: "admin2",
      role: "super_admin",
      name: "papa",
    });
    const one = db([owner]);
    expect(() => applyDeleteLogin(one, "admin", "admin")).toThrow(/own account/);
    const two = db([owner, other]);
    expect(() => applyDeleteLogin(two, "admin2", "admin")).not.toThrow();
    expect(two.users.map((u) => u.id)).toEqual(["admin"]);
  });

  it("tombs even when the row is already gone", () => {
    const owner = user({ id: "admin", role: "super_admin", name: "tanmay" });
    const doc = db([owner]);
    applyDeleteLogin(doc, "missing", "admin");
    expect(doc.deletedUserIds).toContain("missing");
  });
});
