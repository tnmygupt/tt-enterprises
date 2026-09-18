import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Order, UserProfile } from "../types";
import { openInvoicesForParty, partyBalance } from "../accounting";

function memoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

function admin(): UserProfile {
  return {
    id: "admin",
    passwordHash: "x",
    name: "Owner",
    phone: "9000000001",
    role: "super_admin",
    locale: "en",
    walletBalance: 0,
    assignedSchemeIds: [],
    liftingProgressKg: 0,
    schemeProgress: {},
    active: true,
    approved: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function dealer(): UserProfile {
  return {
    id: "dealer1",
    passwordHash: "x",
    name: "Ravi Traders",
    phone: "9876543210",
    role: "customer",
    locale: "en",
    walletBalance: 0,
    assignedSchemeIds: [],
    liftingProgressKg: 0,
    schemeProgress: {},
    active: true,
    approved: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function billedOrder(): Order {
  return {
    id: "ord1",
    orderNumber: "TT-1",
    userId: "dealer1",
    userName: "Ravi Traders",
    userEmail: "",
    status: "payment_pending",
    lines: [],
    subtotal: 2500,
    shippingAmount: 0,
    walletUsed: 0,
    estimatedTotal: 2500,
    actualBillAmount: 2500,
    billUploadedAt: "2026-01-15T00:00:00.000Z",
    fullTruckRequested: false,
    deliveryAddress: "Kanpur",
    phone: "9876543210",
    timeline: [],
    createdAt: "2026-01-10T00:00:00.000Z",
    updatedAt: "2026-01-15T00:00:00.000Z",
  };
}

describe("cancelOrder books link", () => {
  beforeEach(() => {
    const ls = memoryStorage();
    vi.stubGlobal("localStorage", ls);
    vi.stubGlobal("window", {
      localStorage: ls,
      dispatchEvent: () => true,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    });
    vi.stubGlobal("crypto", {
      randomUUID: () => `id_${Math.random().toString(16).slice(2)}`,
    });
  });

  it("voids the auto sale so the person ledger is not overdue", async () => {
    const {
      loadDb,
      saveDb,
      createSaleVoucherFromOrder,
      cancelOrder,
    } = await import("./db");
    const db = loadDb();
    db.users = [admin(), dealer()];
    db.orders = [billedOrder()];
    saveDb(db);

    const sale = createSaleVoucherFromOrder("ord1", "admin");
    expect(sale.voided).toBe(false);
    expect(sale.total).toBe(2500);

    const afterBill = loadDb();
    const party = afterBill.parties.find((p) => p.linkedUserId === "dealer1");
    expect(party).toBeTruthy();
    const openBefore = openInvoicesForParty(
      party!.id,
      afterBill.vouchers,
      afterBill.billAllocations ?? [],
      "2026-08-22",
      "sale",
      afterBill.orders
    );
    expect(openBefore.some((r) => r.voucher.linkedOrderId === "ord1")).toBe(
      true
    );

    cancelOrder("ord1", "admin", "Customer cancelled");

    const next = loadDb();
    const voidedSale = next.vouchers.find(
      (v) => v.linkedOrderId === "ord1" && v.type === "sale"
    );
    expect(voidedSale?.voided).toBe(true);
    expect(next.orders[0]?.status).toBe("cancelled");
    expect(
      next.ledgerEntries
        .filter((e) => e.voucherId === voidedSale?.id)
        .every((e) => e.voided)
    ).toBe(true);

    const openAfter = openInvoicesForParty(
      party!.id,
      next.vouchers,
      next.billAllocations ?? [],
      "2026-08-22",
      "sale",
      next.orders
    );
    expect(openAfter.some((r) => r.voucher.linkedOrderId === "ord1")).toBe(
      false
    );
    const p = next.parties.find((row) => row.id === party!.id)!;
    expect(partyBalance(p, next.ledgerEntries, "2026-08-22")).toBe(0);
  });
});
