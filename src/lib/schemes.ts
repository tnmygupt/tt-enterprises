import type {
  Locale,
  OrderLine,
  Product,
  Scheme,
  SchemeLevel,
  SchemeProgressUnit,
} from "./types";

export function isSchemeActiveNow(scheme: Scheme, at = new Date()): boolean {
  if (!scheme.active) return false;
  const t = at.getTime();
  const start = new Date(scheme.startDate).getTime();
  const end = new Date(scheme.endDate).getTime();
  return t >= start && t <= end;
}

/** Scheme period finished — payout may be settled. */
export function isSchemeEnded(scheme: Scheme, at = new Date()): boolean {
  return at.getTime() > new Date(scheme.endDate).getTime();
}

/** Days remaining until end (can be negative if already ended). */
export function daysUntilSchemeEnd(scheme: Scheme, at = new Date()): number {
  return Math.ceil(
    (new Date(scheme.endDate).getTime() - at.getTime()) / (1000 * 60 * 60 * 24)
  );
}

export const SCHEME_ENDING_SOON_DAYS = 7;

/** Live schemes only — ended schemes are hidden from dealers. */
export function isSchemeVisibleToDealer(
  scheme: Scheme,
  at = new Date()
): boolean {
  return isSchemeActiveNow(scheme, at);
}

/** Live and ending within the next N days (default 7). */
export function isSchemeEndingSoon(
  scheme: Scheme,
  at = new Date(),
  withinDays = SCHEME_ENDING_SOON_DAYS
): boolean {
  if (!isSchemeActiveNow(scheme, at)) return false;
  const days = daysUntilSchemeEnd(scheme, at);
  return days >= 0 && days <= withinDays;
}

export function dealerHasScheme(
  scheme: Scheme,
  assignedSchemeIds?: string[] | null
): boolean {
  if (scheme.appliesToAllDealers) return true;
  return (assignedSchemeIds ?? []).includes(scheme.id);
}

export function schemeMatchesProduct(
  scheme: Scheme,
  product: Pick<Product, "id" | "category">
): boolean {
  if (scheme.scopeType === "all") return true;
  if (scheme.scopeType === "category") {
    return product.category === scheme.scopeCategory;
  }
  return scheme.scopeProductIds.includes(product.id);
}

export function schemeProgressUnit(scheme: Scheme): SchemeProgressUnit {
  return scheme.progressUnit === "bundles" ? "bundles" : "kg";
}

