import {
  allOpenPayables,
  allOpenReceivables,
  fyBounds,
  purchaseAnalysis,
  salesAnalysis,
  stockValuation,
} from "@/lib/accounting";
import { bankBooksTotal, cashInHand } from "@/lib/bank-accounts";
import {
  parseSeasonMonths,
  stockAlertsFromDb,
  type StockAlertRow,
} from "@/lib/accounting/analysis";
import { listStaleEstimates } from "@/lib/owner-daily-summary";
import { roundMoney } from "@/lib/pricing";
import type {
  Account,
  AppSettings,
  BillAllocation,
  CategoryDef,
  GoodsReceipt,
  LedgerEntry,
  Order,
  Party,
  Product,
  PurchaseOrder,
  StockBatch,
  StockMovement,
  Voucher,
} from "@/lib/types";

export type CommandDeskDb = {
  settings?: AppSettings | null;
  accounts?: Account[];
  ledgerEntries?: LedgerEntry[];
  vouchers?: Voucher[];
  parties?: Party[];
  billAllocations?: BillAllocation[];
  products?: Product[];
  categories?: CategoryDef[];
  stockMovements?: StockMovement[];
  stockBatches?: StockBatch[];
  orders?: Order[];
  purchaseOrders?: PurchaseOrder[];
  goodsReceipts?: GoodsReceipt[];
};

export type MonthlyPair = {
  month: string;
  sales: number;
  purchase: number;
};

export type ReorderMix = {
  critical: number;
  soon: number;
  watch: number;
  healthy: number;
};

export type DeskCategoryRow = {
  key: string;
  label: string;
  sales: number;
  qty: number;
};

export type DeskReorderRow = {
  label: string;
  stock: number;
  suggestedQty: number;
  coverMode?: StockAlertRow["coverMode"];
  stockout: boolean;
};

export type DeskPartyRow = {
  partyId: string;
  name: string;
  outstanding: number;
  overdue: number;
};

export type CommandDesk = {
  asOf: string;
  fyLabel: string;
  fyFrom: string;
  salesToday: number;
  salesMtd: number;
  salesMtdLastYear: number;
  salesFy: number;
  purchaseMtd: number;
  cash: number;
  bank: number;
  receivables: number;
  overdueReceivables: number;
  payables: number;
  stockValue: number;
  skuCount: number;
  monthly: MonthlyPair[];
  mix: ReorderMix;
  topCategories: DeskCategoryRow[];
  reorders: DeskReorderRow[];
  collections: DeskPartyRow[];
  outlookNextMonth: number;
  outlookMethod: "last30" | "last30_season";
  seasonOn: boolean;
  seasonMultiplier: number;
  staleEstimates: number;
  draftPos: number;
  unpricedGrns: number;
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function lastYearSameDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const dt = new Date(y - 1, m - 1, d);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function monthsBack(asOf: string, count: number): string[] {
  const [y, m] = asOf.slice(0, 7).split("-").map(Number);
  const out: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const dt = new Date(y, m - 1 - i, 1);
    out.push(`${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`);
  }
  return out;
}

function signedSales(v: Voucher): number {
  if (v.voided || v.isOpening) return 0;
  if (v.type === "sale") return v.total;
  if (v.type === "credit_note") return -v.total;
  return 0;
}

function signedPurchase(v: Voucher): number {
  if (v.voided || v.isOpening) return 0;
  if (v.type === "purchase") return v.total;
  if (v.type === "debit_note") return -v.total;
  return 0;
}

function sumVouchers(
  vouchers: Voucher[],
  from: string,
  to: string,
  signed: (v: Voucher) => number
): number {
  let s = 0;
  for (const v of vouchers) {
    const day = v.date.slice(0, 10);
    if (day < from || day > to) continue;
    s += signed(v);
  }
  return roundMoney(s);
}

function countUnpricedGrns(db: CommandDeskDb): number {
  const billed = new Set(
    (db.vouchers ?? [])
      .filter((v) => v.type === "purchase" && !v.voided && v.linkedGrnId)
      .map((v) => v.linkedGrnId as string)
  );
  let n = 0;
  for (const grn of db.goodsReceipts ?? []) {
    if (grn.voided || billed.has(grn.id)) continue;
    if ((db.purchaseOrders ?? []).some((p) => p.id === grn.poId)) n += 1;
  }
  return n;
}

export function salesDeltaPct(current: number, prior: number): number | null {
  if (prior <= 0) return current > 0 ? 100 : null;
  return roundMoney(((current - prior) / prior) * 100);
}

