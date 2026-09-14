import { describe, expect, it } from "vitest";
import { ACCT } from "./accounting/seed";
import {
  attachDealerStatement,
  dealerOpenBilledOrders,
  dealerPartyStatement,
} from "./dealer-statement";
import type { LedgerEntry, Order, Party, Voucher } from "./types";

function party(): Party {
  return {
    id: "pty1",
    name: "Ram Traders",
    phone: "9999999999",
    type: "customer",
    linkedUserId: "u1",
    openingBalance: 5000,
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("dealerPartyStatement", () => {
  it("returns outstanding from party books without exposing vouchers", () => {
    const saleEntry: LedgerEntry = {
      id: "e1",
      voucherId: "v1",
      voucherNumber: "S-1",
      voucherType: "sale",
      date: "2026-08-01",
      accountId: ACCT.debtors,
      partyId: "pty1",
      debit: 12000,
      credit: 0,
      voided: false,
    };
    const receipt: Voucher = {
      id: "r1",
      number: "R-9",
      type: "receipt",
      date: "2026-08-10",
      partyId: "pty1",
      lines: [],
      subtotal: 4000,
      taxAmount: 0,
      total: 4000,
      voided: false,
      createdBy: "t",
      createdAt: "2026-08-10T00:00:00.000Z",
      linkedOrderId: "ord1",
    };
    const stmt = dealerPartyStatement(
      {
        parties: [party()],
        vouchers: [receipt],
        ledgerEntries: [saleEntry],
      },
      "u1",
      "2026-08-20"
    );
    expect(stmt?.outstanding).toBe(17000);
    expect(stmt?.receipts).toEqual([
      {
        date: "2026-08-10",
        amount: 4000,
        number: "R-9",
        linkedOrderId: "ord1",
      },
    ]);
    const attached = attachDealerStatement([party()], stmt);
    expect(attached[0].statementOutstanding).toBe(17000);
    expect(attached[0].statementReceipts).toHaveLength(1);
  });

  it("lists billed orders that still have a remaining balance", () => {
    const open: Order = {
      id: "ord1",
      orderNumber: "TT-1",
      userId: "u1",
      userName: "Ram",
      userEmail: "",
      status: "payment_pending",
      lines: [],
      subtotal: 1000,
      shippingAmount: 0,
      walletUsed: 0,
      estimatedTotal: 1000,
      actualBillAmount: 1000,
      fullTruckRequested: false,
      deliveryAddress: "",
      timeline: [],
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      paymentProof: {
        uploadedAt: "2026-08-02T00:00:00.000Z",
        verified: false,
        items: [
          {
            id: "pp1",
            url: "https://x/p.jpg",
            type: "image",
            amount: 200,
            uploadedAt: "2026-08-02T00:00:00.000Z",
          },
        ],
      },
    } as Order;
    const paid: Order = {
      ...open,
      id: "ord2",
      status: "payment_verified",
      paymentProof: {
        uploadedAt: "2026-08-02T00:00:00.000Z",
        verified: true,
        items: [
          {
            id: "pp2",
            url: "https://x/p.jpg",
            type: "image",
            amount: 1000,
            uploadedAt: "2026-08-02T00:00:00.000Z",
          },
        ],
      },
    };
    const rows = dealerOpenBilledOrders([open, paid], "u1");
    expect(rows.map((o) => o.id)).toEqual(["ord1"]);
  });
});
