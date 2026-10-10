import {
  allOpenPayables,
  allOpenReceivables,
  balanceSheet,
  cashFlowStatement,
  creditLimitBreach,
  partyBalance,
  profitAndLoss,
  profitAnalysis,
  purchaseAnalysis,
  salesAnalysis,
  stockAlertsFromDb,
  stockValuation,
  trialBalance,
  type AgingBucketKey,
  type AgingBuckets,
  type AggRow,
  type CashFlowSection,
  type OpenInvoice,
} from "@/lib/accounting";
import { monthRange, shiftMonth } from "@/lib/month-date";
import { bankBooksTotal, cashInHand } from "@/lib/bank-accounts";
import {
  buildMonthlyAuditReport,
  type MonthlyAuditReport,
} from "@/lib/owner-monthly-audit";
import { roundMoney } from "@/lib/pricing";
import type { AppDatabase } from "@/lib/store/db";
import type {
  Account,
  HrAdvance,
  LedgerEntry,
  Party,
  Product,
  StockMovement,
  Voucher,
} from "@/lib/types";

export type PlSnapshot = {
  income: number;
  expense: number;
  net: number;
  rows: { name: string; amount: number; kind: "income" | "expense" }[];
};

export type PlVariance = {
  income: number;
  expense: number;
  net: number;
  incomePct: number | null;
  expensePct: number | null;
  netPct: number | null;
};

export type ItemMovementRow = {
  key: string;
  productId: string;
  variationId?: string;
  colorId?: string;
  label: string;
  sku?: string;
  category?: string;
  opening: number;
  inbound: number;
  outbound: number;
  closing: number;
  value: number;
  avgRate: number;
};

export type AgingSummary = {
  buckets: AgingBuckets;
  overdue: {
    partyId: string;
    partyName: string;
    number: string;
    date: string;
    outstanding: number;
    daysOverdue: number;
  }[];
  total: number;
  overdueTotal: number;
};

export type OwnerMonthReport = {
  month: string;
  from: string;
  to: string;
  priorMonth: string;
  yearAgoMonth: string;
  pl: PlSnapshot;
  plPrior: PlSnapshot;
  plYearAgo: PlSnapshot;
  vsPrior: PlVariance;
  vsYearAgo: PlVariance;
  balanceSheet: ReturnType<typeof balanceSheet>;
  trialBalance: ReturnType<typeof trialBalance>;
  cashClose: number;
  bankClose: number;
  cashFlow: {
    opening: number;
    closing: number;
    operating: CashFlowSection;
    investing: CashFlowSection;
    financing: CashFlowSection;
    netChange: number;
  };
  items: ItemMovementRow[];
  topMovers: ItemMovementRow[];
  slowStock: { label: string; daysSinceOut?: number; stock: number }[];
  deadStock: { label: string; daysSinceOut?: number; stock: number }[];
  grossProfit: {
    totals: { sales: number; cogs: number; profit: number };
    byItem: AggRow[];
    byCategory: AggRow[];
    byDealer: AggRow[];
  };
  dealers: {
    top: AggRow[];
    newDealers: { id: string; name: string; createdAt: string }[];
    creditBreaches: {
      partyId: string;
      name: string;
      outstanding: number;
      limit: number;
      overBy: number;
    }[];
  };
  suppliers: {
    bySupplier: AggRow[];
    byItem: AggRow[];
    total: number;
  };
  receivables: AgingSummary;
  payables: AgingSummary;
  hr: {
    payrollNet: number;
    payrollGross: number;
    slipCount: number;
    attendanceExceptions: number;
    missingClockOut: number;
    gpsFlags: number;
    advancesOutstanding: number;
  };
  audit: MonthlyAuditReport;
  periodLockedThrough: string | null;
  auditOverride?: { by: string; at: string; reason: string };
};

function pctDelta(current: number, prior: number): number | null {
  if (Math.abs(prior) < 0.005) return current === 0 ? null : 100;
  return roundMoney(((current - prior) / Math.abs(prior)) * 100);
}

function plSnapshot(
  accounts: Account[],
  entries: LedgerEntry[],
  from: string,
  to: string
): PlSnapshot {
  const pl = profitAndLoss(accounts, entries, from, to);
  return {
    income: pl.totalIncome,
    expense: pl.totalExpense,
    net: pl.netProfit,
    rows: [
      ...pl.income.map((r) => ({
        name: r.name,
        amount: r.amount,
        kind: "income" as const,
      })),
      ...pl.expenses.map((r) => ({
        name: r.name,
        amount: r.amount,
        kind: "expense" as const,
      })),
    ],
  };
}

