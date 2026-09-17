import { accountBalance, ACCT, bankBookAccounts } from "@/lib/accounting";
import { inventoryRows } from "@/lib/inventory";
import { roundMoney } from "@/lib/pricing";
import type {
  Account,
  CashCount,
  LedgerEntry,
  MonthlyAudit,
  Product,
  StockCount,
  StockCountLine,
  StockCountStatus,
  UserProfile,
  UserRole,
} from "@/lib/types";
import { userHasCapability, type CapabilityContext } from "@/lib/capabilities";

export type CountCollections = {
  stockCounts?: StockCount[];
  cashCounts?: CashCount[];
  monthlyAudits?: MonthlyAudit[];
};

export function ensureCountCollections<T extends CountCollections>(db: T): T {
  if (!Array.isArray(db.stockCounts)) db.stockCounts = [];
  if (!Array.isArray(db.cashCounts)) db.cashCounts = [];
  if (!Array.isArray(db.monthlyAudits)) db.monthlyAudits = [];
  return db;
}

export function canEnterPhysicalCount(
  actor:
    | Pick<
        UserProfile,
        "role" | "extraCapabilities" | "deniedCapabilities" | "jobId"
      >
    | null
    | undefined,
  ctx?: CapabilityContext | null
): boolean {
  if (!actor) return false;
  const role = actor.role as UserRole;
  if (role === "customer" || role === "viewer") return false;
  if (
    role === "super_admin" ||
    role === "accounts" ||
    role === "dispatch" ||
    role === "plant_manager"
  ) {
    return true;
  }
  return (
    userHasCapability(actor, "manage_accounts", ctx) ||
    userHasCapability(actor, "manage_reorder", ctx)
  );
}

export function lineVariance(line: StockCountLine): number {
  if (line.countedQty == null || !Number.isFinite(line.countedQty)) return 0;
  return roundMoney(line.countedQty - (Number(line.bookQty) || 0));
}

export function isShortage(line: StockCountLine): boolean {
  return lineVariance(line) < 0;
}

export function isUncountedLine(line: StockCountLine): boolean {
  return !line.counted && (Number(line.bookQty) || 0) > 0;
}

export function isSurplus(line: StockCountLine): boolean {
  return line.counted === true && lineVariance(line) > 0;
}

export function uncountedLines(session: StockCount): StockCountLine[] {
  return (session.lines ?? []).filter(isUncountedLine);
}

export function surplusLines(session: StockCount): StockCountLine[] {
  return (session.lines ?? [])
    .filter(isSurplus)
    .sort((a, b) => lineVariance(b) - lineVariance(a));
}

export function shortageQty(line: StockCountLine): number {
  return Math.max(0, -lineVariance(line));
}

export function shortageValue(line: StockCountLine): number {
  const rate = Math.max(0, Number(line.unitRate) || 0);
  return roundMoney(shortageQty(line) * rate);
}

export function stripStockCountRates(
  counts: StockCount[] | undefined
): StockCount[] {
  return (counts ?? []).map((c) => ({
    ...c,
    lines: (c.lines ?? []).map((l) => {
      const next = { ...l };
      delete next.unitRate;
      return next;
    }),
  }));
}

export function restoreStockCountRates(
  incoming: StockCount[] | undefined,
  cloud: StockCount[] | undefined
): StockCount[] {
  const cloudById = new Map((cloud ?? []).map((c) => [c.id, c]));
  return (incoming ?? []).map((c) => {
    const prev = cloudById.get(c.id);
    if (!prev) return c;
    const prevLines = new Map((prev.lines ?? []).map((l) => [l.id, l]));
    return {
      ...c,
      lines: (c.lines ?? []).map((l) => {
        const old = prevLines.get(l.id);
        if (!old) return l;
        return {
          ...l,
          unitRate: l.unitRate ?? old.unitRate,
          ownerDecision: l.ownerDecision ?? old.ownerDecision,
          rejectReason: l.rejectReason ?? old.rejectReason,
          postedMovementId: l.postedMovementId ?? old.postedMovementId,
          bookQty: old.bookQty,
        };
      }),
    };
  });
}

