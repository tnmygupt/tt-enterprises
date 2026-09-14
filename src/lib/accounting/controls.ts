import type {
  Account,
  AppSettings,
  BillAllocation,
  GoodsReceipt,
  LedgerEntry,
  Order,
  Party,
  StockBatch,
  UserProfile,
  Voucher,
} from "../types";
import { staffMustHideVoucherRupees } from "../owner-sensitive";
import { roundMoney } from "../pricing";
import { ACCT } from "./seed";
import { accountBalance, partyBalance, trialBalance } from "./engine";
import { inventoryOpeningGap } from "./openings";
import { allOpenReceivables } from "./receivables";

export type FyBounds = {
  from: string;
  to: string;
  label: string;
  startMonth: number;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Financial year containing `asOf` (default India: April–March). */
export function fyBounds(asOf: string, startMonth = 4): FyBounds {
  const month = Math.min(12, Math.max(1, startMonth || 4));
  const d = asOf.slice(0, 10);
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  const startYear = m >= month ? y : y - 1;
  const endYear = startYear + 1;
  const from = `${startYear}-${pad(month)}-01`;
  // Last day of month before next FY start
  const end = new Date(endYear, month - 1, 0);
  const to = `${end.getFullYear()}-${pad(end.getMonth() + 1)}-${pad(end.getDate())}`;
  const label = `${startYear}-${String(endYear).slice(2)}`;
  return { from, to, label, startMonth: month };
}

export function assertPeriodOpen(
  date: string,
  settings: Pick<AppSettings, "lockedThroughDate">
): void {
  const lock = settings.lockedThroughDate?.slice(0, 10);
  if (!lock) return;
  if (date.slice(0, 10) <= lock) {
    throw new Error(
      `Period locked through ${lock}. Unlock in Accounts → Controls to post or void.`
    );
  }
}

export function userDisplayName(
  users: UserProfile[],
  userId: string | undefined
): string {
  if (!userId) return "—";
  if (userId === "system") return "System";
  const u = users.find((x) => x.id === userId);
  return u?.name || userId;
}

export type HealthCheckItem = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
  ownerOnly?: boolean;
};

export type HealthReport = {
  asOf: string;
  items: HealthCheckItem[];
  okCount: number;
  failCount: number;
};

