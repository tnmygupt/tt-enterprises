import { describe, expect, it } from "vitest";
import { dealerScopedProjection } from "./authorize-db";
import { ACCT } from "@/lib/accounting/seed";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";
import type { AppDatabase } from "@/lib/store/db";
import type { LedgerEntry, Party, UserProfile, Voucher } from "@/lib/types";

function dbStub(): AppDatabase {
  const dealer: UserProfile = {
    id: "u1",
    role: "customer",
    name: "Ram",
    phone: "9000000001",
    locale: "en",
    passwordHash: "x",
    walletBalance: 0,
    assignedSchemeIds: [],
    liftingProgressKg: 0,
    schemeProgress: {},
    active: true,
    approved: true,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  const party: Party = {
    id: "pty1",
    name: "Ram Traders",
    phone: "9000000001",
    type: "customer",
    linkedUserId: "u1",
    openingBalance: 1000,
    active: true,
    createdAt: "2026-08-01T00:00:00.000Z",
  };
  const other: Party = {
    ...party,
    id: "pty2",
    name: "Other",
    linkedUserId: "u2",
  };
  const sale: LedgerEntry = {
    id: "e1",
    voucherId: "v1",
    voucherNumber: "S-1",
    voucherType: "sale",
    date: "2026-08-01",
    accountId: ACCT.debtors,
    partyId: "pty1",
    debit: 2500,
    credit: 0,
    voided: false,
  };
  const receipt: Voucher = {
    id: "r1",
    number: "R-1",
    type: "receipt",
    date: "2026-08-12",
    partyId: "pty1",
    lines: [],
    subtotal: 500,
    taxAmount: 0,
    total: 500,
    voided: false,
    createdBy: "t",
    createdAt: "2026-08-12T00:00:00.000Z",
  };
  return {
    users: [dealer],
    products: [],
    orders: [],
    schemes: [],
    walletTransactions: [],
    walletDeposits: [],
    shippingRules: [],
    categories: [],
    settings: { companyName: "TT" } as AppDatabase["settings"],
    accounts: [],
    parties: [party, other],
    vouchers: [receipt, { ...receipt, id: "r2", partyId: "pty2", number: "R-2" }],
    ledgerEntries: [sale],
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
  };
}

describe("dealerScopedProjection statement", () => {
  it("attaches outstanding and receipts on the linked party without dumping vouchers", () => {
    const out = dealerScopedProjection(dbStub(), {
      id: "u1",
      role: "customer",
      phone: "9000000001",
      name: "Ram",
      locale: "en",
      exp: Date.now() + 60_000,
    });
    expect(out.vouchers).toEqual([]);
    expect(out.ledgerEntries).toEqual([]);
    expect(out.parties).toHaveLength(1);
    expect(out.parties[0].id).toBe("pty1");
    expect(out.parties[0].statementOutstanding).toBe(3500);
    expect(out.parties[0].statementReceipts).toEqual([
      {
        date: "2026-08-12",
        amount: 500,
        number: "R-1",
        linkedOrderId: undefined,
      },
    ]);
    const cloud = sanitizeDbForCloud(out);
    expect(cloud.parties[0].statementOutstanding).toBeUndefined();
    expect(cloud.parties[0].statementReceipts).toBeUndefined();
  });
});
