import { describe, expect, it } from "vitest";
import {
  mergeAuthorizedPush,
  staffScopedProjection,
} from "./authorize-db";
import type { AppDatabase } from "@/lib/store/db";
import type { UserProfile } from "@/lib/types";
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

function emptyDb(users: UserProfile[]): AppDatabase {
  return {
    users,
    products: [],
    orders: [],
    schemes: [],
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
    waInbox: {
      messages: [
        {
          id: "m1",
          phone: "919876543210",
          direction: "in",
          kind: "text",
          text: "Need rate",
          at: "2026-08-01T10:00:00.000Z",
        },
      ],
      reads: [],
      pins: [{ phone: "919876543210", at: "2026-08-01T10:00:00.000Z" }],
      notes: [
        {
          id: "n1",
          phone: "919876543210",
          text: "staff only",
          at: "2026-08-01T10:01:00.000Z",
          staffUserId: "own",
          staffName: "Owner",
        },
      ],
    },
  } as AppDatabase;
}

const ownerSession: ServerSession = {
  id: "own",
  phone: "9000000000",
  name: "Owner",
  role: "super_admin",
  locale: "en",
  exp: Math.floor(Date.now() / 1000) + 3600,
};

describe("WhatsApp inbox stays off the browser document", () => {
  it("strips waInbox from owner GET", () => {
    const owner = user({ id: "own", role: "super_admin" });
    const db = emptyDb([owner]);
    const out = staffScopedProjection(db, owner);
    expect(out.waInbox).toBeUndefined();
  });

  it("keeps cloud inbox when owner PUT omits it", () => {
    const owner = user({ id: "own", role: "super_admin" });
    const cloud = emptyDb([owner]);
    const incoming = {
      ...cloud,
      waInbox: undefined,
      products: cloud.products,
    };
    const merged = mergeAuthorizedPush(incoming, cloud, ownerSession);
    expect(merged.db.waInbox?.messages.map((m) => m.id)).toEqual(["m1"]);
    expect(merged.db.waInbox?.pins?.[0].phone).toBe("919876543210");
    expect(merged.db.waInbox?.notes?.[0].text).toBe("staff only");
  });
});