export function runBooksHealthCheck(input: {
  accounts: Account[];
  ledgerEntries: LedgerEntry[];
  parties: Party[];
  vouchers: Voucher[];
  billAllocations?: BillAllocation[];
  orders: Order[];
  stockBatches?: StockBatch[];
  asOf: string;
}): HealthReport {
  const asOf = input.asOf.slice(0, 10);
  const items: HealthCheckItem[] = [];

  const tb = trialBalance(input.accounts, input.ledgerEntries, asOf);
  const tbDiff = roundMoney(tb.totalDebit - tb.totalCredit);
  items.push({
    id: "trial_balance",
    label: "Trial balance",
    ownerOnly: true,
    ok: Math.abs(tbDiff) < 0.02,
    detail:
      Math.abs(tbDiff) < 0.02
        ? `Balanced · Dr ${tb.totalDebit} = Cr ${tb.totalCredit}`
        : `Gap ₹${tbDiff} (Dr ${tb.totalDebit} vs Cr ${tb.totalCredit})`,
  });

  const invGap = inventoryOpeningGap(
    {
      accounts: input.accounts,
      ledgerEntries: input.ledgerEntries,
      stockBatches: input.stockBatches,
    },
    asOf
  );
  items.push({
    id: "inventory_layers",
    label: "Inventory ledger vs FIFO layers",
    ok: Math.abs(invGap.gap) < 1,
    detail: `Ledger ${invGap.ledger} · Layers ${invGap.layers} · Gap ${invGap.gap}`,
    ownerOnly: true,
  });

  const debtors = input.accounts.find((a) => a.id === ACCT.debtors);
  const debtorsBal = debtors
    ? accountBalance(debtors, input.ledgerEntries, asOf)
    : 0;
  const partyRecv = roundMoney(
    input.parties
      .filter((p) => p.type === "customer")
      .reduce(
        (s, p) => s + partyBalance(p, input.ledgerEntries, asOf),
        0
      )
  );
  const unassignedDebtors = roundMoney(
    input.ledgerEntries
      .filter(
        (e) =>
          !e.voided &&
          e.accountId === ACCT.debtors &&
          !e.partyId &&
          (!asOf || e.date.slice(0, 10) <= asOf)
      )
      .reduce((s, e) => s + e.debit - e.credit, 0)
  );
  const recvDiff = roundMoney(partyRecv - debtorsBal);
  items.push({
    id: "debtors_control",
    label: "Customer balances = Debtors control",
    ok: Math.abs(recvDiff) < 0.5,
    detail:
      Math.abs(recvDiff) < 0.5
        ? `Parties ${partyRecv} · Control ${debtorsBal}`
        : `Parties ${partyRecv} · Control ${debtorsBal} · Diff ${recvDiff}${
            Math.abs(unassignedDebtors) >= 0.5
              ? ` · Unassigned ledger ${unassignedDebtors}`
              : ""
          }`,
  });

  const creditors = input.accounts.find((a) => a.id === ACCT.creditors);
  const creditorsBal = creditors
    ? accountBalance(creditors, input.ledgerEntries, asOf)
    : 0;
  const partyPay = roundMoney(
    input.parties
      .filter((p) => p.type === "supplier")
      .reduce(
        (s, p) => s + partyBalance(p, input.ledgerEntries, asOf),
        0
      )
  );
  const payDiff = roundMoney(partyPay - creditorsBal);
  items.push({
    id: "creditors_control",
    label: "Supplier balances = Creditors control",
    ownerOnly: true,
    ok: Math.abs(payDiff) < 0.5,
    detail:
      Math.abs(payDiff) < 0.5
        ? `Parties ${partyPay} · Control ${creditorsBal}`
        : `Parties ${partyPay} · Control ${creditorsBal} · Diff ${payDiff}`,
  });

  const openRecv = allOpenReceivables(
    input.parties,
    input.vouchers,
    input.billAllocations ?? [],
    asOf
  );
  const openSum = roundMoney(
    openRecv.reduce((s, r) => s + r.outstanding, 0)
  );
  items.push({
    id: "open_receivables",
    label: "Open receivable bills",
    ok: true,
    detail: `${openRecv.length} open bills · ${openSum}`,
  });

  const billedOrders = input.orders.filter(
    (o) =>
      o.status !== "cancelled" &&
      o.actualBillAmount != null &&
      o.actualBillAmount > 0
  );
  const missingSale = billedOrders.filter(
    (o) =>
      !input.vouchers.some(
        (v) =>
          v.linkedOrderId === o.id && v.type === "sale" && !v.voided
      )
  );
  items.push({
    id: "billed_orders",
    label: "Billed orders have sale vouchers",
    ok: missingSale.length === 0,
    detail:
      missingSale.length === 0
        ? `${billedOrders.length} billed orders OK`
        : `${missingSale.length} missing sale: ${missingSale
            .slice(0, 5)
            .map((o) => o.orderNumber || o.id)
            .join(", ")}`,
  });

  const verifiedOrders = input.orders.filter(
    (o) =>
      o.status !== "cancelled" &&
      o.paymentProof?.verified &&
      (o.actualBillAmount ?? 0) > 0
  );
  const missingReceipt = verifiedOrders.filter((o) => {
    const sale = input.vouchers.find(
      (v) => v.linkedOrderId === o.id && v.type === "sale" && !v.voided
    );
    if (!sale) return true;
    const due = Math.max(
      0,
      (o.actualBillAmount ?? 0) - (o.walletUsed || 0)
    );
    if (due <= 0.05) return false;
    return !input.vouchers.some(
      (v) => v.linkedOrderId === o.id && v.type === "receipt" && !v.voided
    );
  });
  items.push({
    id: "verified_receipts",
    label: "Verified payments have receipts",
    ok: missingReceipt.length === 0,
    detail:
      missingReceipt.length === 0
        ? `${verifiedOrders.length} verified orders OK`
        : `${missingReceipt.length} missing receipt: ${missingReceipt
            .slice(0, 5)
            .map((o) => o.orderNumber || o.id)
            .join(", ")}`,
  });

  const okCount = items.filter((i) => i.ok).length;
  return {
    asOf,
    items,
    okCount,
    failCount: items.length - okCount,
  };
}

export type AuditRow = {
  id: string;
  at: string;
  date: string;
  kind: string;
  number: string;
  summary: string;
  byUserId: string;
  byName: string;
  voided: boolean;
};

