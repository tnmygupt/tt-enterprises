import { describe, expect, it } from "vitest";
import {
  assembleAppDatabase,
  splitAppDatabase,
} from "@/lib/server/host-sql";
import type { AppDatabase } from "@/lib/store/db";

function sampleDb(): AppDatabase {
  return {
    users: [{ id: "u1", name: "Owner", phone: "9999999999" }] as AppDatabase["users"],
    products: [
      {
        id: "p1",
        code: "RT170",
        variations: [{ id: "v1", size: "12x18" }],
      },
    ] as unknown as AppDatabase["products"],
    orders: [
      {
        id: "o1",
        lines: [{ productId: "p1", quantity: 2 }],
      },
    ] as unknown as AppDatabase["orders"],
    schemes: [],
    walletTransactions: [],
    walletDeposits: [],
    shippingRules: [],
    categories: [],
    settings: { companyName: "T T Enterprises" } as AppDatabase["settings"],
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
    deletedUserIds: ["gone"],
    deletedUserAt: { gone: "2026-01-01T00:00:00.000Z" },
    rolePresets: {},
    staffJobs: [],
    peopleActivity: [],
    bankRecons: [],
    waInbox: { messages: [], reads: [] },
  };
}

describe("host-sql split/assemble", () => {
  it("round-trips nested product and order JSON", () => {
    const src = sampleDb();
    const split = splitAppDatabase(src);
    expect(split.collections.products).toHaveLength(1);
    expect(split.collections.products[0].id).toBe("p1");
    expect(split.meta.settings).toMatchObject({ companyName: "T T Enterprises" });
    const collections: Record<string, unknown[]> = {};
    for (const [table, rows] of Object.entries(split.collections)) {
      collections[table] = rows.map((r) => r.body);
    }
    const back = assembleAppDatabase({ collections, meta: split.meta });
    expect(back.users[0].id).toBe("u1");
    expect(back.products[0].id).toBe("p1");
    expect((back.products[0] as { variations: { id: string }[] }).variations[0].id).toBe(
      "v1"
    );
    expect(back.orders[0].id).toBe("o1");
    expect(back.deletedUserIds).toEqual(["gone"]);
    expect(back.settings.companyName).toBe("T T Enterprises");
  });

  it("empty collections stay empty arrays", () => {
    const split = splitAppDatabase(sampleDb());
    expect(split.collections.vouchers).toEqual([]);
    const back = assembleAppDatabase({
      collections: { users: [], products: [], orders: [] },
      meta: split.meta,
    });
    expect(back.vouchers).toEqual([]);
    expect(back.users).toEqual([]);
  });
});