function variance(current: PlSnapshot, prior: PlSnapshot): PlVariance {
  return {
    income: roundMoney(current.income - prior.income),
    expense: roundMoney(current.expense - prior.expense),
    net: roundMoney(current.net - prior.net),
    incomePct: pctDelta(current.income, prior.income),
    expensePct: pctDelta(current.expense, prior.expense),
    netPct: pctDelta(current.net, prior.net),
  };
}

function movementQty(m: StockMovement): number {
  return Number(m.secondaryQty ?? m.qty) || 0;
}

function isPhysicalMovement(m: StockMovement): boolean {
  return m.type !== "estimate_reserve" && m.type !== "estimate_release";
}

function skuKey(
  productId: string,
  variationId?: string,
  colorId?: string
): string {
  return `${productId}|${variationId ?? ""}|${colorId ?? ""}`;
}

function productLabel(
  product: Product | undefined,
  variationId?: string,
  colorId?: string
): string {
  if (!product) return "Unknown";
  const base = product.name?.en || product.itemName?.en || product.code;
  const variation = product.variations?.find((v) => v.id === variationId);
  const color = product.colors?.find((c) => c.id === colorId);
  const extra = [variation?.size?.en || variation?.label?.en, color?.name?.en]
    .filter(Boolean)
    .join(" / ");
  return extra ? `${base} · ${extra}` : base;
}

export function itemMovementRollup(
  db: Pick<AppDatabase, "products" | "stockMovements" | "stockBatches" | "categories">,
  from: string,
  to: string
): ItemMovementRow[] {
  const map = new Map<
    string,
    {
      productId: string;
      variationId?: string;
      colorId?: string;
      opening: number;
      inbound: number;
      outbound: number;
    }
  >();

  const bump = (
    productId: string,
    variationId: string | undefined,
    colorId: string | undefined
  ) => {
    const key = skuKey(productId, variationId, colorId);
    const cur = map.get(key) || {
      productId,
      variationId,
      colorId,
      opening: 0,
      inbound: 0,
      outbound: 0,
    };
    map.set(key, cur);
    return cur;
  };

  for (const m of db.stockMovements ?? []) {
    if (!isPhysicalMovement(m)) continue;
    const qty = movementQty(m);
    const day = m.date.slice(0, 10);
    const row = bump(m.productId, m.variationId, m.colorId);
    const signed = m.direction === "in" ? qty : -qty;
    if (day < from) {
      row.opening = roundMoney(row.opening + signed);
    } else if (day <= to) {
      if (m.direction === "in") row.inbound = roundMoney(row.inbound + qty);
      else row.outbound = roundMoney(row.outbound + qty);
    }
  }

  const valMap = new Map<string, { value: number; qty: number; avgRate: number }>();
  for (const v of stockValuation(db.stockBatches ?? [])) {
    valMap.set(skuKey(v.productId, v.variationId, v.colorId), {
      value: v.value,
      qty: v.qty,
      avgRate: v.avgRate,
    });
  }

  const rows: ItemMovementRow[] = [];
  for (const [key, row] of map) {
    const product = db.products.find((p) => p.id === row.productId);
    const closing = roundMoney(row.opening + row.inbound - row.outbound);
    const val = valMap.get(key);
    const avgRate = val?.avgRate ?? 0;
    const category = db.categories?.find((c) => c.id === product?.category);
    rows.push({
      key,
      productId: row.productId,
      variationId: row.variationId,
      colorId: row.colorId,
      label: productLabel(product, row.variationId, row.colorId),
      sku: product?.variations?.find((v) => v.id === row.variationId)?.sku,
      category: category?.name.en || product?.category,
      opening: row.opening,
      inbound: row.inbound,
      outbound: row.outbound,
      closing,
      value: val
        ? val.value
        : roundMoney(Math.max(0, closing) * avgRate),
      avgRate,
    });
  }

  return rows.sort(
    (a, b) =>
      Math.abs(b.outbound) + Math.abs(b.inbound) -
      (Math.abs(a.outbound) + Math.abs(a.inbound))
  );
}

function emptyAging(): AgingBuckets {
  return {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
    total: 0,
  };
}

