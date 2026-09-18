import { describe, expect, it } from "vitest";
import type { LedgerEntry, Order, Voucher } from "../types";
import type { AppDatabase } from "../store/db";
import {
  voidBooksForCancelledOrders,
  voidBooksForOrder,
} from "./cancelled-order-books";
import { partyBalance } from "./engine";
import { openInvoicesForParty } from "./receivables";
import { runBooksHealthCheck } from "./controls";
import { ACCT } from "./seed";
import type { Party } from "../types";
import { sanitizeDbForCloud } from "../supabase/sanitize";

function sale(): Voucher {
  return {
    id: "sale1",
    number: "S-1",
    type: "sale",
    date: "2026-08-01",
    partyId: "p1",
    linkedOrderId: "ord1",
    lines: [],
    subtotal: 5000,
    taxAmount: 0,
    total: 5000,
    outstanding: 5000,
    dueDate: "2026-08-10",
    voided: false,
    createdBy: "admin",
    createdAt: "2026-08-01T00:00:00.000Z",
  };
}

function receipt(): Voucher {
  return {
    id: "rcp1",
    number: "R-1",
    type: "receipt",
    date: "2026-08-12",
    partyId: "p1",
    linkedOrderId: "ord1",
    linkedInvoiceId: "sale1",
    lines: [],
    subtotal: 1000,
    taxAmount: 0,
    total: 1000,
    voided: false,
    createdBy: "admin",
    createdAt: "2026-08-12T00:00:00.000Z",
  };
}

function party(): Party {
  return {
    id: "p1",
    name: "Ravi Traders",
    phone: "9000000000",
    type: "customer",
    openingBalance: 0,
    active: true,
    createdAt: "2026-01-01",
  };
}

describe("voidBooksForCancelledOrders", () => {
  it("voids the sale and receipt so the party is not overdue", () => {
    const vouchers = [sale(), receipt()];
    const ledger: LedgerEntry[] = [
      {
        id: "le1",
        date: "2026-08-01",
        accountId: ACCT.debtors,
        debit: 5000,
        credit: 0,
        partyId: "p1",
        voucherId: "sale1",
        voucherNumber: "S-1",
        voucherType: "sale",
        voided: false,
      },
      {
        id: "le2",
        date: "2026-08-12",
        accountId: ACCT.debtors,
        debit: 0,
        credit: 1000,
        partyId: "p1",
        voucherId: "rcp1",
        voucherNumber: "R-1",
        voucherType: "receipt",
        voided: false,
      },
    ];
    const books = {
      orders: [{ id: "ord1", status: "cancelled" as const }],
      vouchers,
      ledgerEntries: ledger,
      billAllocations: [
        {
          id: "ba1",
          receiptOrPaymentVoucherId: "rcp1",
          invoiceVoucherId: "sale1",
          amount: 1000,
          date: "2026-08-12",
        },
      ],
    };
    const result = voidBooksForCancelledOrders(books, "admin");
    expect(result.changed).toBe(true);
    expect(result.voidedNumbers.sort()).toEqual(["R-1", "S-1"]);
    expect(vouchers.every((v) => v.voided)).toBe(true);
    expect(vouchers.find((v) => v.id === "sale1")?.outstanding).toBe(0);
    expect(ledger.every((e) => e.voided)).toBe(true);
    expect(books.billAllocations).toHaveLength(0);
    expect(
      openInvoicesForParty(
        "p1",
        vouchers,
        books.billAllocations,
        "2026-08-22",
        "sale",
        books.orders
      )
    ).toEqual([]);
    expect(partyBalance(party(), ledger, "2026-08-22")).toBe(0);
  });

  it("leaves an open order's sale alone", () => {
    const vouchers = [sale()];
    const result = voidBooksForCancelledOrders(
      {
        orders: [{ id: "ord1", status: "payment_pending" }],
        vouchers,
        ledgerEntries: [],
        billAllocations: [],
      },
      "admin"
    );
    expect(result.changed).toBe(false);
    expect(vouchers[0]?.voided).toBe(false);
  });

  it("voids notes that settle the cancelled sale", () => {
    const cn: Voucher = {
      ...receipt(),
      id: "cn1",
      number: "CN-1",
      type: "credit_note",
      linkedOrderId: undefined,
      linkedInvoiceId: "sale1",
      total: 500,
    };
    const vouchers = [sale(), cn];
    const result = voidBooksForOrder(
      {
        orders: [{ id: "ord1", status: "cancelled" }],
        vouchers,
        ledgerEntries: [],
        billAllocations: [],
      },
      "ord1",
      "admin"
    );
    expect(result.voidedNumbers.sort()).toEqual(["CN-1", "S-1"]);
  });
});

describe("health check cancelled sales", () => {
  it("fails while a cancelled order still has a live sale voucher", () => {
    const report = runBooksHealthCheck({
      accounts: [],
      ledgerEntries: [],
      parties: [party()],
      vouchers: [sale()],
      orders: [{ id: "ord1", status: "cancelled" } as Order],
      asOf: "2026-08-22",
    });
    const row = report.items.find((i) => i.id === "cancelled_sales");
    expect(row?.ok).toBe(false);
    expect(row?.detail).toContain("S-1");
  });
});

describe("cloud sanitize", () => {
  it("voids cancelled-order sales so GET/PUT books match the site", () => {
    const cleaned = sanitizeDbForCloud({
      orders: [{ id: "ord1", status: "cancelled" }],
      vouchers: [sale()],
      ledgerEntries: [
        {
          id: "le1",
          date: "2026-08-01",
          accountId: ACCT.debtors,
          debit: 5000,
          credit: 0,
          partyId: "p1",
          voucherId: "sale1",
          voucherNumber: "S-1",
          voucherType: "sale",
          voided: false,
        },
      ],
      billAllocations: [],
      users: [],
      products: [],
      schemes: [],
      walletTransactions: [],
      walletDeposits: [],
      shippingRules: [],
      categories: [],
      settings: { companyName: "TT" } as AppDatabase["settings"],
      accounts: [],
      parties: [party()],
      stockMovements: [],
      stockBatches: [],
      batchConsumptions: [],
      purchaseOrders: [],
      goodsReceipts: [],
      supplierContracts: [],
      tallyPosts: [],
      statementMatches: [],
      accessPlaces: [],
    } as AppDatabase);
    expect(cleaned.vouchers[0]?.voided).toBe(true);
    expect(cleaned.ledgerEntries[0]?.voided).toBe(true);
    expect(cleaned.vouchers[0]?.outstanding).toBe(0);
  });
});
