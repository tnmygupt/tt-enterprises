import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCT } from "./accounting/seed";
import { accountBalance } from "./accounting/engine";
import { runBooksHealthCheck } from "./accounting/controls";
import { saleDueDate } from "./accounting/credit-policy";
import type { Order, Party, Product } from "./types";

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

function seedProduct(id = "p1"): Product {
  return {
    id,
    code: "TARP",
    category: "tarpaulin",
    itemName: { en: "Tarpaulin", hi: "तिरपाल" },
    name: { en: "HDPE", hi: "एचडीपीई" },
    description: { en: "", hi: "" },
    unit: "kg",
    baseRate: 100,
    baseWeightKg: 1,
    pricingMode: "bundle",
    minOrderQty: 1,
    stock: 20,
    stockSecondary: 20,
    variations: [],
    colors: [],
    media: [],
    active: true,
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("plant distribution books", () => {
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

  it("accrues GRNI on GRN with PO rate, clears on bill, reopens on void", async () => {
    const {
      loadDb,
      saveDb,
      createPurchaseOrder,
      createGoodsReceipt,
      createPurchaseBillFromGrn,
      voidVoucher,
      voidGoodsReceipt,
    } = await import("./store/db");
    const db = loadDb();
    db.products = [seedProduct()];
    db.parties = [
      {
        id: "s1",
        name: "Mill",
        phone: "9999999999",
        type: "supplier",
        openingBalance: 0,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    saveDb(db);

    const po = createPurchaseOrder({
      supplierId: "s1",
      date: "2026-09-01",
      createdBy: "t",
      status: "ordered",
      lines: [
        {
          id: "pl1",
          productId: "p1",
          itemLabel: "HDPE",
          qty: 5,
          secondaryQty: 5,
          rate: 10,
          amount: 50,
          unit: "kg",
        },
      ],
    });
    const grn = createGoodsReceipt({
      poId: po.id,
      date: "2026-09-02",
      createdBy: "t",
      lines: [
        {
          id: "gl1",
          poLineId: po.lines[0]!.id,
          productId: "p1",
          itemLabel: "HDPE",
          qty: 5,
          secondaryQty: 5,
          unit: "kg",
        },
      ],
    });
    expect(grn.accruedAmount).toBe(50);
    expect(grn.accrualVoucherId).toBeTruthy();
    const afterGrn = loadDb();
    const grni = afterGrn.accounts.find((a) => a.id === ACCT.grni)!;
    expect(accountBalance(grni, afterGrn.ledgerEntries)).toBe(50);
    const health = runBooksHealthCheck({
      accounts: afterGrn.accounts,
      ledgerEntries: afterGrn.ledgerEntries,
      parties: afterGrn.parties,
      vouchers: afterGrn.vouchers,
      orders: afterGrn.orders,
      stockBatches: afterGrn.stockBatches,
      goodsReceipts: afterGrn.goodsReceipts,
      asOf: "2026-09-02",
    });
    expect(health.items.find((i) => i.id === "grni_accrual")?.ok).toBe(true);

    const bill = createPurchaseBillFromGrn({
      grnId: grn.id,
      date: "2026-09-03",
      createdBy: "t",
    });
    expect(bill.grniAmount).toBe(50);
    const afterBill = loadDb();
    expect(
      accountBalance(
        afterBill.accounts.find((a) => a.id === ACCT.grni)!,
        afterBill.ledgerEntries
      )
    ).toBe(0);

    voidVoucher(bill.id, "t");
    const afterVoid = loadDb();
    expect(
      accountBalance(
        afterVoid.accounts.find((a) => a.id === ACCT.grni)!,
        afterVoid.ledgerEntries
      )
    ).toBe(50);

    voidGoodsReceipt(grn.id, "t");
    const afterVoidGrn = loadDb();
    expect(
      accountBalance(
        afterVoidGrn.accounts.find((a) => a.id === ACCT.grni)!,
        afterVoidGrn.ledgerEntries
      )
    ).toBe(0);
  });

  it("posts wastage at FIFO cost on stock-out", async () => {
    const { loadDb, saveDb, adjustStock } = await import("./store/db");
    const db = loadDb();
    db.products = [seedProduct()];
    db.stockBatches = [
      {
        id: "b1",
        date: "2026-09-01",
        productId: "p1",
        qty: 10,
        originalQty: 10,
        rate: 12,
        unit: "kg",
        source: "purchase",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ];
    saveDb(db);
    adjustStock({
      productId: "p1",
      qty: 2,
      secondaryQty: 2,
      direction: "out",
      note: "Write-off",
      createdBy: "t",
    });
    const after = loadDb();
    const wastage = after.accounts.find((a) => a.id === ACCT.wastage)!;
    expect(accountBalance(wastage, after.ledgerEntries)).toBe(24);
  });

  it("blocks over-limit sales unless override, and uses creditDays on dueDate", async () => {
    const { loadDb, saveDb, createVoucher, createSaleVoucherFromOrder } =
      await import("./store/db");
    const db = loadDb();
    const party: Party = {
      id: "c1",
      name: "Dealer",
      phone: "9000000001",
      type: "customer",
      openingBalance: 0,
      creditLimit: 1000,
      creditDays: 7,
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      linkedUserId: "u1",
    };
    db.parties = [party];
    db.users = [
      {
        id: "u1",
        role: "customer",
        name: "Dealer",
        phone: "9000000001",
        locale: "en",
        passwordHash: "x",
        walletBalance: 0,
        assignedSchemeIds: [],
        liftingProgressKg: 0,
        schemeProgress: {},
        active: true,
        approved: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    saveDb(db);

    expect(() =>
      createVoucher({
        type: "sale",
        date: "2026-09-10",
        partyId: "c1",
        createdBy: "t",
        skipInventory: true,
        lines: [
          {
            id: "l1",
            itemLabel: "HDPE",
            qty: 1,
            rate: 1500,
            amount: 1500,
            taxPercent: 0,
          },
        ],
      })
    ).toThrow(/Credit limit exceeded/);

    const allowed = createVoucher({
      type: "sale",
      date: "2026-09-10",
      partyId: "c1",
      createdBy: "t",
      skipInventory: true,
      allowOverCredit: true,
      lines: [
        {
          id: "l1",
          itemLabel: "HDPE",
          qty: 1,
          rate: 1500,
          amount: 1500,
          taxPercent: 0,
        },
      ],
    });
    expect(allowed.total).toBe(1500);

    const db2 = loadDb();
    const order: Order = {
      id: "o1",
      orderNumber: "TT-1",
      userId: "u1",
      userName: "Dealer",
      userEmail: "",
      status: "payment_pending",
      lines: [],
      subtotal: 400,
      shippingAmount: 0,
      walletUsed: 0,
      estimatedTotal: 400,
      actualBillAmount: 400,
      billUploadedAt: "2026-09-10T00:00:00.000Z",
      deliveryAddress: "x",
      timeline: [],
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
    };
    db2.orders = [{ ...order, allowOverCredit: true }];
    saveDb(db2);
    const sale = createSaleVoucherFromOrder("o1", "t");
    expect(sale.dueDate).toBe(saleDueDate("2026-09-10", 7));
    expect(sale.dueDate).toBe("2026-09-17");
  });

  it("blocks billed orders over credit unless owner override", async () => {
    const { loadDb, saveDb, uploadBill, createSaleVoucherFromOrder } =
      await import("./store/db");
    const db = loadDb();
    db.parties = [
      {
        id: "c1",
        name: "Dealer",
        phone: "9000000001",
        type: "customer",
        openingBalance: 0,
        creditLimit: 1000,
        creditDays: 7,
        active: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        linkedUserId: "u1",
      },
    ];
    db.users = [
      {
        id: "u1",
        role: "customer",
        name: "Dealer",
        phone: "9000000001",
        locale: "en",
        passwordHash: "x",
        walletBalance: 0,
        assignedSchemeIds: [],
        liftingProgressKg: 0,
        schemeProgress: {},
        active: true,
        approved: true,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const order: Order = {
      id: "o1",
      orderNumber: "TT-1",
      userId: "u1",
      userName: "Dealer",
      userEmail: "",
      status: "confirmed",
      lines: [],
      subtotal: 1500,
      shippingAmount: 0,
      walletUsed: 0,
      estimatedTotal: 1500,
      deliveryAddress: "x",
      timeline: [],
      createdAt: "2026-09-10T00:00:00.000Z",
      updatedAt: "2026-09-10T00:00:00.000Z",
    };
    db.orders = [
      {
        ...order,
        id: "o2",
        orderNumber: "TT-2",
        actualBillAmount: 1500,
        billUploadedAt: "2026-09-10T00:00:00.000Z",
        status: "payment_pending",
      },
    ];
    saveDb(db);
    expect(() => createSaleVoucherFromOrder("o2", "t")).toThrow(
      /Credit limit exceeded/
    );

    const dbBill = loadDb();
    dbBill.orders = [order];
    saveDb(dbBill);
    expect(() => uploadBill("o1", 1500, undefined, undefined, "t")).toThrow(
      /Credit limit exceeded/
    );
    const blocked = loadDb().orders.find((o) => o.id === "o1")!;
    expect(blocked.actualBillAmount).toBeUndefined();
    expect(blocked.creditBlockedOverBy).toBeGreaterThan(0);

    const billed = uploadBill("o1", 1500, undefined, undefined, "t", {
      allowOverCredit: true,
    });
    expect(billed.actualBillAmount).toBe(1500);
  });
});

describe("saleDueDate", () => {
  it("adds credit days to the bill date", () => {
    expect(saleDueDate("2026-09-10", 0)).toBe("2026-09-10");
    expect(saleDueDate("2026-09-10", 15)).toBe("2026-09-25");
  });
});
