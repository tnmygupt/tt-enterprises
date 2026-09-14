import { describe, expect, it } from "vitest";
import { buildOwnerDailySummary, listOverdueParties, listStaleEstimates } from "./owner-daily-summary";
import type { OpsSnapshotDb } from "./owner-daily-summary";
import type { AppSettings, Order, Party, Voucher } from "./types";

function db(partial: Partial<OpsSnapshotDb> = {}): OpsSnapshotDb {
  return {
    settings: { companyName: "TT Enterprises" } as AppSettings,
    users: [],
    orders: [],
    parties: [],
    vouchers: [],
    accounts: [],
    ledgerEntries: [],
    products: [],
    ...partial,
  };
}

describe("owner daily summary", () => {
  it("lists overdue parties and includes them in the WhatsApp text", () => {
    const party: Party = {
      id: "p1",
      name: "Ravi Traders",
      phone: "9876543210",
      type: "customer",
      openingBalance: 0,
      active: true,
      createdAt: "2026-01-01",
    };
    const voucher: Voucher = {
      id: "v1",
      number: "S-1",
      type: "sale",
      date: "2026-08-01",
      partyId: "p1",
      lines: [],
      subtotal: 1000,
      taxAmount: 0,
      total: 1000,
      outstanding: 1000,
      dueDate: "2026-08-10",
      voided: false,
      createdAt: "2026-08-01",
      createdBy: "admin",
    };
    const snap = db({ parties: [party], vouchers: [voucher] });
    const overdue = listOverdueParties(snap, "2026-08-22");
    expect(overdue).toHaveLength(1);
    expect(overdue[0]?.total).toBe(1000);

    const proofOrder = {
      id: "o1",
      orderNumber: "TT-9",
      status: "payment_pending",
      estimatedTotal: 500,
      paymentProof: { verified: false, items: [{ id: "i1", amount: 500 }] },
    } as Order;
    const text = buildOwnerDailySummary({
      db: db({
        parties: [party],
        vouchers: [voucher],
        orders: [proofOrder],
      }),
      today: "2026-08-22",
      locale: "en",
    });
    expect(text.needVerify).toBe(1);
    expect(text.overdueTotal).toBe(1000);
    expect(text.text).toContain("Ravi Traders");
    expect(text.text).toContain("TT-9");
  });

  it("includes payables and creditor closing in the owner WhatsApp text", () => {
    const supplier: Party = {
      id: "s1",
      name: "Patel Mills",
      phone: "9123456780",
      type: "supplier",
      openingBalance: 2500,
      active: true,
      createdAt: "2026-01-01",
    };
    const purchase: Voucher = {
      id: "p1",
      number: "P-9",
      type: "purchase",
      date: "2026-08-15",
      partyId: "s1",
      lines: [],
      subtotal: 1800,
      taxAmount: 0,
      total: 1800,
      outstanding: 1800,
      dueDate: "2026-08-20",
      voided: false,
      createdAt: "2026-08-15",
      createdBy: "admin",
    };
    const text = buildOwnerDailySummary({
      db: db({ parties: [supplier], vouchers: [purchase] }),
      today: "2026-08-22",
      locale: "en",
    });
    expect(text.payableTotal).toBe(1800);
    expect(text.creditorTotal).toBe(2500);
    expect(text.text).toContain("Open payables");
    expect(text.text).toContain("Creditors closing");
    expect(text.text).toContain("Patel Mills");
    expect(text.text).toContain("P-9");
  });

  it("lists stale estimates and top reorder SKUs", () => {
    const stale = {
      id: "o-stale",
      orderNumber: "TT-22",
      userId: "u1",
      userName: "Ram Traders",
      userEmail: "",
      status: "estimate",
      stockReserved: true,
      lines: [],
      subtotal: 0,
      shippingAmount: 0,
      walletUsed: 0,
      estimatedTotal: 0,
      fullTruckRequested: false,
      deliveryAddress: "",
      timeline: [],
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
    } as Order;
    expect(listStaleEstimates([stale], "2026-08-22")).toHaveLength(1);

    const product = {
      id: "p1",
      code: "TARP",
      category: "tarpaulin",
      itemName: { en: "Tarpaulin", hi: "तिरपाल" },
      name: { en: "HDPE", hi: "एचडीपीई" },
      description: { en: "", hi: "" },
      unit: "kg",
      baseRate: 100,
      pricingMode: "bundle",
      minStockLevel: 5,
      stock: 1,
      variations: [],
      colors: [],
      media: [],
      active: true,
      featured: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const text = buildOwnerDailySummary({
      db: db({
        orders: [stale],
        products: [product as never],
      }),
      today: "2026-08-22",
      locale: "en",
    });
    expect(text.text).toContain("Stale estimates");
    expect(text.text).toContain("Ram Traders");
    expect(text.text).toContain("Top reorder");
    expect(text.text).toContain("HDPE");
  });
});