export function computeCommandDesk(
  db: CommandDeskDb,
  asOf = new Date().toISOString().slice(0, 10)
): CommandDesk {
  const today = asOf.slice(0, 10);
  const fyStart = db.settings?.financialYearStartMonth ?? 4;
  const fy = fyBounds(today, fyStart);
  const lastFyAsOf = lastYearSameDay(today);
  const mtdFrom = monthStart(today);
  const lastMtdFrom = monthStart(lastFyAsOf);
  const vouchers = db.vouchers ?? [];
  const accounts = db.accounts ?? [];
  const entries = db.ledgerEntries ?? [];
  const parties = db.parties ?? [];
  const allocations = db.billAllocations ?? [];
  const products = db.products ?? [];
  const openRx = allOpenReceivables(parties, vouchers, allocations, today);
  const receivables = roundMoney(
    openRx.reduce((s, r) => s + r.outstanding, 0)
  );
  const overdueReceivables = roundMoney(
    openRx
      .filter((r) => r.daysOverdue > 0)
      .reduce((s, r) => s + r.outstanding, 0)
  );
  const payables = roundMoney(
    allOpenPayables(parties, vouchers, allocations, today).reduce(
      (s, r) => s + r.outstanding,
      0
    )
  );

  const byParty = new Map<string, DeskPartyRow>();
  for (const row of openRx) {
    const id = row.voucher.partyId || "unknown";
    const cur = byParty.get(id) || {
      partyId: id,
      name: parties.find((p) => p.id === id)?.name || "Dealer",
      outstanding: 0,
      overdue: 0,
    };
    cur.outstanding = roundMoney(cur.outstanding + row.outstanding);
    if (row.daysOverdue > 0) {
      cur.overdue = roundMoney(cur.overdue + row.outstanding);
    }
    byParty.set(id, cur);
  }
  const collections = [...byParty.values()]
    .filter((p) => p.overdue > 0)
    .sort((a, b) => b.overdue - a.overdue)
    .slice(0, 6);

  const alerts = stockAlertsFromDb({
    products,
    stockMovements: db.stockMovements,
    orders: db.orders,
    purchaseOrders: db.purchaseOrders,
    settings: db.settings ?? undefined,
  });
  const reorderRows = alerts.filter((r) => r.kind === "reorder");
  const slowRows = alerts.filter((r) => r.kind === "slow");
  const critical = reorderRows.filter((r) => r.stock <= 0).length;
  const soon = reorderRows.length - critical;
  const watch = slowRows.length;
  const skuCount = products.filter((p) => p.active).length;
  const mix: ReorderMix = {
    critical,
    soon,
    watch,
    healthy: Math.max(0, skuCount - critical - soon - watch),
  };

  const fySales = salesAnalysis(
    vouchers,
    products,
    parties,
    db.categories ?? [],
    fy.from,
    today
  );
  const topCategories = fySales.byCategory.slice(0, 6).map((c) => ({
    key: c.key,
    label: c.label,
    sales: c.amount,
    qty: c.qty || 0,
  }));

  const keys = monthsBack(today, 12);
  const salesByMonth = new Map(
    fySales.byMonth.map((m) => [m.month, m.amount] as const)
  );
  const lookbackFrom = `${keys[0]}-01`;
  const purchases = purchaseAnalysis(vouchers, parties, lookbackFrom, today);
  const purchaseByMonth = new Map(
    purchases.byMonth.map((m) => [m.month, m.amount] as const)
  );
  // Include months before this FY for the 12-month chart.
  const olderSales = salesAnalysis(
    vouchers,
    products,
    parties,
    db.categories ?? [],
    lookbackFrom,
    today
  );
  for (const m of olderSales.byMonth) salesByMonth.set(m.month, m.amount);
  const monthly: MonthlyPair[] = keys.map((month) => ({
    month,
    sales: salesByMonth.get(month) || 0,
    purchase: purchaseByMonth.get(month) || 0,
  }));

  const last30From = addDays(today, -29);
  const last30Sales = sumVouchers(vouchers, last30From, today, signedSales);
  const seasonMonths = parseSeasonMonths(db.settings?.autoReorderSeasonMonths);
  const monthNum = Number(today.slice(5, 7));
  const seasonOn = seasonMonths.includes(monthNum);
  const seasonMultiplier =
    typeof db.settings?.autoReorderSeasonMultiplier === "number" &&
    db.settings.autoReorderSeasonMultiplier > 0
      ? db.settings.autoReorderSeasonMultiplier
      : 1.4;
  const outlookMethod: CommandDesk["outlookMethod"] = seasonOn
    ? "last30_season"
    : "last30";
  const outlookNextMonth = roundMoney(
    seasonOn ? last30Sales * seasonMultiplier : last30Sales
  );

  const stockValue = roundMoney(
    stockValuation(db.stockBatches ?? []).reduce((s, r) => s + r.value, 0)
  );

  return {
    asOf: today,
    fyLabel: fy.label,
    fyFrom: fy.from,
    salesToday: sumVouchers(vouchers, today, today, signedSales),
    salesMtd: sumVouchers(vouchers, mtdFrom, today, signedSales),
    salesMtdLastYear: sumVouchers(
      vouchers,
      lastMtdFrom,
      lastFyAsOf,
      signedSales
    ),
    salesFy: sumVouchers(vouchers, fy.from, today, signedSales),
    purchaseMtd: sumVouchers(vouchers, mtdFrom, today, signedPurchase),
    cash: cashInHand(accounts, entries, today),
    bank: bankBooksTotal(accounts, entries, today),
    receivables,
    overdueReceivables,
    payables,
    stockValue,
    skuCount,
    monthly,
    mix,
    topCategories,
    reorders: reorderRows
      .slice()
      .sort((a, b) => b.suggestedQty - a.suggestedQty)
      .slice(0, 8)
      .map((r) => ({
        label: r.label,
        stock: r.stock,
        suggestedQty: r.suggestedQty,
        coverMode: r.coverMode,
        stockout: r.stock <= 0,
      })),
    collections,
    outlookNextMonth,
    outlookMethod,
    seasonOn,
    seasonMultiplier,
    staleEstimates: listStaleEstimates(db.orders ?? [], today).length,
    draftPos: (db.purchaseOrders ?? []).filter((p) => p.status === "draft")
      .length,
    unpricedGrns: countUnpricedGrns(db),
  };
}