function summarizeAging(
  invoices: OpenInvoice[],
  parties: Party[]
): AgingSummary {
  const buckets = emptyAging();
  const overdue: AgingSummary["overdue"] = [];
  for (const row of invoices) {
    buckets[row.bucket as AgingBucketKey] = roundMoney(
      buckets[row.bucket] + row.outstanding
    );
    buckets.total = roundMoney(buckets.total + row.outstanding);
    if (row.daysOverdue > 0) {
      const party = parties.find((p) => p.id === row.voucher.partyId);
      overdue.push({
        partyId: row.voucher.partyId || "",
        partyName: party?.name || "Unknown",
        number: row.voucher.number,
        date: row.voucher.date.slice(0, 10),
        outstanding: row.outstanding,
        daysOverdue: row.daysOverdue,
      });
    }
  }
  overdue.sort((a, b) => b.daysOverdue - a.daysOverdue || b.outstanding - a.outstanding);
  return {
    buckets,
    overdue: overdue.slice(0, 50),
    total: buckets.total,
    overdueTotal: roundMoney(overdue.reduce((s, r) => s + r.outstanding, 0)),
  };
}

function gpByCategory(
  byItem: AggRow[],
  products: Product[],
  categories: { id: string; name: { en: string } }[]
): AggRow[] {
  const map = new Map<string, AggRow>();
  for (const row of byItem) {
    const productId = row.key.split("|")[0];
    const product = products.find((p) => p.id === productId);
    const catId = product?.category || "other";
    const label =
      categories.find((c) => c.id === catId)?.name.en || catId || "Uncategorised";
    const cur = map.get(catId) || {
      key: catId,
      label,
      amount: 0,
      cogs: 0,
      profit: 0,
      qty: 0,
    };
    cur.amount = roundMoney(cur.amount + row.amount);
    cur.cogs = roundMoney((cur.cogs || 0) + (row.cogs || 0));
    cur.profit = roundMoney((cur.profit || 0) + (row.profit || 0));
    cur.qty = roundMoney((cur.qty || 0) + (row.qty || 0));
    map.set(catId, cur);
  }
  return [...map.values()].sort((a, b) => (b.profit || 0) - (a.profit || 0));
}

function isAdvanceOpen(a: HrAdvance): boolean {
  if (a.status === "rejected") return false;
  if (a.payslipId) return false;
  return a.status === "issued" || a.status === "pending" || a.status == null;
}

function signedSale(v: Voucher): number {
  if (v.voided || v.isOpening) return 0;
  if (v.type === "sale") return v.total;
  if (v.type === "credit_note") return -v.total;
  return 0;
}