export function listAuditRows(input: {
  vouchers: Voucher[];
  goodsReceipts?: GoodsReceipt[];
  users: UserProfile[];
  from?: string;
  to?: string;
  q?: string;
  /** Hide purchase / mill payment rupees in the summary line. */
  hideSensitiveAmounts?: boolean;
}): AuditRow[] {
  const from = input.from?.slice(0, 10);
  const to = input.to?.slice(0, 10);
  const q = input.q?.trim().toLowerCase();
  const rows: AuditRow[] = [];

  for (const v of input.vouchers) {
    rows.push({
      id: v.id,
      at: v.createdAt,
      date: v.date,
      kind: v.isOpening ? `opening_${v.type}` : v.type,
      number: v.number,
      summary:
        v.narration ||
        (staffMustHideVoucherRupees(v.type, !input.hideSensitiveAmounts)
          ? v.type
          : `${v.type} · ${v.total}`),
      byUserId: v.createdBy,
      byName: userDisplayName(input.users, v.createdBy),
      voided: v.voided,
    });
    if (v.voided && v.voidedAt) {
      rows.push({
        id: `${v.id}_void`,
        at: v.voidedAt,
        date: v.date,
        kind: "void",
        number: v.number,
        summary: `Voided ${v.type}`,
        byUserId: v.voidedBy || "—",
        byName: userDisplayName(input.users, v.voidedBy),
        voided: true,
      });
    }
  }

  for (const g of input.goodsReceipts ?? []) {
    rows.push({
      id: g.id,
      at: g.createdAt,
      date: g.date,
      kind: "grn",
      number: g.number,
      summary: g.narration || "Goods received",
      byUserId: g.createdBy,
      byName: userDisplayName(input.users, g.createdBy),
      voided: g.voided,
    });
    if (g.voided && g.voidedAt) {
      rows.push({
        id: `${g.id}_void`,
        at: g.voidedAt,
        date: g.date,
        kind: "void_grn",
        number: g.number,
        summary: "Voided goods receipt",
        byUserId: g.voidedBy || "—",
        byName: userDisplayName(input.users, g.voidedBy),
        voided: true,
      });
    }
  }

  return rows
    .filter((r) => {
      if (from && r.date < from && r.at.slice(0, 10) < from) return false;
      if (to && r.date > to && r.at.slice(0, 10) > to) return false;
      if (
        q &&
        !`${r.number} ${r.summary} ${r.byName} ${r.kind}`
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      return true;
    })
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Slice of DB safe to download as books backup. */
export function buildBooksBackupPayload(db: {
  settings: AppSettings;
  accounts: Account[];
  parties: Party[];
  vouchers: Voucher[];
  ledgerEntries: LedgerEntry[];
  billAllocations: unknown[];
  stockBatches?: unknown[];
  batchConsumptions?: unknown[];
  purchaseOrders?: unknown[];
  goodsReceipts?: unknown[];
  supplierContracts?: unknown[];
  statementMatches?: unknown[];
  stockMovements?: unknown[];
}): Record<string, unknown> {
  return {
    exportedAt: new Date().toISOString(),
    companyName: db.settings.companyName,
    financialYearStartMonth: db.settings.financialYearStartMonth ?? 4,
    lockedThroughDate: db.settings.lockedThroughDate ?? null,
    settings: {
      companyName: db.settings.companyName,
      phone: db.settings.phone,
      address: db.settings.address,
      gstin: db.settings.gstin,
      financialYearStartMonth: db.settings.financialYearStartMonth,
      lockedThroughDate: db.settings.lockedThroughDate,
      fifoMigratedAt: db.settings.fifoMigratedAt,
    },
    accounts: db.accounts,
    parties: db.parties,
    vouchers: db.vouchers,
    ledgerEntries: db.ledgerEntries,
    billAllocations: db.billAllocations,
    stockBatches: db.stockBatches ?? [],
    batchConsumptions: db.batchConsumptions ?? [],
    purchaseOrders: db.purchaseOrders ?? [],
    goodsReceipts: db.goodsReceipts ?? [],
    supplierContracts: db.supplierContracts ?? [],
    statementMatches: db.statementMatches ?? [],
    stockMovements: db.stockMovements ?? [],
  };
}
