import { describe, expect, it } from "vitest";
import type { Order, Product, TallyItem, TallyPost, UserProfile } from "@/lib/types";
import {
  ackTallyPost,
  applyTallyAvailability,
  applyTallyStock,
  autoLinkTallyItems,
  cancelTallySale,
  createProductFromTallyItem,
  enqueueTallySale,
  linkTallyItem,
  linkTallyLedger,
  mergeTallyMasters,
  mergeTallyPosts,
  requestTallyLedger,
  reservedTallyQty,
  suggestTallyItemLink,
  tallyRegistrySummary,
  unlinkedTallyItems,
  upsertTallyRegistry,
  type TallyDb,
} from "@/lib/tally-sync";

function product(partial: Partial<Product> & Pick<Product, "id" | "code" | "name">): Product {
  return {
    category: "tarpaulin",
    itemName: partial.name,
    description: { en: "", hi: "" },
    unit: "bundle",
    baseRate: 10,
    pricingMode: "bundle",
    variations: [],
    colors: [],
    media: [],
    active: true,
    featured: false,
    stock: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as Product;
}

function order(partial: Partial<Order> & Pick<Order, "id" | "status">): Order {
  return {
    orderNumber: "TT-EST-00001",
    userId: "u1",
    userName: "Ram",
    userEmail: "",
    lines: [],
    subtotal: 100,
    shippingAmount: 0,
    walletUsed: 0,
    estimatedTotal: 100,
    fullTruckRequested: false,
    deliveryAddress: "",
    timeline: [],
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...partial,
  } as Order;
}

function db(products: Product[], orders: Order[] = [], posts: TallyPost[] = []): TallyDb {
  return {
    products,
    orders,
    tallyPosts: posts,
    users: [],
    settings: {
      companyName: "TT",
      phone: "",
      address: "",
      gstin: "",
      fullTruckMinWeightKg: 0,
      fullTruckMinValue: 0,
      upiId: "",
      upiPayeeName: "",
      bankAccount: {
        accountName: "",
        bankName: "",
        accountNumber: "",
        ifsc: "",
      },
    } as TallyDb["settings"],
  };
}

describe("applyTallyStock", () => {
  it("writes stock only through an explicit link, and keeps unmatched names as raw rows", () => {
    const data = db([
      product({
        id: "p1",
        code: "HDPE",
        name: { en: "HDPE Tirpal", hi: "एचडीपीई" },
        variations: [
          {
            id: "v1",
            label: { en: "12x18", hi: "12x18" },
            size: { en: "12x18", hi: "12x18" },
            sku: "HDPE-12",
            rate: 10,
            stock: 1,
            tallyItemId: "hdpe 12x18",
          },
        ],
      }),
      product({
        id: "p2",
        code: "NET-50",
        name: { en: "Shade Net 50", hi: "शेड नेट" },
        stock: 0,
      }),
    ]);

    const result = applyTallyStock(data, [
      { name: "HDPE 12x18", stock: 40 },
      { name: "Shade Net 50", sku: "NET-50", stock: 15 },
      { name: "Missing", sku: "NOPE", stock: 1 },
    ]);

    expect(result.applied).toBe(1);
    expect(result.unknown.map((u) => u.name).sort()).toEqual([
      "Missing",
      "Shade Net 50",
    ]);
    expect(data.products[0].variations[0].stock).toBe(40);
    expect(data.products[0].variations[0].tallyOnHand).toBe(40);
    expect(data.products[1].stock).toBe(0);
    expect(data.products[1].tallyItemId).toBeUndefined();
    expect(data.tallyItems).toHaveLength(3);
    expect(data.settings.tallySyncStatus).toBe("ok");
  });

  it("honours an explicit productId from the bridge", () => {
    const data = db([
      product({
        id: "p2",
        code: "NET-50",
        name: { en: "Shade Net", hi: "शेड" },
        stock: 0,
      }),
    ]);
    applyTallyStock(data, [
      { name: "Shade Net 50%", productId: "p2", stock: 15 },
    ]);
    expect(data.products[0].tallyItemId).toBe("shade net 50%");
    expect(data.products[0].stock).toBe(15);
  });
});

describe("tally reservations", () => {
  it("subtracts confirmed qty until the sale is acknowledged", () => {
    const data = db([
      product({
        id: "p1",
        code: "HDPE",
        name: { en: "HDPE", hi: "HDPE" },
        stock: 0,
        variations: [
          {
            id: "v1",
            label: { en: "12x18", hi: "12x18" },
            size: { en: "12x18", hi: "12x18" },
            sku: "HDPE-12",
            rate: 20,
            stock: 0,
          },
        ],
      }),
    ]);
    applyTallyStock(data, [
      { name: "HDPE 12x18", productId: "p1", variationId: "v1", stock: 10 },
    ]);
    expect(data.products[0].variations[0].stock).toBe(10);

    const confirmed = order({
      id: "o1",
      status: "confirmed",
      orderNumber: "TT-EST-00007",
      estimatedTotal: 40,
      lines: [
        {
          productId: "p1",
          productCode: "HDPE",
          productName: { en: "HDPE", hi: "HDPE" },
          variationId: "v1",
          unit: "bundle",
          pricingMode: "bundle",
          rate: 20,
          quantity: 4,
          weightKg: 1,
          lineTotal: 80,
        },
      ],
    });
    data.orders.push(confirmed);
    const post = enqueueTallySale(data, confirmed);
    applyTallyAvailability(data);
    expect(post?.remoteId).toBe("WEB-SALE-TT-EST-00007");
    expect(post?.status).toBe("pending");
    expect(reservedTallyQty(data, "p1", "v1")).toBe(4);
    expect(data.products[0].variations[0].stock).toBe(6);

    const again = enqueueTallySale(data, confirmed);
    expect(again?.id).toBe(post?.id);
    expect(data.tallyPosts.filter((p) => p.kind === "sale")).toHaveLength(1);

    ackTallyPost(data, post!.remoteId, "posted");
    applyTallyAvailability(data);
    expect(data.products[0].variations[0].tallyOnHand).toBe(6);
    expect(data.products[0].variations[0].stock).toBe(6);
  });

  it("does not hold stock for an estimate", () => {
    const data = db([
      product({
        id: "p1",
        code: "HDPE",
        name: { en: "HDPE", hi: "HDPE" },
        tallyOnHand: 10,
        stock: 10,
      }),
    ]);
    data.orders.push(
      order({
        id: "o1",
        status: "estimate",
        lines: [
          {
            productId: "p1",
            productCode: "HDPE",
            productName: { en: "HDPE", hi: "HDPE" },
            unit: "bundle",
            pricingMode: "bundle",
            rate: 1,
            quantity: 3,
            weightKg: 1,
            lineTotal: 3,
          },
        ],
      })
    );
    applyTallyAvailability(data);
    expect(data.products[0].stock).toBe(10);
    expect(enqueueTallySale(data, data.orders[0])).toBeNull();
  });

  it("drops a pending sale when the order is cancelled", () => {
    const data = db([
      product({
        id: "p1",
        code: "HDPE",
        name: { en: "HDPE", hi: "HDPE" },
        tallyOnHand: 10,
        stock: 10,
      }),
    ]);
    const confirmed = order({
      id: "o1",
      status: "confirmed",
      lines: [
        {
          productId: "p1",
          productCode: "HDPE",
          productName: { en: "HDPE", hi: "HDPE" },
          unit: "bundle",
          pricingMode: "bundle",
          rate: 1,
          quantity: 2,
          weightKg: 1,
          lineTotal: 2,
        },
      ],
    });
    data.orders.push(confirmed);
    enqueueTallySale(data, confirmed);
    applyTallyAvailability(data);
    expect(data.products[0].stock).toBe(8);
    confirmed.status = "cancelled";
    cancelTallySale(data, confirmed.id);
    applyTallyAvailability(data);
    expect(data.tallyPosts[0].status).toBe("failed");
    expect(data.tallyPosts[0].lastError).toBe("Order cancelled");
    expect(data.products[0].stock).toBe(10);
  });
});

describe("mergeTallyPosts", () => {
  it("keeps a posted cloud row over a stale pending copy", () => {
    const posted = {
      id: "t1",
      kind: "sale" as const,
      orderId: "o1",
      orderNumber: "TT-1",
      remoteId: "WEB-SALE-TT-1",
      partyName: "Ram",
      amount: 10,
      date: "2026-10-01",
      narration: "Website order TT-1",
      status: "posted" as const,
      attempts: 1,
      createdAt: "2026-10-01T00:00:00.000Z",
      postedAt: "2026-10-01T01:00:00.000Z",
    };
    const pending = { ...posted, status: "pending" as const, postedAt: undefined };
    const merged = mergeTallyPosts([posted], [pending]);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("posted");
  });

  it("accepts a new client post the cloud has not seen", () => {
    const post = {
      id: "t2",
      kind: "sale" as const,
      orderId: "o2",
      orderNumber: "TT-2",
      remoteId: "WEB-SALE-TT-2",
      partyName: "Shyam",
      amount: 20,
      date: "2026-10-02",
      narration: "Website order TT-2",
      status: "pending" as const,
      attempts: 0,
      createdAt: "2026-10-02T00:00:00.000Z",
    };
    expect(mergeTallyPosts([], [post])).toEqual([post]);
  });
});

function item(partial: Partial<TallyItem> & Pick<TallyItem, "name">): TallyItem {
  const now = "2026-10-01T00:00:00.000Z";
  return {
    id: partial.name.trim().toLowerCase(),
    source: "bridge",
    firstSeenAt: now,
    lastSeenAt: now,
    ...partial,
  };
}

function dealer(partial: Partial<UserProfile> & Pick<UserProfile, "id" | "name">): UserProfile {
  return {
    phone: "9999999999",
    passwordHash: "x",
    role: "customer",
    locale: "en",
    walletBalance: 0,
    assignedSchemeIds: [],
    liftingProgressKg: 0,
    schemeProgress: {},
    active: true,
    approved: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as UserProfile;
}

describe("tally registry", () => {
  it("upserts items, marks rows missing on a full sync, and keeps a link across a rename", () => {
    const data = db([
      product({
        id: "p1",
        code: "HDPE",
        name: { en: "HDPE", hi: "HDPE" },
        stock: 0,
        tallyItemId: "hdpe roll",
      }),
    ]);
    const first = upsertTallyRegistry(data, {
      items: [{ name: "HDPE Roll", guid: "g1", closing: 20, unit: "Kg" }],
      ledgers: [
        { name: "HDFC Bank", parent: "Bank Accounts" },
        { name: "Ram Traders", parent: "Sundry Debtors", gstin: "09ABCDE1234F1Z5" },
      ],
      full: true,
    });
    expect(first.items.created).toBe(1);
    expect(data.products[0].tallyItemId).toBe("hdpe roll");
    expect(data.tallyLedgers?.find((l) => l.name === "HDFC Bank")?.ignoredAt).toBeTruthy();
    expect(data.tallyLedgers?.find((l) => l.name === "Ram Traders")?.ignoredAt).toBeUndefined();

    upsertTallyRegistry(
      data,
      { items: [{ name: "HDPE Roll Blue", guid: "g1", closing: 18 }], full: true },
      "2026-10-02T00:00:00.000Z"
    );
    expect(data.tallyItems).toHaveLength(1);
    expect(data.tallyItems?.[0].name).toBe("HDPE Roll Blue");
    expect(data.tallyItems?.[0].id).toBe("hdpe roll");
    expect(data.products[0].tallyItemId).toBe("hdpe roll");
    expect(data.products[0].stock).toBe(0);

    linkTallyItem(data, "hdpe roll", { productId: "p1" });
    expect(data.products[0].stock).toBe(18);
    expect(data.products[0].tallyOnHand).toBe(18);

    upsertTallyRegistry(data, {
      items: [{ name: "Other", guid: "g2", closing: 1 }],
      full: true,
    });
    expect(data.tallyItems?.find((r) => r.id === "hdpe roll")?.missingSince).toBeTruthy();
    expect(data.products[0].tallyOnHand).toBe(18);
  });

  it("suggests and auto-links a unique exact name", () => {
    const data = db([
      product({
        id: "p1",
        code: "ROPE",
        name: { en: "Rope", hi: "रस्सी" },
        stock: 0,
      }),
      product({
        id: "p2",
        code: "NET-A",
        name: { en: "Net", hi: "नेट" },
        stock: 0,
      }),
      product({
        id: "p3",
        code: "NET-B",
        name: { en: "Net", hi: "नेट" },
        stock: 0,
      }),
    ]);
    data.tallyItems = [
      item({ name: "Rope", closingQty: 8 }),
      item({ name: "Net", closingQty: 3 }),
    ];
    expect(suggestTallyItemLink(data, data.tallyItems[0])?.product.id).toBe("p1");
    expect(suggestTallyItemLink(data, data.tallyItems[1])).toBeNull();
    expect(autoLinkTallyItems(data)).toBe(1);
    expect(data.products[0].tallyItemId).toBe("rope");
    expect(data.products[0].stock).toBe(8);
    expect(unlinkedTallyItems(data).map((r) => r.id)).toEqual(["net"]);
  });

  it("creates a website product only when asked", () => {
    const data = db([]);
    upsertTallyRegistry(data, { items: [{ name: "New Shade", closing: 4 }] });
    const created = createProductFromTallyItem(data, "new shade", { id: "p-new" });
    expect(created?.tallyItemId).toBe("new shade");
    expect(created?.active).toBe(false);
    expect(data.products).toHaveLength(1);
    expect(tallyRegistrySummary(data).items.unlinked).toBe(0);
  });

  it("holds a sale until the dealer ledger and the item are linked", () => {
    const data = db([
      product({
        id: "p1",
        code: "HDPE",
        name: { en: "HDPE", hi: "HDPE" },
        stock: 5,
        tallyOnHand: 5,
      }),
    ]);
    data.users = [dealer({ id: "u1", name: "Ram", company: "Ram Traders" })];
    upsertTallyRegistry(data, {
      items: [{ name: "HDPE Roll", closing: 5 }],
      ledgers: [{ name: "Ram Traders", parent: "Sundry Debtors" }],
    });
    const confirmed = order({
      id: "o1",
      status: "confirmed",
      userId: "u1",
      userName: "Ram",
      lines: [
        {
          productId: "p1",
          productCode: "HDPE",
          productName: { en: "HDPE", hi: "HDPE" },
          unit: "pcs",
          pricingMode: "bundle",
          rate: 10,
          quantity: 1,
          weightKg: 1,
          lineTotal: 10,
        },
      ],
    });
    data.orders.push(confirmed);
    const held = enqueueTallySale(data, confirmed);
    expect(held?.blockedReason).toBe("ledger");
    expect(held?.partyName).toBe("Ram");

    linkTallyLedger(data, "ram traders", "u1");
    const itemHeld = data.tallyPosts[0];
    expect(itemHeld.blockedReason).toBe("item");
    expect(itemHeld.partyName).toBe("Ram Traders");

    linkTallyItem(data, "hdpe roll", { productId: "p1" });
    expect(data.tallyPosts[0].blockedReason).toBeUndefined();
    expect(data.tallyPosts[0].lines?.[0].tallyItemName).toBe("HDPE Roll");
  });

  it("creates a ledger in Tally, then links it when the bridge acknowledges", () => {
    const data = db([]);
    data.users = [
      dealer({
        id: "u9",
        name: "Shyam",
        phone: "9811111111",
        gstOrAadhar: "09ABCDE1234F1Z5",
      }),
    ];
    const post = requestTallyLedger(data, "u9");
    expect(post?.kind).toBe("ledger");
    expect(post?.ledger?.parent).toBe("Sundry Debtors");
    expect(post?.remoteId).toBe("WEB-LEDGER-u9");

    ackTallyPost(data, post!.remoteId, "posted");
    expect(data.tallyLedgers?.[0].name).toBe("Shyam");
    expect(data.users[0].tallyLedgerId).toBe("shyam");
    expect(data.products).toHaveLength(0);
  });

  it("keeps bridge fields and accepts a newer ignore from the desk", () => {
    const cloud = [item({ name: "Rope", closingQty: 4, guid: "g" })];
    const desk = [
      item({
        id: "rope",
        name: "Rope renamed locally",
        closingQty: 0,
        ignoredAt: "2026-10-03T00:00:00.000Z",
        updatedAt: "2026-10-03T00:00:00.000Z",
      }),
    ];
    const merged = mergeTallyMasters(cloud, desk);
    expect(merged[0].name).toBe("Rope");
    expect(merged[0].closingQty).toBe(4);
    expect(merged[0].ignoredAt).toBe("2026-10-03T00:00:00.000Z");
  });
});
