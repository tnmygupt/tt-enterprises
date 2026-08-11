import type {
  BatchConsumption,
  CategoryDef,
  LedgerEntry,
  Party,
  Product,
  StockMovement,
  Voucher,
} from "../types";
import { stockMatrixKey } from "../inventory";
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
  /** Bundles to order to reach reorderQty or min */
  suggestedQty: number;
  preferredSupplierId?: string;
  lastOutDate?: string;
  daysSinceOut?: number;
  kind: "reorder" | "dead" | "slow";
};

function daysSince(date: string | undefined, todayMs: number): number | undefined {
  if (!date) return undefined;
  return Math.floor(
    (todayMs - new Date(date + "T00:00:00").getTime()) / (24 * 60 * 60 * 1000)
  );
}

/** Reorder (below min at product / size / color) + slow/dead (no outward movement). */
export function stockAlerts(
  products: Product[],
  movements: StockMovement[],
  opts: {
    deadDays?: number;
    slowDays?: number;
    parties?: { id: string }[];
  } = {}
): StockAlertRow[] {
  const deadDays = opts.deadDays ?? 90;
  const slowDays = opts.slowDays ?? 45;
  const today = new Date();
  const todayMs = today.getTime();

  const lastOut = new Map<string, string>();
  for (const m of movements) {
    if (m.direction !== "out") continue;
    const prev = lastOut.get(m.productId);
    if (!prev || m.date > prev) lastOut.set(m.productId, m.date.slice(0, 10));
  }

  const rows: StockAlertRow[] = [];

  for (const p of products.filter((x) => x.active)) {
    const last = lastOut.get(p.id);
    const days = daysSince(last, todayMs);
    const preferred = p.preferredSupplierId;
    const targetFill = p.reorderQty;

    const pushReorder = (
      label: string,
      stock: number,
      stockSecondary: number,
      min: number,
      variationId?: string,
      colorId?: string
    ) => {
      if (!(min > 0 && stock <= min)) return;
      const fillTo = targetFill != null && targetFill > min ? targetFill : min;
      rows.push({
        productId: p.id,
        variationId,
        colorId,
        label,
        stock,
        stockSecondary,
        minStockLevel: min,
        suggestedQty: Math.max(0, Math.ceil(fillTo - stock)),
        preferredSupplierId: preferred,
        lastOutDate: last,
        daysSinceOut: days,
        kind: "reorder",
      });
    };

    const hasMatrix =
      !!p.colors.length &&
      !!p.variations.length &&
      !!p.minStockMatrix &&
      Object.keys(p.minStockMatrix).length > 0;

    if (hasMatrix && p.stockMatrix) {
      for (const v of p.variations) {
        for (const c of p.colors) {
          const key = stockMatrixKey(v.id, c.id);
          const min = p.minStockMatrix![key] ?? 0;
          if (min <= 0) continue;
          const stock = Math.max(0, p.stockMatrix[key] || 0);
          pushReorder(
            `${p.name.en} · ${v.size?.en || v.label.en} · ${c.name.en}`,
            stock,
            0,
            min,
            v.id,
            c.id
          );
        }
      }
    } else if (p.variations.some((v) => (v.minStockLevel ?? 0) > 0)) {
      for (const v of p.variations) {
        const min = v.minStockLevel ?? 0;
        if (min <= 0) continue;
        pushReorder(
          `${p.name.en} · ${v.size?.en || v.label.en}`,
          v.stock || 0,
          v.stockSecondary ?? 0,
          min,
          v.id
        );
      }
    } else {
      const min = p.minStockLevel ?? 0;
      pushReorder(p.name.en, p.stock || 0, p.stockSecondary ?? 0, min);
    }

    // Slow / dead only at product level (avoid noise per color)
    const alreadyReorder = rows.some(
      (r) => r.productId === p.id && r.kind === "reorder"
    );
    if (alreadyReorder) continue;
    const stock = p.stock || 0;
    const min = p.minStockLevel ?? 0;
    if (stock > 0 && (days == null || days >= deadDays)) {
      rows.push({
        productId: p.id,
        label: p.name.en,
        stock,
        stockSecondary: p.stockSecondary ?? 0,
        minStockLevel: min,
        suggestedQty: 0,
        preferredSupplierId: preferred,
        lastOutDate: last,
        daysSinceOut: days,
        kind: "dead",
      });
    } else if (stock > 0 && days != null && days >= slowDays) {
      rows.push({
        productId: p.id,
        label: p.name.en,
        stock,
        stockSecondary: p.stockSecondary ?? 0,
        minStockLevel: min,
        suggestedQty: 0,
        preferredSupplierId: preferred,
        lastOutDate: last,
        daysSinceOut: days,
        kind: "slow",
      });
    }
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