/** Staff cannot change frozen book qty or owner decisions. */
export function mergeStockCountsForStaff(
  incoming: StockCount[] | undefined,
  cloud: StockCount[] | undefined,
  canOwnerReview: boolean
): StockCount[] {
  const cloudById = new Map((cloud ?? []).map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: StockCount[] = [];
  for (const row of incoming ?? []) {
    if (!row?.id) continue;
    seen.add(row.id);
    const prev = cloudById.get(row.id);
    if (!prev) {
      if (row.status === "owner_reviewed" && !canOwnerReview) {
        out.push({ ...row, status: "draft" });
      } else {
        out.push(row);
      }
      continue;
    }
    const prevLines = new Map((prev.lines ?? []).map((l) => [l.id, l]));
    const lines = (row.lines ?? []).map((l) => {
      const old = prevLines.get(l.id);
      if (!old) {
        return {
          ...l,
          bookQty: Number(l.bookQty) || 0,
          ownerDecision: canOwnerReview ? l.ownerDecision : "pending",
          postedMovementId: canOwnerReview ? l.postedMovementId : undefined,
        };
      }
      return {
        ...l,
        bookQty: old.bookQty,
        unitRate: canOwnerReview ? l.unitRate ?? old.unitRate : old.unitRate,
        ownerDecision: canOwnerReview
          ? l.ownerDecision ?? old.ownerDecision
          : old.ownerDecision,
        rejectReason: canOwnerReview
          ? l.rejectReason ?? old.rejectReason
          : old.rejectReason,
        postedMovementId: canOwnerReview
          ? l.postedMovementId ?? old.postedMovementId
          : old.postedMovementId,
      };
    });
    let status: StockCountStatus = row.status || prev.status;
    if (!canOwnerReview) {
      if (prev.status === "owner_reviewed") status = prev.status;
      else if (status === "owner_reviewed") status = prev.status;
    }
    out.push({
      ...row,
      startedBy: prev.startedBy,
      startedAt: prev.startedAt,
      lines,
      status,
    });
  }
  for (const prev of cloud ?? []) {
    if (!seen.has(prev.id)) out.push(prev);
  }
  return out;
}

export function mergeCashCountsForStaff(
  incoming: CashCount[] | undefined,
  cloud: CashCount[] | undefined,
  canOwnerReview: boolean
): CashCount[] {
  const cloudById = new Map((cloud ?? []).map((c) => [c.id, c]));
  const seen = new Set<string>();
  const out: CashCount[] = [];
  for (const row of incoming ?? []) {
    if (!row?.id) continue;
    seen.add(row.id);
    const prev = cloudById.get(row.id);
    if (!prev) {
      out.push(
        !canOwnerReview && row.status === "owner_reviewed"
          ? { ...row, status: "draft", ownerDecision: "pending" }
          : row
      );
      continue;
    }
    out.push({
      ...row,
      bookCash: prev.bookCash,
      bookBank: prev.bookBank,
      startedBy: prev.startedBy,
      startedAt: prev.startedAt,
      status: canOwnerReview
        ? row.status
        : prev.status === "owner_reviewed"
          ? prev.status
          : row.status === "owner_reviewed"
            ? prev.status
            : row.status,
      ownerDecision: canOwnerReview ? row.ownerDecision : prev.ownerDecision,
      rejectReason: canOwnerReview ? row.rejectReason : prev.rejectReason,
    });
  }
  for (const prev of cloud ?? []) {
    if (!seen.has(prev.id)) out.push(prev);
  }
  return out;
}

function lastKnownRate(product: Product | undefined): number {
  if (!product) return 0;
    const fromVar = product.variations
    ?.map((v) => Number(v.rate) || 0)
    .find((n) => n > 0);
  return fromVar || Number(product.baseRate) || 0;
}

export function freezeStockCountLines(products: Product[]): StockCountLine[] {
  const rows = inventoryRows({ products, stockMovements: [] });
  const byId = new Map(products.map((p) => [p.id, p]));
  return rows.map((r) => {
    const product = byId.get(r.productId);
    return {
      id: `scl_${r.productId}_${r.variationId || ""}_${r.colorId || ""}`,
      productId: r.productId,
      variationId: r.variationId,
      colorId: r.colorId,
      sku: r.sku,
      label: r.name,
      category: product?.category,
      bookQty: r.stock,
      counted: false,
      unitRate: lastKnownRate(product),
      ownerDecision: "pending",
    };
  });
}

export function startStockCountSession(input: {
  month: string;
  startedBy: string;
  products: Product[];
}): StockCount {
  const now = new Date().toISOString();
  return {
    id: `sc_${crypto.randomUUID()}`,
    month: input.month,
    status: "draft",
    startedBy: input.startedBy,
    startedAt: now,
    lines: freezeStockCountLines(input.products),
    updatedAt: now,
  };
}

export function startCashCountSession(input: {
  month: string;
  startedBy: string;
  accounts: Account[];
  ledgerEntries: LedgerEntry[];
}): CashCount {
  const now = new Date().toISOString();
  const last = daysInMonthSafe(input.month);
  const date = `${input.month}-${String(last).padStart(2, "0")}`;
    const cash = input.accounts.find((a) => a.id === ACCT.cash);
  return {
    id: `cc_${crypto.randomUUID()}`,
    month: input.month,
    status: "draft",
    startedBy: input.startedBy,
    startedAt: now,
    bookCash: cash ? accountBalance(cash, input.ledgerEntries, date) : 0,
    bookBank: bankBookAccounts(input.accounts).reduce(
      (sum, a) => sum + accountBalance(a, input.ledgerEntries, date),
      0
    ),
    ownerDecision: "pending",
    updatedAt: now,
  };
}

function daysInMonthSafe(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function cashMismatch(count: CashCount): {
  cashDiff: number;
  bankDiff: number;
} {
  const cashDiff = roundMoney(
    (Number(count.countedCash) || 0) - (Number(count.bookCash) || 0)
  );
  const bankDiff = roundMoney(
    (Number(count.statementBank) || 0) - (Number(count.bookBank) || 0)
  );
  return { cashDiff, bankDiff };
}

export function setCountedQty(
  session: StockCount,
  lineId: string,
  qty: number
): StockCount {
  if (session.status !== "draft") return session;
  return {
    ...session,
    updatedAt: new Date().toISOString(),
    lines: session.lines.map((l) =>
      l.id === lineId
        ? { ...l, countedQty: qty, counted: true, bookQty: l.bookQty }
        : l
    ),
  };
}

export const SHORTAGE_QTY_FLAG = 1;
export const SHORTAGE_VALUE_FLAG = 500;

export function ownerExceptionLines(session: StockCount): StockCountLine[] {
  return session.lines
    .filter((l) => {
      const v = lineVariance(l);
      const value = shortageValue(l);
      const zeroWhileBook =
        l.counted === true && (l.countedQty || 0) === 0 && l.bookQty > 0;
      const uncounted = !l.counted && l.bookQty > 0;
      return (
        (v < 0 &&
          (shortageQty(l) >= SHORTAGE_QTY_FLAG ||
            value >= SHORTAGE_VALUE_FLAG ||
            zeroWhileBook)) ||
        uncounted ||
        zeroWhileBook ||
        isSurplus(l)
      );
    })
    .sort((a, b) => shortageValue(b) - shortageValue(a) || lineVariance(a) - lineVariance(b));
}

export type CountAdjust = {
  productId: string;
  variationId?: string;
  colorId?: string;
  direction: "in" | "out";
  qty: number;
  note: string;
  createdBy: string;
  lineId: string;
};

export function adjustmentsFromApprovedLines(
  session: StockCount,
  lineIds: string[],
  createdBy: string
): CountAdjust[] {
  const want = new Set(lineIds);
  const note = `Month count ${session.month}`;
  const out: CountAdjust[] = [];
  for (const line of session.lines) {
    if (!want.has(line.id)) continue;
    if (line.postedMovementId) continue;
    if (line.ownerDecision === "rejected") continue;
    const v = lineVariance(line);
    if (!v) continue;
    out.push({
      productId: line.productId,
      variationId: line.variationId,
      colorId: line.colorId,
      direction: v > 0 ? "in" : "out",
      qty: Math.abs(v),
      note,
      createdBy,
      lineId: line.id,
    });
  }
  return out;
}
