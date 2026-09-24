import { describe, expect, it } from "vitest";
import { getAdminQueues } from "./admin-queues";
import type { Order, Product, Voucher } from "./types";

function order(partial: Partial<Order> & Pick<Order, "id" | "status">): Order {
  return {
    orderNumber: partial.id,
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
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...partial,
  };
}

describe("getAdminQueues", () => {
  it("counts billed orders missing a sale voucher", () => {
    const billed = order({
      id: "o1",
      status: "payment_pending",
      actualBillAmount: 500,
    });
    const posted = order({
      id: "o2",
      status: "payment_pending",
      actualBillAmount: 400,
    });
    const sale: Pick<Voucher, "linkedOrderId" | "type" | "voided"> = {
      linkedOrderId: "o2",
      type: "sale",
      voided: false,
    };
    const queues = getAdminQueues({
      orders: [billed, posted],
      vouchers: [sale],
    });
    expect(queues.counts.need_voucher).toBe(1);
    expect(queues.needVoucher.map((o) => o.id)).toEqual(["o1"]);
  });

  it("counts reorder alerts from stockAlerts", () => {
    const product = {
      id: "p1",
      code: "TARP",
      category: "tarpaulin",
      itemName: { en: "Tarpaulin", hi: "तिरपाल" },
      name: { en: "HDPE", hi: "एचडीपीई" },
      description: { en: "", hi: "" },
      unit: "kg",
      baseRate: 100,
      baseWeightKg: 35,
      pricingMode: "bundle",
      minOrderQty: 1,
      minStockLevel: 5,
      stock: 1,
      stockSecondary: 35,
      variations: [],
      colors: [],
      media: [],
      active: true,
      featured: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    } as Product;
    const queues = getAdminQueues({
      orders: [],
      products: [product],
      stockMovements: [],
    });
    expect(queues.counts.need_reorder).toBe(1);
  });

  it("counts pending owner rate/scheme approvals", () => {
    const queues = getAdminQueues({
      orders: [],
      ownerApprovals: [
        {
          id: "a1",
          kind: "product_rates",
          status: "pending",
          targetKey: "product_rates:p1",
          title: "Rate",
          snapshot: {},
          requestedBy: "s",
          requestedAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
        {
          id: "a2",
          kind: "scheme_upsert",
          status: "approved",
          targetKey: "scheme_upsert:s1",
          title: "Scheme",
          snapshot: {},
          requestedBy: "s",
          requestedAt: "2026-09-01T00:00:00.000Z",
          updatedAt: "2026-09-01T00:00:00.000Z",
        },
      ],
    });
    expect(queues.counts.need_owner_approval).toBe(1);
    expect(queues.needOwnerApproval).toBe(1);
  });
});
