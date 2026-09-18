import { describe, expect, it } from "vitest";
import type { BillAllocation, Voucher } from "../types";
import {
  invoiceSettlementLines,
  leftoverReceipts,
  openInvoicesForParty,
} from "./receivables";

function sale(id: string, number: string): Voucher {
  return {
    id,
    number,
    type: "sale",
    date: "2026-08-01",
    partyId: "p1",
    lines: [],
    subtotal: 28000,
    taxAmount: 0,
    total: 28000,
    voided: false,
    createdBy: "t",
    createdAt: "2026-08-01T00:00:00.000Z",
  } as Voucher;
}

function receipt(id: string, number: string): Voucher {
  return {
    id,
    number,
    type: "receipt",
    date: "2026-08-10",
    partyId: "p1",
    lines: [],
    subtotal: 10000,
    taxAmount: 0,
    total: 10000,
    voided: false,
    createdBy: "t",
    createdAt: "2026-08-10T00:00:00.000Z",
  } as Voucher;
}

describe("invoiceSettlementLines", () => {
  it("lists receipts that settled a sale plus a linked credit note", () => {
    const inv = sale("sale1", "S-1");
    const r1 = receipt("rcp1", "R-1");
    const cn = {
      ...receipt("cn1", "CN-1"),
      type: "credit_note",
      linkedInvoiceId: "sale1",
      total: 2000,
    } as Voucher;
    const allocs: BillAllocation[] = [
      {
        id: "ba1",
        receiptOrPaymentVoucherId: "rcp1",
        invoiceVoucherId: "sale1",
        amount: 10000,
        date: "2026-08-10",
      },
    ];
    const lines = invoiceSettlementLines("sale1", [inv, r1, cn], allocs);
    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.kind === "receipt")).toMatchObject({
      number: "R-1",
      amount: 10000,
    });
    expect(lines.find((l) => l.kind === "credit_note")).toMatchObject({
      number: "CN-1",
      amount: 2000,
    });
  });

  it("skips voided receipts", () => {
    const r1 = { ...receipt("rcp1", "R-1"), voided: true } as Voucher;
    const allocs: BillAllocation[] = [
      {
        id: "ba1",
        receiptOrPaymentVoucherId: "rcp1",
        invoiceVoucherId: "sale1",
        amount: 10000,
        date: "2026-08-10",
      },
    ];
    expect(invoiceSettlementLines("sale1", [r1], allocs)).toEqual([]);
  });
});

describe("leftoverReceipts", () => {
  it("returns receipts with leftover after allocations", () => {
    const r1 = receipt("rcp1", "R-1");
    r1.total = 15000;
    const allocs: BillAllocation[] = [
      {
        id: "ba1",
        receiptOrPaymentVoucherId: "rcp1",
        invoiceVoucherId: "sale1",
        amount: 10000,
        date: "2026-08-10",
      },
    ];
    const rows = leftoverReceipts([r1], allocs);
    expect(rows).toHaveLength(1);
    expect(rows[0].leftover).toBe(5000);
  });

  it("omits fully allocated receipts", () => {
    const r1 = receipt("rcp1", "R-1");
    const allocs: BillAllocation[] = [
      {
        id: "ba1",
        receiptOrPaymentVoucherId: "rcp1",
        invoiceVoucherId: "sale1",
        amount: 10000,
        date: "2026-08-10",
      },
    ];
    expect(leftoverReceipts([r1], allocs)).toEqual([]);
  });
});

describe("openInvoicesForParty cancelled orders", () => {
  it("drops a live sale whose linked order is cancelled", () => {
    const inv = {
      ...sale("sale1", "S-1"),
      linkedOrderId: "ord_cancel",
      dueDate: "2026-08-05",
    } as Voucher;
    const open = openInvoicesForParty(
      "p1",
      [inv],
      [],
      "2026-08-22",
      "sale",
      [{ id: "ord_cancel", status: "cancelled" }]
    );
    expect(open).toEqual([]);
  });

  it("keeps an unpaid sale for an open order", () => {
    const inv = {
      ...sale("sale1", "S-1"),
      linkedOrderId: "ord_open",
      dueDate: "2026-08-05",
    } as Voucher;
    const open = openInvoicesForParty(
      "p1",
      [inv],
      [],
      "2026-08-22",
      "sale",
      [{ id: "ord_open", status: "payment_pending" }]
    );
    expect(open).toHaveLength(1);
    expect(open[0]?.outstanding).toBe(28000);
    expect(open[0]?.daysOverdue).toBeGreaterThan(0);
  });
});