export function schemeUnitLabel(scheme: Scheme, locale: Locale): string {
  if (schemeProgressUnit(scheme) === "bundles") {
    return locale === "hi" ? "बंडल" : "bundles";
  }
  return locale === "hi" ? "किग्रा" : "kg";
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/** ₹/unit for a tier (highest-tier rate applies to full lift). */
export function schemeTierRate(scheme: Scheme, level: SchemeLevel): number {
  if (scheme.rewardType === "percent" || scheme.rewardType === "order_percent") {
    return schemeTierPercent(scheme, level);
  }
  if (level.ratePerUnit != null && level.ratePerUnit > 0) {
    return level.ratePerUnit;
  }
  if (scheme.rewardType === "order_flat") {
    return 0;
  }
  if (scheme.discountPerKg > 0) return scheme.discountPerKg;
  // Legacy fixed-credit levels → implied ₹/unit for migration display
  if ((level.creditAmount || 0) > 0 && (level.targetAmount || 0) > 0) {
    return roundMoney((level.creditAmount || 0) / level.targetAmount);
  }
  if (
    scheme.rewardType === "fixed_credit" &&
    scheme.creditAmount > 0 &&
    scheme.targetWeightKg > 0
  ) {
    return roundMoney(scheme.creditAmount / scheme.targetWeightKg);
  }
  return 0;
}

/** % rate for a percent scheme tier (e.g. 2 = 2%). */
export function schemeTierPercent(scheme: Scheme, level: SchemeLevel): number {
  if (level.ratePerUnit != null && level.ratePerUnit > 0) {
    return level.ratePerUnit;
  }
  if ((scheme.discountPercent ?? 0) > 0) return scheme.discountPercent ?? 0;
  return 0;
}

export function isPercentScheme(scheme: Scheme): boolean {
  return scheme.rewardType === "percent";
}

/** Bill discount on this order (not wallet lifting). */
export function isOrderDiscountScheme(scheme: Scheme): boolean {
  return (
    scheme.rewardType === "order_percent" || scheme.rewardType === "order_flat"
  );
}

/**
 * Levels / tiers for a scheme (sorted by target ascending).
 * Legacy single-target schemes become one tier.
 */
export function getSchemeLevels(scheme: Scheme): SchemeLevel[] {
  if (scheme.levels && scheme.levels.length > 0) {
    return [...scheme.levels]
      .map((l) => ({
        ...l,
        ratePerUnit: schemeTierRate(scheme, l),
        creditAmount: l.creditAmount ?? 0,
      }))
      .sort((a, b) => (a.targetAmount || 0) - (b.targetAmount || 0));
  }
  const target = scheme.targetWeightKg || 0;
  const rate =
    isPercentScheme(scheme) || scheme.rewardType === "order_percent"
      ? scheme.discountPercent ?? 0
      : scheme.rewardType === "order_flat"
        ? scheme.discountPerKg || 0
        : scheme.discountPerKg > 0
          ? scheme.discountPerKg
          : target > 0 && scheme.creditAmount > 0
            ? roundMoney(scheme.creditAmount / target)
            : 0;
  return [
    {
      id: `${scheme.id}_tier1`,
      name: { en: "Tier 1", hi: "टियर 1" },
      targetAmount: target,
      ratePerUnit: rate,
      creditAmount: 0,
    },
  ];
}

export function schemeLevelLabel(level: SchemeLevel, locale: Locale): string {
  return level.name?.[locale] || level.name?.en || "Tier";
}

/** Highest tier unlocked by current progress (rate applies to full lift). */
export function getAchievedTier(
  scheme: Scheme,
  progress: number
): SchemeLevel | null {
  let achieved: SchemeLevel | null = null;
  for (const level of getSchemeLevels(scheme)) {
    if (progress + 1e-9 >= (level.targetAmount || 0) && level.targetAmount > 0) {
      achieved = level;
    }
  }
  return achieved;
}

/**
 * Final / estimated payout.
 * - per_kg_rate: full lift × highest unlocked tier ₹/unit
 * - percent: scoped sales ₹ × highest unlocked tier %
 */
export function estimateSchemePayout(
  scheme: Scheme,
  progress: number,
  salesValue = 0
): number {
  // Per-order discounts apply on the bill — never wallet settlement
  if (isOrderDiscountScheme(scheme)) return 0;
  const actual = Math.max(0, progress);
  const tier = getAchievedTier(scheme, actual);
  if (!tier || !(actual > 0)) return 0;
  if (isPercentScheme(scheme)) {
    const pct = schemeTierPercent(scheme, tier);
    if (!(pct > 0) || !(salesValue > 0)) return 0;
    return roundMoney((salesValue * pct) / 100);
  }
  const rate = schemeTierRate(scheme, tier);
  if (!(rate > 0)) return 0;
  return roundMoney(actual * rate);
}

/**
 * This-order qty for order-discount schemes (estimate kg when actual unset).
 */
export function orderQtyForScheme(
  scheme: Scheme,
  lines: OrderLine[],
  products: Product[]
): number {
  const unit = schemeProgressUnit(scheme);
  return lines.reduce((sum, line) => {
    const product = products.find((p) => p.id === line.productId);
    if (!product) return sum;
    if (!schemeMatchesProduct(scheme, product)) return sum;
    const qty = Number(line.quantity) || 0;
    const kg =
      line.actualWeightKg != null && line.actualWeightKg > 0
        ? line.actualWeightKg
        : line.estimatedWeightKg != null && line.estimatedWeightKg > 0
          ? line.estimatedWeightKg
          : Number(line.weightKg) || 0;
    if (product.unit === "jhal" || line.unit === "jhal") {
      return sum + (unit === "bundles" ? qty : kg);
    }
    return sum + (unit === "bundles" ? qty : kg);
  }, 0);
}

/** Scoped goods ₹ for % off / discount cap (uses current lineTotal). */
export function orderScopedSubtotal(
  scheme: Scheme,
  lines: OrderLine[],
  products: Product[]
): number {
  return roundMoney(
    lines.reduce((sum, line) => {
      const product = products.find((p) => p.id === line.productId);
      if (!product) return sum;
      if (!schemeMatchesProduct(scheme, product)) return sum;
      return sum + (Number(line.lineTotal) || 0);
    }, 0)
  );
}

export type OrderDiscountResult = {
  amount: number;
  tier: SchemeLevel | null;
  scheme: Scheme;
};

/** Highest this-order tier → % of scoped subtotal or flat ₹ (capped). */
export function resolveOrderDiscount(
  scheme: Scheme,
  lines: OrderLine[],
  products: Product[]
): { amount: number; tier: SchemeLevel | null } {
  if (!isOrderDiscountScheme(scheme)) return { amount: 0, tier: null };
  const qty = orderQtyForScheme(scheme, lines, products);
  const tier = getAchievedTier(scheme, qty);
  if (!tier) return { amount: 0, tier: null };
  const scoped = orderScopedSubtotal(scheme, lines, products);
  if (!(scoped > 0)) return { amount: 0, tier };
  let raw = 0;
  if (scheme.rewardType === "order_percent") {
    const pct = schemeTierPercent(scheme, tier);
    if (!(pct > 0)) return { amount: 0, tier };
    raw = (scoped * pct) / 100;
  } else {
    const flat = schemeTierRate(scheme, tier);
    if (!(flat > 0)) return { amount: 0, tier };
    raw = flat;
  }
  return { amount: roundMoney(Math.min(raw, scoped)), tier };
}

/**
 * Among eligible active order-discount schemes, pick largest discount.
 */
export function pickBestOrderDiscount(
  schemes: Scheme[],
  assignedSchemeIds: string[] | null | undefined,
  lines: OrderLine[],
  products: Product[],
  at = new Date()
): OrderDiscountResult | null {
  let best: OrderDiscountResult | null = null;
  for (const scheme of schemes) {
    if (!isOrderDiscountScheme(scheme)) continue;
    if (!isSchemeActiveNow(scheme, at)) continue;
    if (!dealerHasScheme(scheme, assignedSchemeIds)) continue;
    const { amount, tier } = resolveOrderDiscount(scheme, lines, products);
    if (!(amount > 0)) continue;
    if (!best || amount > best.amount) {
      best = { amount, tier, scheme };
    }
  }
  return best;
}

/**
 * Billed ₹ from scheme-scoped lines (actual billed only).
 * Uses lineTotal scaled by actual/estimated weight when weight-priced.
 */
export function valueForScheme(
  scheme: Scheme,
  lines: OrderLine[],
  products: Product[]
): number {
  return lines.reduce((sum, line) => {
    const product = products.find((p) => p.id === line.productId);
    if (!product) return sum;
    if (!schemeMatchesProduct(scheme, product)) return sum;
    if (line.actualWeightKg == null || !(line.actualWeightKg > 0)) return sum;
    const qty = Number(line.quantity) || 0;
    const rate = Number(line.rate) || 0;
    const pricingMode = line.pricingMode || product.pricingMode || "bundle";
    let amount = 0;
    if (pricingMode === "pcs") {
      amount = rate * qty;
    } else {
      amount = rate * line.actualWeightKg;
    }
    // Prefer stored lineTotal when actual weight matches estimate
    if (
      line.lineTotal > 0 &&
      line.estimatedWeightKg != null &&
      Math.abs(line.actualWeightKg - line.estimatedWeightKg) < 0.01
    ) {
      amount = line.lineTotal;
    }
    return sum + amount;
  }, 0);
}

/**
 * Progress toward scheme target from an order's lines.
 * Only actual billed weight counts (estimate never applies).
 */
export function progressForScheme(
  scheme: Scheme,
  lines: OrderLine[],
  products: Product[]
): number {
  const unit = schemeProgressUnit(scheme);
  return lines.reduce((sum, line) => {
    const product = products.find((p) => p.id === line.productId);
    if (!product) return sum;
    if (!schemeMatchesProduct(scheme, product)) return sum;
    if (line.actualWeightKg == null || !(line.actualWeightKg > 0)) return sum;
    // Jhal: bill is rate×kg; kg schemes use weighment; bundle schemes use jhal count
    if (product.unit === "jhal" || line.unit === "jhal") {
      return sum + (unit === "bundles" ? Number(line.quantity) || 0 : line.actualWeightKg);
    }
    return sum + (unit === "bundles" ? line.quantity : line.actualWeightKg);
  }, 0);
}

export type SchemeOrderContribution = {
  orderId: string;
  orderNumber: string;
  at: string;
  amount: number;
  cancelled: boolean;
  creditAmount: number;
};

export function listSchemeContributions(
  scheme: Scheme,
  orders: {
    id: string;
    orderNumber: string;
    userId: string;
    status: string;
    lines: OrderLine[];
    billUploadedAt?: string;
    updatedAt: string;
    createdAt: string;
  }[],
  products: Product[],
  userId: string,
  walletTxs?: {
    orderId?: string;
    schemeId?: string;
    userId: string;
    type: "credit" | "debit";
    amount: number;
  }[]
): SchemeOrderContribution[] {
  const rows: SchemeOrderContribution[] = [];
  for (const order of orders) {
    if (order.userId !== userId) continue;
    const amount = progressForScheme(scheme, order.lines, products);
    if (!(amount > 0)) continue;
    const related = (walletTxs || []).filter(
      (t) =>
        t.orderId === order.id &&
        t.schemeId === scheme.id &&
        t.userId === userId
    );
    const credit = related
      .filter((t) => t.type === "credit")
      .reduce((s, t) => s + t.amount, 0);
    const debit = related
      .filter((t) => t.type === "debit")
      .reduce((s, t) => s + t.amount, 0);
    rows.push({
      orderId: order.id,
      orderNumber: order.orderNumber,
      at: order.billUploadedAt || order.updatedAt || order.createdAt,
      amount,
      cancelled: order.status === "cancelled",
      creditAmount: Math.round((credit - debit) * 100) / 100,
    });
  }
  return rows.sort((a, b) => b.at.localeCompare(a.at));
}

/** @deprecated use progressForScheme */
export function weightForScheme(
  scheme: Scheme,
  lines: OrderLine[],
  products: Product[]
): number {
  return progressForScheme(scheme, lines, products);
}

/** Illustrative max payout at top tier on top target. */
export function schemeRewardAmount(scheme: Scheme): number {
  const levels = getSchemeLevels(scheme);
  const top = levels[levels.length - 1];
  if (!top) return 0;
  if (isPercentScheme(scheme) || scheme.rewardType === "order_percent") {
    // No sales value yet — return 0; UI shows % label instead
    return 0;
  }
  if (scheme.rewardType === "order_flat") {
    return schemeTierRate(scheme, top);
  }
  return estimateSchemePayout(scheme, top.targetAmount);
}

export function schemeRewardLabel(scheme: Scheme, locale: Locale): string {
  const unit = schemeUnitLabel(scheme, locale);
  const levels = getSchemeLevels(scheme);
  if (scheme.rewardType === "order_percent") {
    const parts = levels.map((l) => {
      const pct = schemeTierPercent(scheme, l);
      return locale === "hi"
        ? `${schemeLevelLabel(l, locale)}: ${l.targetAmount} ${unit} → ${pct}% छूट`
        : `${schemeLevelLabel(l, locale)}: ${l.targetAmount} ${unit} → ${pct}% off`;
    });
    const note =
      locale === "hi" ? "प्रति ऑर्डर बिल पर" : "Applied on each order bill";
    const topPct = levels.length
      ? schemeTierPercent(scheme, levels[levels.length - 1])
      : 0;
    const head =
      locale === "hi"
        ? `प्रति ऑर्डर · अधिकतम ${topPct}%`
        : `Per order · up to ${topPct}%`;
    return `${head} · ${parts.join(" · ")} · ${note}`;
  }
  if (scheme.rewardType === "order_flat") {
    const parts = levels.map((l) => {
      const flat = schemeTierRate(scheme, l);
      return locale === "hi"
        ? `${schemeLevelLabel(l, locale)}: ${l.targetAmount} ${unit} → ₹${flat} छूट`
        : `${schemeLevelLabel(l, locale)}: ${l.targetAmount} ${unit} → ₹${flat} off`;
    });
    const note =
      locale === "hi" ? "प्रति ऑर्डर बिल पर" : "Applied on each order bill";
    const topFlat = levels.length
      ? schemeTierRate(scheme, levels[levels.length - 1])
      : 0;
    const head =
      locale === "hi"
        ? `प्रति ऑर्डर · अधिकतम ₹${topFlat}`
        : `Per order · up to ₹${topFlat}`;
    return `${head} · ${parts.join(" · ")} · ${note}`;
  }
  if (isPercentScheme(scheme)) {
    const parts = levels.map((l) => {
      const pct = schemeTierPercent(scheme, l);
      return locale === "hi"
        ? `${schemeLevelLabel(l, locale)}: ${l.targetAmount} ${unit} → ${pct}% (बिक्री पर)`
        : `${schemeLevelLabel(l, locale)}: ${l.targetAmount} ${unit} → ${pct}% of sales`;
    });
    const payNote =
      locale === "hi"
        ? "भुगतान स्कीम समाप्ति पर एक बार"
        : "Single wallet credit after scheme ends";
    return `${parts.join(" · ")} · ${payNote}`;
  }
  const parts = levels.map((l) => {
    const rate = schemeTierRate(scheme, l);
    return locale === "hi"
      ? `${schemeLevelLabel(l, locale)}: ${l.targetAmount} ${unit} → ₹${rate}/${unit} (पूरा लिफ्ट)`
      : `${schemeLevelLabel(l, locale)}: ${l.targetAmount} ${unit} → ₹${rate}/${unit} (full lift)`;
  });
  const payNote =
    locale === "hi"
      ? "भुगतान स्कीम समाप्ति पर एक बार"
      : "Single wallet credit after scheme ends";
  return `${parts.join(" · ")} · ${payNote}`;
}

export function schemeScopeLabel(
  scheme: Scheme,
  locale: Locale,
  products: Product[],
  categories?: { id: string; name: { en: string; hi: string } }[]
): string {
  if (scheme.scopeType === "all") {
    return locale === "hi" ? "सभी उत्पाद" : "All products";
  }
  if (scheme.scopeType === "category") {
    const fromDb = categories?.find((c) => c.id === scheme.scopeCategory);
    if (fromDb) return fromDb.name[locale];
    const fallback: Record<string, { en: string; hi: string }> = {
      tarpaulin: { en: "Tarpaulin", hi: "तिरपाल" },
      shade_net: { en: "Shade Net", hi: "शेड नेट" },
      tirpal: { en: "Tirpal", hi: "तिरपाल (कैनवास)" },
    };
    const c = scheme.scopeCategory ? fallback[scheme.scopeCategory] : null;
    return c ? c[locale] : scheme.scopeCategory || "—";
  }
  const names = scheme.scopeProductIds
    .map((id) => products.find((p) => p.id === id)?.name[locale])
    .filter(Boolean);
  return names.join(", ") || (locale === "hi" ? "चयनित आइटम" : "Selected items");
}

export function formatSchemeDuration(scheme: Scheme, locale: Locale): string {
  const opts: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  };
  const loc = locale === "hi" ? "hi-IN" : "en-IN";
  const start = scheme.startDate ? new Date(scheme.startDate) : null;
  const end = scheme.endDate ? new Date(scheme.endDate) : null;
  const startOk = start && !Number.isNaN(start.getTime());
  const endOk = end && !Number.isNaN(end.getTime());
  if (!startOk && !endOk) return locale === "hi" ? "अवधि नहीं" : "No dates";
  const a = startOk ? start!.toLocaleDateString(loc, opts) : "—";
  const b = endOk ? end!.toLocaleDateString(loc, opts) : "—";
  return `${a} – ${b}`;
}

