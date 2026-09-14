import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../seed";
import type { AppDatabase } from "../store/db";
import type { Order } from "../types";
import {
  localPendingDiffers,
  mergeLocalPendingIntoRemote,
} from "./sync";

function order(id: string, createdAt: string): Order {
  return {
    id,
    orderNumber: `TT-EST-${id}`,
    userId: "dealer1",
    userName: "Dealer",
    status: "estimate",
    lines: [],
    subtotal: 0,
    shippingAmount: 0,
    estimatedTotal: 0,
    walletUsed: 0,
    timeline: [],
    createdAt,
    updatedAt: createdAt,
  } as unknown as Order;
}

function db(partial: Partial<AppDatabase>): AppDatabase {
  return {
    users: [],
    products: [],
    orders: [],
    schemes: [],
    walletTransactions: [],
    walletDeposits: [],
    shippingRules: [],
    categories: [],
    settings: structuredClone(DEFAULT_SETTINGS),
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

describe("mergeLocalPendingIntoRemote", () => {
  it("keeps a post-purge cloud estimate when local wipe stamp is newer but empty", () => {
    const local = db({
      settings: { ...DEFAULT_SETTINGS, opsPurgeAt: "2026-08-22T08:00:00.000Z" },
      orders: [],
    });
    const remote = db({
      settings: { ...DEFAULT_SETTINGS, opsPurgeAt: "2026-08-22T06:41:20.732Z" },
      orders: [order("o1", "2026-08-22T08:10:00.000Z")],
    });
    const merged = mergeLocalPendingIntoRemote(local, remote);
    expect(merged.orders.map((o) => o.id)).toEqual(["o1"]);
  });

  it("does not treat a stale empty browser as a wipe when purge stamps match", () => {
    const stamp = "2026-08-22T06:41:20.732Z";
    const local = db({
      settings: { ...DEFAULT_SETTINGS, opsPurgeAt: stamp },
      orders: [],
    });
    const remote = db({
      settings: { ...DEFAULT_SETTINGS, opsPurgeAt: stamp },
      orders: [order("o1", "2026-08-22T07:05:21.014Z")],
    });
    const merged = mergeLocalPendingIntoRemote(local, remote);
    expect(merged.orders).toHaveLength(1);
    expect(localPendingDiffers(local, merged, remote)).toBe(false);
  });

  it("does not push when only the local purge stamp is newer", () => {
    const local = db({
      settings: { ...DEFAULT_SETTINGS, opsPurgeAt: "2026-08-22T08:00:00.000Z" },
      orders: [],
    });
    const remote = db({
      settings: { ...DEFAULT_SETTINGS, opsPurgeAt: "2026-08-22T06:41:20.732Z" },
      orders: [order("o1", "2026-08-22T08:10:00.000Z")],
    });
    const merged = mergeLocalPendingIntoRemote(local, remote);
    expect(merged.orders).toHaveLength(1);
    expect(localPendingDiffers(local, merged, remote)).toBe(false);
  });
});