export function buildOwnerMonthReport(
  db: AppDatabase,
  month: string
): OwnerMonthReport {
  const { from, to } = monthRange(month);
  const priorMonth = shiftMonth(month, -1);
  const yearAgoMonth = shiftMonth(month, -12);
  const prior = monthRange(priorMonth);
  const yearAgo = monthRange(yearAgoMonth);
  const fyStart = db.settings?.financialYearStartMonth ?? 4;

  const pl = plSnapshot(db.accounts, db.ledgerEntries, from, to);
  const plPrior = plSnapshot(db.accounts, db.ledgerEntries, prior.from, prior.to);
  const plYearAgo = plSnapshot(
    db.accounts,
    db.ledgerEntries,
    yearAgo.from,
    yearAgo.to
  );

  const cashClose = cashInHand(db.accounts, db.ledgerEntries, to);
  const bankClose = bankBooksTotal(db.accounts, db.ledgerEntries, to);

  const items = itemMovementRollup(db, from, to);
  const alerts = stockAlertsFromDb(db, { asOf: to });
  const gp = profitAnalysis(
    db.vouchers,
    db.parties,
    db.products,
    db.batchConsumptions ?? [],
    from,
    to
  );
  const sales = salesAnalysis(
    db.vouchers,
    db.products,
    db.parties,
    db.categories ?? [],
    from,
    to
  );
  const purchases = purchaseAnalysis(db.vouchers, db.parties, from, to);
  const ar = allOpenReceivables(
    db.parties,
    db.vouchers,
    db.billAllocations ?? [],
    to,
    db.orders
  );
  const ap = allOpenPayables(
    db.parties,
    db.vouchers,
    db.billAllocations ?? [],
    to
  );

  const newDealers = db.parties
    .filter((p) => {
      if (p.type !== "customer") return false;
      const day = (p.createdAt || "").slice(0, 10);
      return day >= from && day <= to;
    })
    .map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt }));

  const creditBreaches: OwnerMonthReport["dealers"]["creditBreaches"] = [];
  for (const party of db.parties.filter((p) => p.type === "customer" && p.active)) {
    const outstanding = partyBalance(party, db.ledgerEntries, to);
    const check = creditLimitBreach(party, outstanding, 0);
    if (!check.ok) {
      creditBreaches.push({
        partyId: party.id,
        name: party.name,
        outstanding,
        limit: party.creditLimit || 0,
        overBy: check.overBy,
      });
    }
  }

  const audit = buildMonthlyAuditReport(db, month);
  const slips = (db.hrPayslips ?? []).filter((s) => s.month === month);
  const payrollNet = roundMoney(slips.reduce((s, p) => s + (p.net || 0), 0));
  const payrollGross = roundMoney(slips.reduce((s, p) => s + (p.gross || 0), 0));
  const advancesOutstanding = roundMoney(
    (db.hrAdvances ?? [])
      .filter(isAdvanceOpen)
      .reduce((s, a) => s + (a.amount || 0), 0)
  );

  return {
    month,
    from,
    to,
    priorMonth,
    yearAgoMonth,
    pl,
    plPrior,
    plYearAgo,
    vsPrior: variance(pl, plPrior),
    vsYearAgo: variance(pl, plYearAgo),
    balanceSheet: balanceSheet(
      db.accounts,
      db.ledgerEntries,
      to,
      "en",
      fyStart
    ),
    trialBalance: trialBalance(db.accounts, db.ledgerEntries, to),
    cashClose,
    bankClose,
    cashFlow: cashFlowStatement(
      db.accounts,
      db.ledgerEntries,
      db.vouchers,
      from,
      to
    ),
    items,
    topMovers: items.slice(0, 15),
    slowStock: alerts
      .filter((a) => a.kind === "slow")
      .map((a) => ({
        label: a.label,
        daysSinceOut: a.daysSinceOut,
        stock: a.stock,
      })),
    deadStock: alerts
      .filter((a) => a.kind === "dead")
      .map((a) => ({
        label: a.label,
        daysSinceOut: a.daysSinceOut,
        stock: a.stock,
      })),
    grossProfit: {
      totals: gp.totals,
      byItem: gp.byItem.slice(0, 40),
      byCategory: gpByCategory(gp.byItem, db.products, db.categories ?? []),
      byDealer: gp.byDealer.slice(0, 20),
    },
    dealers: {
      top: sales.byCustomer.slice(0, 20),
      newDealers,
      creditBreaches: creditBreaches.sort((a, b) => b.overBy - a.overBy),
    },
    suppliers: {
      bySupplier: purchases.bySupplier.slice(0, 20),
      byItem: purchases.byItem.slice(0, 20),
      total: roundMoney(
        db.vouchers
          .filter(
            (v) =>
              !v.voided &&
              !v.isOpening &&
              v.date.slice(0, 10) >= from &&
              v.date.slice(0, 10) <= to
          )
          .reduce((s, v) => {
            if (v.type === "purchase") return s + v.total;
            if (v.type === "debit_note") return s - v.total;
            return s;
          }, 0)
      ),
    },
    receivables: summarizeAging(ar, db.parties),
    payables: summarizeAging(ap, db.parties),
    hr: {
      payrollNet,
      payrollGross,
      slipCount: slips.length,
      attendanceExceptions:
        audit.absenteeism.reduce((s, r) => s + r.absentDays, 0) +
        audit.missingClockOut.length +
        audit.gpsFlags.length,
      missingClockOut: audit.missingClockOut.length,
      gpsFlags: audit.gpsFlags.length,
      advancesOutstanding,
    },
    audit,
    periodLockedThrough: db.settings?.lockedThroughDate?.slice(0, 10) || null,
    auditOverride: (db.settings?.monthAuditOverrides ?? []).find(
      (o) => o.month === month
    ),
  };
}

export function monthSalesTotal(vouchers: Voucher[], from: string, to: string): number {
  return roundMoney(
    vouchers.reduce((s, v) => {
      const day = v.date.slice(0, 10);
      if (day < from || day > to) return s;
      return s + signedSale(v);
    }, 0)
  );
}
