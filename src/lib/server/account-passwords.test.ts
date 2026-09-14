import { describe, expect, it } from "vitest";
import { shouldNotifyForgotAgain } from "./account-passwords";
import { hashPasswordSecure, verifyPassword } from "./session";
import { mergePasswordResetRequests } from "@/lib/supabase/sanitize";
import type { AppDatabase } from "@/lib/store/db";
import type { UserProfile } from "@/lib/types";

function user(
  partial: Partial<UserProfile> & Pick<UserProfile, "id" | "role">
): UserProfile {
  return {
    passwordHash: "hash-a",
    name: partial.name || "N",
    phone: partial.phone || "9000000001",
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

describe("password reset request merge", () => {
  it("keeps a cloud request that a stale client never saw", () => {
    const dealer = user({ id: "d1", role: "customer" });
    const incoming = db([dealer]);
    const cloud = db([
      user({
        id: "d1",
        role: "customer",
        passwordResetRequestedAt: "2026-08-24T08:00:00.000Z",
      }),
    ]);
    const out = mergePasswordResetRequests(incoming, cloud);
    expect(out.users[0].passwordResetRequestedAt).toBe(
      "2026-08-24T08:00:00.000Z"
    );
  });

  it("drops the request when the password hash changed", () => {
    const incoming = db([
      user({ id: "d1", role: "customer", passwordHash: "new-hash" }),
    ]);
    const cloud = db([
      user({
        id: "d1",
        role: "customer",
        passwordHash: "old-hash",
        passwordResetRequestedAt: "2026-08-24T08:00:00.000Z",
      }),
    ]);
    const out = mergePasswordResetRequests(incoming, cloud);
    expect(out.users[0].passwordResetRequestedAt).toBeUndefined();
  });
});

describe("forgot notify cooldown", () => {
  it("notifies the first time and skips inside 30 minutes", () => {
    expect(shouldNotifyForgotAgain(undefined)).toBe(true);
    const now = Date.parse("2026-08-24T09:00:00.000Z");
    expect(
      shouldNotifyForgotAgain("2026-08-24T08:45:00.000Z", now)
    ).toBe(false);
    expect(
      shouldNotifyForgotAgain("2026-08-24T08:20:00.000Z", now)
    ).toBe(true);
  });
});

describe("scrypt verify", () => {
  it("verifies a newly hashed password", () => {
    const stored = hashPasswordSecure("secret12");
    expect(verifyPassword("secret12", stored)).toBe(true);
    expect(verifyPassword("wrong-one", stored)).toBe(false);
  });
});
