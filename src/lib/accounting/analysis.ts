import type {
  AppSettings,
  BatchConsumption,
  CategoryDef,
  LedgerEntry,
  Order,
  Party,
  Product,
  PurchaseOrder,
  StockMovement,
  Voucher,
} from "../types";
import { stockMatrixKey } from "../inventory";
import { poLineRemaining } from "../purchase-orders";
import { roundMoney } from "../pricing";
import { ACCT } from "./seed";
import { accountBalance } from "./engine";
import type { Account } from "../types";

export type AggRow = {
  key: string;
  label: string;
  amount: number;
  qty?: number;
  secondaryQty?: number;
  cogs?: number;
  profit?: number;
  count?: number;
};

export type MonthPoint = { month: string; amount: number; count?: number };

function inRange(date: string, from: string, to: string): boolean {
  const d = date.slice(0, 10);
  return d >= from.slice(0, 10) && d <= to.slice(0, 10);
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function bump(
  map: Map<string, AggRow>,
  key: string,
  label: string,
  delta: Partial<AggRow>
): void {
  const cur = map.get(key) || {
    key,
    label,
    amount: 0,
    qty: 0,
    secondaryQty: 0,
    cogs: 0,
    profit: 0,
    count: 0,
  };
  cur.amount = roundMoney(cur.amount + (delta.amount || 0));
  cur.qty = roundMoney((cur.qty || 0) + (delta.qty || 0));
  cur.secondaryQty = roundMoney(
    (cur.secondaryQty || 0) + (delta.secondaryQty || 0)
  );
  cur.cogs = roundMoney((cur.cogs || 0) + (delta.cogs || 0));
  cur.profit = roundMoney((cur.profit || 0) + (delta.profit || 0));
  cur.count = (cur.count || 0) + (delta.count || 0);
  map.set(key, cur);
}

function sorted(map: Map<string, AggRow>): AggRow[] {
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

/** Sales by dimension for period. */
export function salesAnalysis(
  vouchers: Voucher[],
  products: Product[],
  parties: Party[],
  categories: CategoryDef[],
  from: string,
  to: string
): {
  byItem: AggRow[];
  byCustomer: AggRow[];
  byCategory: AggRow[];
  byMonth: MonthPoint[];
} {
  const byItem = new Map<string, AggRow>();
  const byCustomer = new Map<string, AggRow>();
  const byCategory = new Map<string, AggRow>();
  const monthMap = new Map<string, MonthPoint>();
  const catName = (id: string) =>
    categories.find((c) => c.id === id)?.name.en || id || "Uncategorised";

  for (const v of vouchers) {
    if (v.voided || v.isOpening) continue;
    if (!inRange(v.date, from, to)) continue;
    const sign = v.type === "credit_note" ? -1 : v.type === "sale" ? 1 : 0;
    if (!sign) continue;

    const party = parties.find((p) => p.id === v.partyId);
    bump(byCustomer, v.partyId || "unknown", party?.name || "Unknown", {
      amount: sign * v.total,
      count: sign > 0 ? 1 : -1,
    });

    const mk = monthKey(v.date);
    const mp = monthMap.get(mk) || { month: mk, amount: 0, count: 0 };
    mp.amount = roundMoney(mp.amount + sign * v.total);
    mp.count = (mp.count || 0) + (sign > 0 ? 1 : 0);
    monthMap.set(mk, mp);

    for (const l of v.lines) {
      if (l.accountId && !l.productId) continue;
      const key = l.productId
        ? `${l.productId}|${l.variationId ?? ""}`
        : `lbl:${l.itemLabel}`;
      bump(byItem, key, l.itemLabel, {
        amount: sign * l.amount,
        qty: sign * l.qty,
        secondaryQty: sign * (l.secondaryQty ?? l.qty),
      });
      const product = products.find((p) => p.id === l.productId);
      const catId = product?.category || "other";
      bump(byCategory, catId, catName(catId), {
        amount: sign * l.amount,
        qty: sign * l.qty,
      });
    }
  }

  return {
    byItem: sorted(byItem),
    byCustomer: sorted(byCustomer),
    byCategory: sorted(byCategory),
    byMonth: [...monthMap.values()].sort((a, b) =>
      a.month.localeCompare(b.month)
    ),
  };
}

/** Purchases by supplier and item. */
export function purchaseAnalysis(
  vouchers: Voucher[],
  parties: Party[],
  from: string,
  to: string
): { bySupplier: AggRow[]; byItem: AggRow[]; byMonth: MonthPoint[] } {
  const bySupplier = new Map<string, AggRow>();
  const byItem = new Map<string, AggRow>();
  const monthMap = new Map<string, MonthPoint>();

  for (const v of vouchers) {
    if (v.voided || v.isOpening) continue;
    if (!inRange(v.date, from, to)) continue;
    const sign =
      v.type === "debit_note" ? -1 : v.type === "purchase" ? 1 : 0;
    if (!sign) continue;

    const party = parties.find((p) => p.id === v.partyId);
    bump(bySupplier, v.partyId || "unknown", party?.name || "Unknown", {
      amount: sign * v.total,
      count: sign > 0 ? 1 : -1,
    });

    const mk = monthKey(v.date);
    const mp = monthMap.get(mk) || { month: mk, amount: 0, count: 0 };
    mp.amount = roundMoney(mp.amount + sign * v.total);
    monthMap.set(mk, mp);

    for (const l of v.lines) {
      const key = l.productId
        ? `${l.productId}|${l.variationId ?? ""}`
        : `lbl:${l.itemLabel}`;
      bump(byItem, key, l.itemLabel, {
        amount: sign * l.amount,
        qty: sign * l.qty,
        secondaryQty: sign * (l.secondaryQty ?? l.qty),
      });
    }
  }

  return {
    bySupplier: sorted(bySupplier),
    byItem: sorted(byItem),
    byMonth: [...monthMap.values()].sort((a, b) =>
      a.month.localeCompare(b.month)
    ),
  };
}

/** Gross profit from sales using voucher.cogsAmount / batch consumptions. */
export function profitAnalysis(
  vouchers: Voucher[],
  parties: Party[],
  products: Product[],
  consumptions: BatchConsumption[],
  from: string,
  to: string
): {
  byItem: AggRow[];
  byDealer: AggRow[];
  byOrder: AggRow[];
  totals: { sales: number; cogs: number; profit: number };
} {
  const byItem = new Map<string, AggRow>();
  const byDealer = new Map<string, AggRow>();
  const byOrder = new Map<string, AggRow>();
  let sales = 0;
  let cogs = 0;

  const costByVoucherLine = new Map<string, number>();
  for (const c of consumptions) {
    if (!inRange(c.date, from, to)) continue;
    const key = `${c.voucherId}|${c.productId}|${c.variationId ?? ""}`;
    costByVoucherLine.set(
      key,
      roundMoney((costByVoucherLine.get(key) || 0) + c.costAmount)
    );
  }

  for (const v of vouchers) {
    if (v.voided || v.isOpening) continue;
    if (!inRange(v.date, from, to)) continue;
    if (v.type !== "sale" && v.type !== "credit_note") continue;
    const sign = v.type === "credit_note" ? -1 : 1;
    const vCogs = roundMoney((v.cogsAmount || 0) * sign);
    const vSales = roundMoney(v.total * sign);
    sales = roundMoney(sales + vSales);
    cogs = roundMoney(cogs + vCogs);
    const profit = roundMoney(vSales - vCogs);

    const party = parties.find((p) => p.id === v.partyId);
    bump(byDealer, v.partyId || "unknown", party?.name || "Unknown", {
      amount: vSales,
      cogs: vCogs,
      profit,
      count: sign > 0 ? 1 : -1,
    });

    if (v.linkedOrderId) {
      bump(byOrder, v.linkedOrderId, v.number, {
        amount: vSales,
        cogs: vCogs,
        profit,
        count: 1,
      });
    }

    for (const l of v.lines) {
      if (!l.productId && !l.itemLabel) continue;
      const key = l.productId
        ? `${l.productId}|${l.variationId ?? ""}`
        : `lbl:${l.itemLabel}`;
      const lineCostKey = `${v.id}|${l.productId || ""}|${l.variationId ?? ""}`;
      const lineCogs = roundMoney(
        (costByVoucherLine.get(lineCostKey) || 0) * sign
      );
      // Fall back to proportional share of voucher COGS
      const share =
        v.subtotal > 0
          ? roundMoney(vCogs * (l.amount / v.subtotal))
          : 0;
      const usedCogs = lineCogs || share;
      const lineSales = roundMoney(l.amount * sign);
      const product = products.find((p) => p.id === l.productId);
      bump(byItem, key, l.itemLabel || product?.name.en || key, {
        amount: lineSales,
        cogs: usedCogs,
        profit: roundMoney(lineSales - usedCogs),
        qty: sign * l.qty,
      });
    }
  }

  const sortProfit = (rows: AggRow[]) =>
    [...rows].sort((a, b) => (b.profit || 0) - (a.profit || 0));

  return {
    byItem: sortProfit([...byItem.values()]),
    byDealer: sortProfit([...byDealer.values()]),
    byOrder: sortProfit([...byOrder.values()]).slice(0, 100),
    totals: {
      sales,
      cogs,
      profit: roundMoney(sales - cogs),
    },
  };
}

export type StockAlertRow = {
  productId: string;
  variationId?: string;
  colorId?: string;
  label: string;
  stock: number;
  stockSecondary: number;
  minStockLevel: number;
  /** Bundles to order after cover/min + committed − on-hand − incoming */
  suggestedQty: number;
  preferredSupplierId?: string;
  lastOutDate?: string;
  daysSinceOut?: number;
  kind: "reorder" | "dead" | "slow";
  avgDailyOut?: number;
  incomingQty?: number;
  committedQty?: number;
  coverMode?: ReorderCoverMode;
};

export const REORDER_DEFAULTS = {
  lookbackDays: 30,
  leadTimeDays: 10,
  safetyDays: 7,
  seasonMonths: [5, 6, 7, 8, 9] as readonly number[],
  seasonMultiplier: 1.4,
};

export type ReorderCoverMode = "velocity" | "min";

export function stockSkuKey(
  productId: string,
  variationId?: string,
  colorId?: string
): string {
  return `${productId}|${variationId ?? ""}|${colorId ?? ""}`;
}

export function isDemandOutMovement(m: Pick<StockMovement, "direction" | "type">): boolean {
  if (m.direction !== "out") return false;
  return m.type !== "estimate_reserve" && m.type !== "estimate_release";
}

export function roundUpToMultiple(qty: number, multiple: number): number {
  if (qty <= 0) return 0;
  if (!(multiple > 1)) return Math.ceil(qty);
  return Math.ceil(qty / multiple) * multiple;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function monthOf(iso: string): number {
  return Number(iso.slice(5, 7));
}

export function parseSeasonMonths(
  raw: number[] | undefined,
  fallback: readonly number[] = REORDER_DEFAULTS.seasonMonths
): number[] {
  if (!raw?.length) return [...fallback];
  const months = raw
    .map((n) => Math.round(Number(n)))
    .filter((n) => n >= 1 && n <= 12);
  return months.length ? months : [...fallback];
}

/** Accepts "5-9" or "5,6,7,8,9". */
export function parseSeasonMonthsFromText(text: string): number[] {
  const trimmed = text.trim();
  const range = /^(\d{1,2})\s*[-–]\s*(\d{1,2})$/.exec(trimmed);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (a >= 1 && b <= 12 && a <= b) {
      const out: number[] = [];
      for (let m = a; m <= b; m++) out.push(m);
      return out;
    }
  }
  const months = trimmed
    .split(/[, ]+/)
    .map((s) => Number(s))
    .filter((n) => n >= 1 && n <= 12);
  return months.length ? months : [...REORDER_DEFAULTS.seasonMonths];
}

export function formatSeasonMonths(months: number[] | undefined): string {
  const sorted = [...parseSeasonMonths(months)].sort((a, b) => a - b);
  const consecutive = sorted.every(
    (n, i) => i === 0 || n === sorted[i - 1]! + 1
  );
  if (consecutive && sorted.length > 1) {
    return `${sorted[0]}-${sorted[sorted.length - 1]}`;
  }
  return sorted.join(",");
}

export function isSeasonalCoverCategory(category: string): boolean {
  const c = (category || "").toLowerCase().replace(/[\s-]+/g, "_");
  if (c === "shade_net" || c.includes("shade")) return false;
  return (
    c === "tarpaulin" ||
    c === "tirpal" ||
    c.includes("tarpaulin") ||
    c.includes("tirpal")
  );
}

export function seasonMultiplier(
  category: string,
  asOf: string,
  settings?: AppSettings
): number {
  const months = parseSeasonMonths(settings?.autoReorderSeasonMonths);
  if (!months.includes(monthOf(asOf)) || !isSeasonalCoverCategory(category)) {
    return 1;
  }
  const m = settings?.autoReorderSeasonMultiplier;
  return typeof m === "number" && m > 0 ? m : REORDER_DEFAULTS.seasonMultiplier;
}

export function productCoverDays(
  product: Product,
  settings?: AppSettings
): number {
  const lead =
    product.leadTimeDays ??
    settings?.autoReorderLeadTimeDays ??
    REORDER_DEFAULTS.leadTimeDays;
  const safety = settings?.autoReorderSafetyDays ?? REORDER_DEFAULTS.safetyDays;
  return Math.max(0, lead) + Math.max(0, safety);
}

export type ReorderSuggestionInput = {
  onHand: number;
  staffMin: number;
  reorderQty?: number;
  avgDailyOut: number;
  hadVelocity: boolean;
  coverDays: number;
  season: number;
  committed: number;
  incoming: number;
  minOrderQty?: number;
  useVelocity: boolean;
};

export type ReorderSuggestion = {
  triggerMin: number;
  suggestedQty: number;
  coverMode: ReorderCoverMode;
  avgDailyOut: number;
  incomingQty: number;
  committedQty: number;
};

/** Cover/min + committed − on-hand − incoming, then MOQ round. */
export function computeReorderSuggestion(
  input: ReorderSuggestionInput
): ReorderSuggestion {
  const staffMin = Math.max(0, input.staffMin);
  const fillTo = Math.max(0, input.reorderQty ?? 0);
  const coverQty =
    input.useVelocity && input.hadVelocity
      ? Math.ceil(
          Math.max(0, input.avgDailyOut) * input.coverDays * input.season
        )
      : 0;
  const triggerMin = Math.max(staffMin, coverQty, fillTo);
  const raw = Math.max(
    0,
    triggerMin + input.committed - input.onHand - input.incoming
  );
  const suggestedQty = roundUpToMultiple(Math.ceil(raw), input.minOrderQty ?? 0);
  const coverMode: ReorderCoverMode =
    coverQty > 0 && coverQty >= staffMin && coverQty >= fillTo
      ? "velocity"
      : "min";
  return {
    triggerMin,
    suggestedQty,
    coverMode,
    avgDailyOut: input.avgDailyOut,
    incomingQty: input.incoming,
    committedQty: input.committed,
  };
}

function bumpQty(map: Map<string, number>, key: string, qty: number): void {
  if (!qty) return;
  map.set(key, (map.get(key) || 0) + qty);
}

type SkuLevel = "product" | "variation" | "matrix";

function qtyForLevel(
  map: Map<string, number>,
  productId: string,
  variationId: string | undefined,
  colorId: string | undefined,
  level: SkuLevel
): number {
  if (level === "matrix") {
    return map.get(stockSkuKey(productId, variationId, colorId)) || 0;
  }
  let sum = 0;
  for (const [key, qty] of map) {
    const [pid, vid] = key.split("|");
    if (pid !== productId) continue;
    if (level === "product") {
      sum += qty;
      continue;
    }
    if ((vid || undefined) === (variationId || undefined)) {
      sum += qty;
    }
  }
  return sum;
}

function lastOutForLevel(
  map: Map<string, string>,
  productId: string,
  variationId: string | undefined,
  colorId: string | undefined,
  level: SkuLevel
): string | undefined {
  if (level === "matrix") {
    return map.get(stockSkuKey(productId, variationId, colorId));
  }
  let latest: string | undefined;
  for (const [key, date] of map) {
    const [pid, vid] = key.split("|");
    if (pid !== productId) continue;
    if (level === "variation" && (vid || undefined) !== (variationId || undefined)) {
      continue;
    }
    if (!latest || date > latest) latest = date;
  }
  return latest;
}

function daysSince(date: string | undefined, asOfMs: number): number | undefined {
  if (!date) return undefined;
  return Math.floor(
    (asOfMs - new Date(date + "T00:00:00").getTime()) / (24 * 60 * 60 * 1000)
  );
}

const OPEN_PO_STATUSES = new Set(["draft", "ordered", "partial"]);
const COMMITTED_ORDER_STATUSES = new Set(["estimate", "confirmed"]);

export type StockAlertsDb = {
  products: Product[];
  stockMovements?: StockMovement[];
  orders?: Order[];
  purchaseOrders?: PurchaseOrder[];
  settings?: AppSettings;
};

export type StockAlertsOpts = {
  deadDays?: number;
  slowDays?: number;
  parties?: { id: string }[];
  orders?: Order[];
  purchaseOrders?: PurchaseOrder[];
  settings?: AppSettings;
  asOf?: string;
};

type AlertSlot = {
  variationId?: string;
  colorId?: string;
  label: string;
  stock: number;
  stockSecondary: number;
  min: number;
  level: SkuLevel;
};

function incomingQtyBySku(purchaseOrders: PurchaseOrder[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const po of purchaseOrders ?? []) {
    if (!OPEN_PO_STATUSES.has(po.status)) continue;
    for (const line of po.lines) {
      if (!line.productId) continue;
      const rem = poLineRemaining(line);
      if (rem <= 0) continue;
      bumpQty(
        map,
        stockSkuKey(line.productId, line.variationId, line.colorId),
        rem
      );
    }
  }
  return map;
}

function committedQtyBySku(orders: Order[] | undefined): Map<string, number> {
  const map = new Map<string, number>();
  for (const order of orders ?? []) {
    if (!COMMITTED_ORDER_STATUSES.has(order.status)) continue;
    if (order.stockReserved === false) continue;
    if (order.actualBillAmount != null) continue;
    for (const line of order.lines) {
      bumpQty(
        map,
        stockSkuKey(line.productId, line.variationId, line.colorId),
        line.quantity
      );
    }
  }
  return map;
}

/** Same formula for stock-alerts UI, dashboard badge, cron, and owner digest. */
export function stockAlertsFromDb(
  db: StockAlertsDb,
  opts: StockAlertsOpts = {}
): StockAlertRow[] {
  return stockAlerts(db.products, db.stockMovements ?? [], {
    ...opts,
    orders: opts.orders ?? db.orders,
    purchaseOrders: opts.purchaseOrders ?? db.purchaseOrders,
    settings: opts.settings ?? db.settings,
  });
}

/** Reorder (cover/min net of incoming + committed) + slow/dead (SKU last OUT). */
export function stockAlerts(
  products: Product[],
  movements: StockMovement[],
  opts: StockAlertsOpts = {}
): StockAlertRow[] {
  const deadDays = opts.deadDays ?? 90;
  const slowDays = opts.slowDays ?? 45;
  const settings = opts.settings;
  const asOf = (opts.asOf || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const asOfMs = new Date(asOf + "T00:00:00").getTime();
  const useVelocity = settings?.autoReorderUseVelocity !== false;
  const lookbackDays = Math.max(
    1,
    Math.min(
      365,
      Math.round(settings?.autoReorderLookbackDays ?? REORDER_DEFAULTS.lookbackDays)
    )
  );
  const lookbackStart = addDaysIso(asOf, 1 - lookbackDays);

  const lastOut = new Map<string, string>();
  const outQty = new Map<string, number>();
  for (const m of movements) {
    if (!isDemandOutMovement(m)) continue;
    const day = m.date.slice(0, 10);
    const key = stockSkuKey(m.productId, m.variationId, m.colorId);
    const prev = lastOut.get(key);
    if (!prev || day > prev) lastOut.set(key, day);
    if (day >= lookbackStart && day <= asOf) {
      bumpQty(outQty, key, m.qty);
    }
  }

  const incoming = incomingQtyBySku(opts.purchaseOrders);
  const committed = committedQtyBySku(opts.orders);
  const rows: StockAlertRow[] = [];
  const reorderKeys = new Set<string>();

  const considerReorder = (
    p: Product,
    slot: AlertSlot
  ) => {
    const out = qtyForLevel(
      outQty,
      p.id,
      slot.variationId,
      slot.colorId,
      slot.level
    );
    const incomingQty = qtyForLevel(
      incoming,
      p.id,
      slot.variationId,
      slot.colorId,
      slot.level
    );
    const committedQty = qtyForLevel(
      committed,
      p.id,
      slot.variationId,
      slot.colorId,
      slot.level
    );
    const hadVelocity = out > 0;
    const suggestion = computeReorderSuggestion({
      onHand: slot.stock,
      staffMin: slot.min,
      reorderQty: p.reorderQty,
      avgDailyOut: out / lookbackDays,
      hadVelocity,
      coverDays: productCoverDays(p, settings),
      season: seasonMultiplier(p.category, asOf, settings),
      committed: committedQty,
      incoming: incomingQty,
      minOrderQty: p.minOrderQty,
      useVelocity,
    });
    if (suggestion.suggestedQty <= 0) return;
    const last = lastOutForLevel(
      lastOut,
      p.id,
      slot.variationId,
      slot.colorId,
      slot.level
    );
    const key = stockSkuKey(p.id, slot.variationId, slot.colorId);
    reorderKeys.add(key);
    rows.push({
      productId: p.id,
      variationId: slot.variationId,
      colorId: slot.colorId,
      label: slot.label,
      stock: slot.stock,
      stockSecondary: slot.stockSecondary,
      minStockLevel: slot.min,
      suggestedQty: suggestion.suggestedQty,
      preferredSupplierId: p.preferredSupplierId,
      lastOutDate: last,
      daysSinceOut: daysSince(last, asOfMs),
      kind: "reorder",
      avgDailyOut: suggestion.avgDailyOut,
      incomingQty: suggestion.incomingQty,
      committedQty: suggestion.committedQty,
      coverMode: suggestion.coverMode,
    });
  };

  const considerIdle = (
    p: Product,
    slot: AlertSlot
  ) => {
    if (slot.stock <= 0) return;
    const key = stockSkuKey(p.id, slot.variationId, slot.colorId);
    if (reorderKeys.has(key)) return;
    const last = lastOutForLevel(
      lastOut,
      p.id,
      slot.variationId,
      slot.colorId,
      slot.level
    );
    const days = daysSince(last, asOfMs);
    let kind: "dead" | "slow" | null = null;
    if (days == null || days >= deadDays) kind = "dead";
    else if (days >= slowDays) kind = "slow";
    if (!kind) return;
    rows.push({
      productId: p.id,
      variationId: slot.variationId,
      colorId: slot.colorId,
      label: slot.label,
      stock: slot.stock,
      stockSecondary: slot.stockSecondary,
      minStockLevel: slot.min,
      suggestedQty: 0,
      preferredSupplierId: p.preferredSupplierId,
      lastOutDate: last,
      daysSinceOut: days,
      kind,
    });
  };

  for (const p of products.filter((x) => x.active)) {
    const hasMatrix =
      !!p.colors.length &&
      !!p.variations.length &&
      !!p.minStockMatrix &&
      Object.keys(p.minStockMatrix).length > 0;
    const hasColorStock =
      !!p.colors.length &&
      !!p.variations.length &&
      !!p.stockMatrix &&
      Object.keys(p.stockMatrix).length > 0;

    const reorderSlots: AlertSlot[] = [];
    if (hasMatrix && p.stockMatrix) {
      for (const v of p.variations) {
        for (const c of p.colors) {
          const matrixKey = stockMatrixKey(v.id, c.id);
          reorderSlots.push({
            variationId: v.id,
            colorId: c.id,
            label: `${p.name.en} · ${v.size?.en || v.label.en} · ${c.name.en}`,
            stock: Math.max(0, p.stockMatrix[matrixKey] || 0),
            stockSecondary: 0,
            min: p.minStockMatrix![matrixKey] ?? 0,
            level: "matrix",
          });
        }
      }
    } else if (p.variations.some((v) => (v.minStockLevel ?? 0) > 0)) {
      for (const v of p.variations) {
        reorderSlots.push({
          variationId: v.id,
          label: `${p.name.en} · ${v.size?.en || v.label.en}`,
          stock: v.stock || 0,
          stockSecondary: v.stockSecondary ?? 0,
          min: v.minStockLevel ?? 0,
          level: "variation",
        });
      }
    } else {
      reorderSlots.push({
        label: p.name.en,
        stock: p.stock || 0,
        stockSecondary: p.stockSecondary ?? 0,
        min: p.minStockLevel ?? 0,
        level: "product",
      });
    }

    for (const slot of reorderSlots) considerReorder(p, slot);

    const idleSlots: AlertSlot[] =
      hasColorStock && p.stockMatrix
        ? p.variations.flatMap((v) =>
            p.colors.map((c) => {
              const matrixKey = stockMatrixKey(v.id, c.id);
              return {
                variationId: v.id,
                colorId: c.id,
                label: `${p.name.en} · ${v.size?.en || v.label.en} · ${c.name.en}`,
                stock: Math.max(0, p.stockMatrix![matrixKey] || 0),
                stockSecondary: 0,
                min: p.minStockMatrix?.[matrixKey] ?? p.minStockLevel ?? 0,
                level: "matrix" as const,
              };
            })
          )
        : p.variations.length
          ? p.variations.map((v) => ({
              variationId: v.id,
              label: `${p.name.en} · ${v.size?.en || v.label.en}`,
              stock: v.stock || 0,
              stockSecondary: v.stockSecondary ?? 0,
              min: v.minStockLevel ?? p.minStockLevel ?? 0,
              level: "variation" as const,
            }))
          : [
              {
                label: p.name.en,
                stock: p.stock || 0,
                stockSecondary: p.stockSecondary ?? 0,
                min: p.minStockLevel ?? 0,
                level: "product" as const,
              },
            ];

    for (const slot of idleSlots) considerIdle(p, slot);
  }

  const order = { reorder: 0, dead: 1, slow: 2 };
  return rows.sort(
    (a, b) =>
      order[a.kind] - order[b.kind] || a.label.localeCompare(b.label)
  );
}

export type CashFlowSection = {
  label: string;
  rows: { label: string; amount: number }[];
  total: number;
};

/** Simple cash-flow from cash+bank ledger movements in period. */
export function cashFlowStatement(
  accounts: Account[],
  entries: LedgerEntry[],
  vouchers: Voucher[],
  from: string,
  to: string
): {
  opening: number;
  closing: number;
  operating: CashFlowSection;
  investing: CashFlowSection;
  financing: CashFlowSection;
  netChange: number;
} {
  const cashIds = new Set<string>([ACCT.cash, ACCT.bank]);
  const cash = accounts.find((a) => a.id === ACCT.cash);
  const bank = accounts.find((a) => a.id === ACCT.bank);
  const dayBefore = (() => {
    const d = new Date(from.slice(0, 10) + "T00:00:00");
    d.setDate(d.getDate() - 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  })();

  const opening = roundMoney(
    (cash ? accountBalance(cash, entries, dayBefore) : 0) +
      (bank ? accountBalance(bank, entries, dayBefore) : 0)
  );
  const closing = roundMoney(
    (cash ? accountBalance(cash, entries, to) : 0) +
      (bank ? accountBalance(bank, entries, to) : 0)
  );

  const vById = new Map(vouchers.map((v) => [v.id, v]));
  let receipts = 0;
  let supplierPay = 0;
  let expenses = 0;
  let otherIn = 0;
  let otherOut = 0;
  let capitalIn = 0;
  let capitalOut = 0;

  for (const e of entries) {
    if (e.voided || !cashIds.has(e.accountId)) continue;
    if (!inRange(e.date, from, to)) continue;
    const net = roundMoney(e.debit - e.credit); // + into cash
    const v = vById.get(e.voucherId);
    if (!v) {
      if (net > 0) otherIn += net;
      else otherOut += Math.abs(net);
      continue;
    }
    if (v.type === "receipt") receipts += net > 0 ? net : 0;
    else if (v.type === "payment") {
      if (v.lines[0]?.accountId && v.lines[0].accountId !== ACCT.creditors) {
        expenses += Math.abs(net);
      } else {
        supplierPay += Math.abs(net);
      }
    } else if (v.type === "journal") {
      // Classify vs capital
      const touchesCapital = v.lines.some((l) => l.accountId === ACCT.capital);
      if (touchesCapital) {
        if (net > 0) capitalIn += net;
        else capitalOut += Math.abs(net);
      } else if (net > 0) otherIn += net;
      else otherOut += Math.abs(net);
    } else if (net > 0) otherIn += net;
    else otherOut += Math.abs(net);
  }

  const operatingRows = [
    { label: "Receipts from customers", amount: roundMoney(receipts) },
    { label: "Paid to suppliers", amount: roundMoney(-supplierPay) },
    { label: "Operating expenses", amount: roundMoney(-expenses) },
    { label: "Other operating", amount: roundMoney(otherIn - otherOut) },
  ];
  const financingRows = [
    { label: "Capital / owner in", amount: roundMoney(capitalIn) },
    { label: "Capital / owner out", amount: roundMoney(-capitalOut) },
  ];

  const sum = (rows: { amount: number }[]) =>
    roundMoney(rows.reduce((s, r) => s + r.amount, 0));

  const operating: CashFlowSection = {
    label: "Operating",
    rows: operatingRows,
    total: sum(operatingRows),
  };
  const investing: CashFlowSection = {
    label: "Investing",
    rows: [{ label: "—", amount: 0 }],
    total: 0,
  };
  const financing: CashFlowSection = {
    label: "Financing",
    rows: financingRows,
    total: sum(financingRows),
  };

  return {
    opening,
    closing,
    operating,
    investing,
    financing,
    netChange: roundMoney(closing - opening),
  };
}

/** Filter stock movements. */
export function filterStockMovements(
  movements: StockMovement[],
  opts: {
    from?: string;
    to?: string;
    productId?: string;
    type?: string;
    direction?: "in" | "out" | "";
    q?: string;
  }
): StockMovement[] {
  const from = opts.from?.slice(0, 10);
  const to = opts.to?.slice(0, 10);
  const q = opts.q?.trim().toLowerCase();
  return movements.filter((m) => {
    if (from && m.date.slice(0, 10) < from) return false;
    if (to && m.date.slice(0, 10) > to) return false;
    if (opts.productId && m.productId !== opts.productId) return false;
    if (opts.type && m.type !== opts.type) return false;
    if (opts.direction && m.direction !== opts.direction) return false;
    if (q && !(m.note || "").toLowerCase().includes(q) && !m.type.includes(q)) {
      return false;
    }
    return true;
  });
}
