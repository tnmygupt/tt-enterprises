import { describe, expect, it } from "vitest";
import type { Order, Product, TallyPost } from "@/lib/types";
import {
  ackTallyPost,
  applyTallyAvailability,
  applyTallyStock,
  cancelTallySale,
  enqueueTallySale,
  mergeTallyPosts,
  parseTallyStockExport,
  reservedTallyQty,
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
  it("matches tally item id, then SKU, then exact name", () => {
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
            tallyItemId: "TALLY-12",
          },
        ],
      }),
      product({
        id: "p2",
        code: "NET-50",
        name: { en: "Shade Net 50", hi: "शेड नेट" },
        stock: 0,
      }),
      product({
        id: "p3",
        code: "ROPE",
        name: { en: "Rope", hi: "रस्सी" },
        stock: 0,
      }),
    ]);

    const result = applyTallyStock(data, [
      { tallyItemId: "TALLY-12", stock: 40 },
      { sku: "NET-50", tallyItemId: "TALLY-NET", stock: 15 },
      { name: "Rope", tallyItemId: "TALLY-ROPE", stock: 8 },
      { name: "Missing", sku: "NOPE", tallyItemId: "X", stock: 1 },
    ]);

    expect(result.applied).toBe(4);
    expect(result.created).toBe(1);
    expect(result.unknown).toEqual([]);
    expect(data.products.some((p) => p.name.en === "Missing" && p.stock === 1)).toBe(
      true
    );
    expect(data.products[0].variations[0].stock).toBe(40);
    expect(data.products[0].variations[0].tallyOnHand).toBe(40);
    expect(data.products[1].stock).toBe(15);
    expect(data.products[1].tallyItemId).toBe("TALLY-NET");
    expect(data.products[2].tallyItemId).toBe("TALLY-ROPE");
    expect(data.settings.tallySyncStatus).toBe("ok");
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
    applyTallyStock(data, [{ sku: "HDPE-12", tallyItemId: "T1", stock: 10 }]);
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

describe("parseTallyStockExport", () => {
  it("reads a Tally sheet of item name and stock and creates missing items", () => {
    const items = parseTallyStockExport(
      [
        "Name of Item,Closing Balance,Rate",
        "HDPE Tirpal 12x18,180 Nos,42.50",
        "Shade Net 50,\"1,200 kg\",",
        "Grand Total,1380,",
      ].join("\n")
    );
    expect(items).toEqual([
      expect.objectContaining({ name: "HDPE Tirpal 12x18", stock: 180, unit: "pcs", rate: 42.5 }),
      expect.objectContaining({ name: "Shade Net 50", stock: 1200, unit: "kg" }),
    ]);

    const data = db([]);
    const first = applyTallyStock(data, items);
    expect(first.created).toBe(2);
    expect(data.products).toHaveLength(2);
    expect(data.products[0].baseRate).toBe(42.5);
    expect(data.products[0].tallyItemId).toBe("HDPE Tirpal 12x18");

    const again = applyTallyStock(data, [
      { name: "HDPE Tirpal 12x18", stock: 90 },
    ]);
    expect(again.created).toBe(0);
    expect(data.products).toHaveLength(2);
    expect(data.products.find((p) => p.name.en === "HDPE Tirpal 12x18")?.stock).toBe(90);
    expect(data.products.find((p) => p.name.en === "HDPE Tirpal 12x18")?.baseRate).toBe(42.5);
  });

  it("reads a pasted two-column list", () => {
    const items = parseTallyStockExport("Rope\t25\nNet\t4 pcs");
    expect(items.map((i) => [i.name, i.stock])).toEqual([
      ["Rope", 25],
      ["Net", 4],
    ]);
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