export type SchemeTierStatus = {
  level: SchemeLevel;
  rate: number;
  unlocked: boolean;
  remaining: number;
  /** Payout if this were the highest unlocked tier at current progress */
  payoutIfThisTier: number;
};

export function getDealerTierStatuses(
  scheme: Scheme,
  progress: number,
  salesValue = 0
): SchemeTierStatus[] {
  return getSchemeLevels(scheme).map((level) => {
    const rate = schemeTierRate(scheme, level);
    const unlocked = progress + 1e-9 >= (level.targetAmount || 0);
    const payoutIfThisTier = unlocked
      ? isPercentScheme(scheme)
        ? roundMoney((Math.max(0, salesValue) * rate) / 100)
        : roundMoney(progress * rate)
      : 0;
    return {
      level,
      rate,
      unlocked,
      remaining: Math.max(0, (level.targetAmount || 0) - progress),
      payoutIfThisTier,
    };
  });
}

/** @deprecated use getDealerTierStatuses */
export function getDealerLevelStatuses(
  scheme: Scheme,
  progress: number
): SchemeTierStatus[] {
  return getDealerTierStatuses(scheme, progress);
}

/** Net wallet amount already settled for a scheme (idempotent settle). */
export function netSchemeSettlement(
  txs: {
    userId: string;
    schemeId?: string;
    schemeSettlement?: boolean;
    type: "credit" | "debit";
    amount: number;
    orderId?: string;
  }[],
  userId: string,
  schemeId: string
): number {
  // Only settlement transactions count — manual admin credits tagged with
  // schemeId must not double-count.
  const related = txs.filter(
    (t) =>
      t.userId === userId &&
      t.schemeId === schemeId &&
      t.schemeSettlement === true
  );
  const credit = related
    .filter((t) => t.type === "credit")
    .reduce((s, t) => s + t.amount, 0);
  const debit = related
    .filter((t) => t.type === "debit")
    .reduce((s, t) => s + t.amount, 0);
  return roundMoney(credit - debit);
}
