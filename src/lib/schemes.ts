import type {
  Locale,
  OrderLine,
  Product,
  Scheme,
  SchemeLevel,
  SchemeProgressUnit,
  SchemeRewardType,
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

/** ₹ subtracted from the list rate (100 − 1 = 99). Same math as order_per_kg. */
export function isRupeeOffRateScheme(
  scheme: Pick<Scheme, "rewardType"> | SchemeRewardType
): boolean {
  const t = typeof scheme === "string" ? scheme : scheme.rewardType;
  return t === "order_rate" || t === "order_per_kg";
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
  if (isRupeeOffRateScheme(scheme) || scheme.discountPerKg > 0) {
    return scheme.discountPerKg;
  }
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
    scheme.rewardType === "order_percent" ||
    scheme.rewardType === "order_rate" ||
    scheme.rewardType === "order_flat" ||
    scheme.rewardType === "order_per_kg"
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
          : isRupeeOffRateScheme(scheme)
            ? scheme.discountPerKg || 0
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

export type OrderDiscountQtyOpts = {
  /** Only actualWeightKg / billed qty — never estimate kg. */
  billedOnly?: boolean;
};

function lineKgForDiscount(line: OrderLine, billedOnly: boolean): number {
  if (billedOnly) {
    return line.actualWeightKg != null && line.actualWeightKg > 0
      ? Number(line.actualWeightKg)
      : 0;
  }
  if (line.actualWeightKg != null && line.actualWeightKg > 0) {
    return Number(line.actualWeightKg);
  }
  if (line.estimatedWeightKg != null && line.estimatedWeightKg > 0) {
    return Number(line.estimatedWeightKg);
  }
  return Number(line.weightKg) || 0;
}

/**
 * This-order qty for order-discount schemes (estimate kg when actual unset).
 */
export function orderQtyForScheme(
  scheme: Scheme,
  lines: OrderLine[],
  products: Product[],
  opts?: OrderDiscountQtyOpts
): number {
  const unit = schemeProgressUnit(scheme);
  const billedOnly = !!opts?.billedOnly;
  return lines.reduce((sum, line) => {
    const product = products.find((p) => p.id === line.productId);
    if (!product) return sum;
    if (!schemeMatchesProduct(scheme, product)) return sum;
    const qty = Number(line.quantity) || 0;
    const kg = lineKgForDiscount(line, billedOnly);
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

/** One catalogue item on the bill. Sizes/colours of the same product share this key. */
export function orderDiscountItemKey(
  line: Pick<OrderLine, "productId" | "variationId">
): string {
  return line.productId;
}

export function groupOrderDiscountLines(
  scheme: Scheme,
  lines: OrderLine[],
  products: Product[]
): Map<string, OrderLine[]> {
  const map = new Map<string, OrderLine[]>();
  for (const line of lines) {
    const product = products.find((p) => p.id === line.productId);
    if (!product || !schemeMatchesProduct(scheme, product)) continue;
    const key = orderDiscountItemKey(line);
    const bucket = map.get(key);
    if (bucket) bucket.push(line);
    else map.set(key, [line]);
  }
  return map;
}

function lineSizeLabel(
  line: OrderLine,
  products: Product[],
  locale: Locale
): string {
  const fromLine =
    line.variationLabel?.[locale] ||
    line.variationLabel?.en ||
    line.size?.[locale] ||
    line.size?.en ||
    "";
  if (fromLine) return fromLine;
  const product = products.find((p) => p.id === line.productId);
  const variation = product?.variations?.find(
    (v) => v.id === (line.variationId || "")
  );
  if (variation) {
    const size = variation.size?.[locale] || variation.size?.en;
    const label = variation.label?.[locale] || variation.label?.en;
    return size || label || variation.sku || "";
  }
  return "";
}

function orderDiscountItemLabel(
  groupLines: OrderLine[],
  products: Product[],
  locale: Locale
): string {
  const line = groupLines[0];
  if (!line) return "";
  const product = products.find((p) => p.id === line.productId);
  const name =
    product?.name?.[locale] ||
    product?.name?.en ||
    line.productName?.[locale] ||
    line.productName?.en ||
    line.productCode ||
    line.productId;
  const sizes = [
    ...new Set(
      groupLines
        .map((l) => lineSizeLabel(l, products, locale))
        .filter(Boolean)
    ),
  ];
  if (sizes.length > 1) return `${name} (${sizes.join(" + ")})`;
  if (sizes.length === 1) return `${name} · ${sizes[0]}`;
  return name;
}

export type OrderDiscountGroup = {
  key: string;
  qty: number;
  kg: number;
  amount: number;
  tier: SchemeLevel;
  label: { en: string; hi: string };
};

export type OrderDiscountResult = {
  amount: number;
  tier: SchemeLevel | null;
  scheme: Scheme;
  groups?: OrderDiscountGroup[];
};

function lineIsPcsPriced(line: OrderLine, product: Product): boolean {
  return (line.pricingMode || product.pricingMode) === "pcs";
}

/** ₹ off this-order billed kg at the unlocked ₹/kg rate (never × bundles). */
function orderPerKgSave(
  scheme: Scheme,
  lines: OrderLine[],
  products: Product[],
  offPerUnit: number,
  opts?: OrderDiscountQtyOpts
): number {
  if (!(offPerUnit > 0)) return 0;
  const billedOnly = !!opts?.billedOnly;
  let save = 0;
  for (const line of lines) {
    const product = products.find((p) => p.id === line.productId);
    if (!product || !schemeMatchesProduct(scheme, product)) continue;
    const listRate = Number(line.rate) || 0;
    if (!(listRate > 0)) continue;
    const cut = Math.min(listRate, offPerUnit);
    if (lineIsPcsPriced(line, product)) continue;
    const kg = lineKgForDiscount(line, billedOnly);
    if (kg > 0) save += cut * kg;
  }
  return roundMoney(save);
}

/** Billed / estimate kg for ₹/kg off — qualifying sizes only, never bundle count. */
export function orderDiscountKg(
  scheme: Scheme,
  lines: OrderLine[],
  products: Product[],
  opts?: OrderDiscountQtyOpts
): number {
  const billedOnly = !!opts?.billedOnly;
  let sum = 0;
  for (const groupLines of groupOrderDiscountLines(scheme, lines, products).values()) {
    const qty = orderQtyForScheme(scheme, groupLines, products, opts);
    if (!getAchievedTier(scheme, qty)) continue;
    for (const line of groupLines) {
      const product = products.find((p) => p.id === line.productId);
      if (!product || lineIsPcsPriced(line, product)) continue;
      sum += lineKgForDiscount(line, billedOnly);
    }
  }
  return roundMoney(sum);
}

/** Qty shown in the discount math line (kg for ₹/kg off; qualifying sizes only). */
export function orderDiscountMathQty(
  scheme: Scheme,
  lines: OrderLine[],
  products: Product[],
  opts?: OrderDiscountQtyOpts
): number {
  if (isRupeeOffRateScheme(scheme)) {
    return orderDiscountKg(scheme, lines, products, opts);
  }
  let sum = 0;
  for (const groupLines of groupOrderDiscountLines(scheme, lines, products).values()) {
    const qty = orderQtyForScheme(scheme, groupLines, products, opts);
    if (!getAchievedTier(scheme, qty)) continue;
    sum += orderQtyForScheme(scheme, groupLines, products, opts);
  }
  return roundMoney(sum);
}

function highestTier(a: SchemeLevel | null, b: SchemeLevel): SchemeLevel {
  if (!a) return b;
  return (b.targetAmount || 0) > (a.targetAmount || 0) ? b : a;
}

function resolveGroupSave(
  scheme: Scheme,
  groupLines: OrderLine[],
  products: Product[],
  tier: SchemeLevel,
  opts?: OrderDiscountQtyOpts
): number {
  const scoped = orderScopedSubtotal(scheme, groupLines, products);
  if (!(scoped > 0)) return 0;
  let raw = 0;
  if (scheme.rewardType === "order_percent") {
    const pct = schemeTierPercent(scheme, tier);
    if (!(pct > 0)) return 0;
    raw = (scoped * pct) / 100;
  } else if (isRupeeOffRateScheme(scheme)) {
    const off = schemeTierRate(scheme, tier);
    raw = orderPerKgSave(scheme, groupLines, products, off, opts);
  } else {
    return 0;
  }
  return roundMoney(Math.min(raw, scoped));
}

/** Each product unlocks its own tier (sizes of that item add up). Flat ₹ once at the best step. */
export function resolveOrderDiscount(
  scheme: Scheme,
  lines: OrderLine[],
  products: Product[],
  opts?: OrderDiscountQtyOpts
): { amount: number; tier: SchemeLevel | null; groups: OrderDiscountGroup[] } {
  if (!isOrderDiscountScheme(scheme)) {
    return { amount: 0, tier: null, groups: [] };
  }
  const buckets = groupOrderDiscountLines(scheme, lines, products);
  const billedOnly = !!opts?.billedOnly;
  const groups: OrderDiscountGroup[] = [];
  let bestFlat: { tier: SchemeLevel; amount: number } | null = null;

  for (const [key, groupLines] of buckets) {
    const qty = orderQtyForScheme(scheme, groupLines, products, opts);
    const tier = getAchievedTier(scheme, qty);
    if (!tier) continue;
    const label = {
      en: orderDiscountItemLabel(groupLines, products, "en"),
      hi: orderDiscountItemLabel(groupLines, products, "hi"),
    };
    if (scheme.rewardType === "order_flat") {
      const flat = schemeTierRate(scheme, tier);
      if (flat > 0 && (!bestFlat || flat > bestFlat.amount)) {
        bestFlat = { tier, amount: flat };
      }
      continue;
    }
    const amount = resolveGroupSave(scheme, groupLines, products, tier, opts);
    if (!(amount > 0)) continue;
    let kg = 0;
    for (const line of groupLines) {
      const product = products.find((p) => p.id === line.productId);
      if (!product || lineIsPcsPriced(line, product)) continue;
      kg += lineKgForDiscount(line, billedOnly);
    }
    groups.push({
      key,
      qty,
      kg: roundMoney(kg),
      amount,
      tier,
      label,
    });
  }

  if (scheme.rewardType === "order_flat") {
    if (!bestFlat) return { amount: 0, tier: null, groups: [] };
    const scopedAll = orderScopedSubtotal(scheme, lines, products);
    const amount = roundMoney(Math.min(bestFlat.amount, scopedAll));
    return { amount, tier: bestFlat.tier, groups: [] };
  }

  const rawTotal = roundMoney(groups.reduce((s, g) => s + g.amount, 0));
  const scopedAll = orderScopedSubtotal(scheme, lines, products);
  const amount = roundMoney(Math.min(rawTotal, scopedAll));
  const tier = groups.reduce<SchemeLevel | null>(
    (best, g) => highestTier(best, g.tier),
    null
  );
  return { amount, tier, groups };
}

/**
 * Among eligible active order-discount schemes, pick largest discount.
 */
export function pickBestOrderDiscount(
  schemes: Scheme[],
  assignedSchemeIds: string[] | null | undefined,
  lines: OrderLine[],
  products: Product[],
  at = new Date(),
  opts?: OrderDiscountQtyOpts
): OrderDiscountResult | null {
  let best: OrderDiscountResult | null = null;
  for (const scheme of schemes) {
    if (!isOrderDiscountScheme(scheme)) continue;
    if (!isSchemeActiveNow(scheme, at)) continue;
    if (!dealerHasScheme(scheme, assignedSchemeIds)) continue;
    const resolved = resolveOrderDiscount(scheme, lines, products, opts);
    if (!(resolved.amount > 0)) continue;
    if (!best || resolved.amount > best.amount) {
      best = { amount: resolved.amount, tier: resolved.tier, scheme, groups: resolved.groups };
    }
  }
  return best;
}

export function lineDiscountedRate(
  scheme: Scheme,
  tier: SchemeLevel,
  line: Pick<OrderLine, "rate" | "pricingMode">,
  product: Pick<Product, "pricingMode">
): { listRate: number; discountedRate: number } | null {
  const listRate = Number(line.rate) || 0;
  if (!(listRate > 0)) return null;
  const isPcs = (line.pricingMode || product.pricingMode) === "pcs";
  if (isRupeeOffRateScheme(scheme)) {
    if (schemeProgressUnit(scheme) === "kg" && isPcs) return null;
    const off = schemeTierRate(scheme, tier);
    if (!(off > 0)) return null;
    return {
      listRate,
      discountedRate: roundMoney(Math.max(0, listRate - off)),
    };
  }
  if (scheme.rewardType === "order_percent") {
    const pct = schemeTierPercent(scheme, tier);
    if (!(pct > 0)) return null;
    return {
      listRate,
      discountedRate: roundMoney(listRate * (1 - pct / 100)),
    };
  }
  return null;
}

/** This line's product-group tier, or null if that item did not unlock. */
export function lineOrderDiscountTier(
  result: OrderDiscountResult | null | undefined,
  line: Pick<OrderLine, "productId" | "variationId">
): SchemeLevel | null {
  if (!result || !(result.amount > 0)) return null;
  if (result.groups && result.groups.length > 0) {
    const key = orderDiscountItemKey(line);
    return result.groups.find((g) => g.key === key)?.tier ?? null;
  }
  if (result.scheme.rewardType === "order_flat") return null;
  return result.tier;
}

function groupMathBit(
  scheme: Scheme,
  group: OrderDiscountGroup,
  locale: Locale
): string {
  const name = group.label?.[locale] || group.label?.en || "";
  const prefix = name ? `${name}: ` : "";
  if (isRupeeOffRateScheme(scheme)) {
    const off = schemeTierRate(scheme, group.tier);
    const kg = roundMoney(group.kg).toFixed(2);
    if (scheme.rewardType === "order_rate") {
      return locale === "hi"
        ? `${prefix}रेट से ₹${off} छूट × ${kg} किग्रा`
        : `${prefix}₹${off} off rate × ${kg} kg`;
    }
    return locale === "hi"
      ? `${prefix}${kg} किग्रा × ₹${off}/किग्रा`
      : `${prefix}${kg} kg × ₹${off}/kg`;
  }
  if (scheme.rewardType === "order_percent") {
    const pct = schemeTierPercent(scheme, group.tier);
    const unit = schemeProgressUnit(scheme);
    const qLabel =
      unit === "bundles"
        ? locale === "hi"
          ? `${roundMoney(group.qty)} बंडल`
          : `${roundMoney(group.qty)} bdl`
        : `${roundMoney(group.kg).toFixed(2)} kg`;
    return locale === "hi"
      ? `${prefix}₹/किग्रा पर ${pct}% छूट × ${qLabel}`
      : `${prefix}${pct}% off ₹/kg × ${qLabel}`;
  }
  return "";
}

/** Short packing-slip / PDF line: "12x18: 120.50 kg × ₹2/kg" */
export function orderDiscountMathLabel(
  best: OrderDiscountResult | null | undefined,
  qty: number,
  locale: Locale = "en"
): string {
  if (!best || !(best.amount > 0)) return "";
  const savedGroups = (best.groups || []).filter((g) => g.amount > 0);
  if (savedGroups.length > 0) {
    return savedGroups.map((g) => groupMathBit(best.scheme, g, locale)).filter(Boolean).join(" + ");
  }
  if (!best.tier || !(qty > 0)) return "";
  const unit = schemeProgressUnit(best.scheme);
  const q = roundMoney(qty);
  const qLabel =
    unit === "bundles"
      ? locale === "hi"
        ? `${q} बंडल`
        : `${q} bdl`
      : `${q.toFixed(2)} kg`;
  if (isRupeeOffRateScheme(best.scheme)) {
    const off = schemeTierRate(best.scheme, best.tier);
    if (best.scheme.rewardType === "order_rate") {
      return locale === "hi"
        ? `रेट से ₹${off} छूट (100 → ${Math.max(0, roundMoney(100 - off))}) × ${q.toFixed(2)} किग्रा`
        : `₹${off} off rate (100 → ${Math.max(0, roundMoney(100 - off))}) × ${q.toFixed(2)} kg`;
    }
    return locale === "hi"
      ? `${q.toFixed(2)} किग्रा × ₹${off}/किग्रा`
      : `${q.toFixed(2)} kg × ₹${off}/kg`;
  }
  if (best.scheme.rewardType === "order_percent") {
    const pct = schemeTierPercent(best.scheme, best.tier);
    return locale === "hi"
      ? `₹/किग्रा पर ${pct}% छूट × ${qLabel}`
      : `${pct}% off ₹/kg × ${qLabel}`;
  }
  const flat = schemeTierRate(best.scheme, best.tier);
  return locale === "hi" ? `बिल पर ₹${flat} छूट` : `₹${flat} off bill`;
}

export function orderDiscountReceiptLabel(
  best: OrderDiscountResult,
  locale: Locale = "en"
): string {
  const name =
    best.scheme.name?.[locale] ||
    best.scheme.name?.en ||
    best.scheme.name?.hi ||
    "";
  const tier = best.tier;
  if (!tier) return name;
  if (best.scheme.rewardType === "order_percent") {
    const pct = schemeTierPercent(best.scheme, tier);
    return locale === "hi"
      ? `${name} · ₹/किग्रा पर ${pct}% छूट`
      : `${name} · ${pct}% off ₹/kg`;
  }
  if (isRupeeOffRateScheme(best.scheme)) {
    const off = schemeTierRate(best.scheme, tier);
    if (best.scheme.rewardType === "order_rate") {
      return locale === "hi"
        ? `${name} · रेट से ₹${off} छूट (100 → ${Math.max(0, roundMoney(100 - off))})`
        : `${name} · ₹${off} off rate (100 → ${Math.max(0, roundMoney(100 - off))})`;
    }
    const unit = schemeUnitLabel(best.scheme, locale);
    return locale === "hi"
      ? `${name} · ₹${off}/${unit} छूट`
      : `${name} · ₹${off}/${unit} off`;
  }
  const flat = schemeTierRate(best.scheme, tier);
  return locale === "hi"
    ? `${name} · इस बिल पर ₹${flat} छूट`
    : `${name} · ₹${flat} off this bill`;
}

export type DealerOrderDiscountItemView = {
  label: string;
  current: string;
  next?: string;
};

export type DealerOrderDiscountView = {
  how: string;
  tiers: { need: string; off: string }[];
  current?: string;
  next?: string;
  items?: DealerOrderDiscountItemView[];
};

function orderDiscountOffLabel(
  scheme: Scheme,
  level: SchemeLevel,
  locale: Locale
): string {
  const unit = schemeUnitLabel(scheme, locale);
  if (scheme.rewardType === "order_percent") {
    const pct = schemeTierPercent(scheme, level);
    return locale === "hi" ? `₹/किग्रा पर ${pct}% छूट` : `${pct}% off ₹/kg`;
  }
  if (isRupeeOffRateScheme(scheme)) {
    const off = schemeTierRate(scheme, level);
    if (scheme.rewardType === "order_rate") {
      return locale === "hi" ? `रेट से ₹${off} छूट` : `₹${off} off the rate`;
    }
    return locale === "hi" ? `₹${off}/${unit} छूट` : `₹${off}/${unit} off`;
  }
  const flat = schemeTierRate(scheme, level);
  return locale === "hi" ? `₹${flat} छूट` : `₹${flat} off`;
}

function formatDealerQty(qty: number, unit: string): string {
  const n =
    qty >= 10 && Math.abs(qty - Math.round(qty)) < 0.05
      ? qty.toFixed(0)
      : qty.toFixed(1);
  return `${n} ${unit}`;
}

/** Per-item progress rows for checkout / quick-order (sizes of one product grouped). */
export function dealerItemProgressViews(
  scheme: Scheme,
  lines: OrderLine[],
  products: Product[],
  locale: Locale,
  opts?: OrderDiscountQtyOpts
): DealerOrderDiscountItemView[] {
  const unit = schemeUnitLabel(scheme, locale);
  const levels = getSchemeLevels(scheme);
  const items: DealerOrderDiscountItemView[] = [];
  for (const groupLines of groupOrderDiscountLines(scheme, lines, products).values()) {
    const qty = orderQtyForScheme(scheme, groupLines, products, opts);
    const label = orderDiscountItemLabel(groupLines, products, locale);
    const achieved = getAchievedTier(scheme, qty);
    const qLab = formatDealerQty(qty, unit);
    const current = achieved
      ? locale === "hi"
        ? `${label}: ${qLab} → ${orderDiscountOffLabel(scheme, achieved, locale)}`
        : `${label}: ${qLab} → ${orderDiscountOffLabel(scheme, achieved, locale)}`
      : locale === "hi"
        ? `${label}: ${qLab} — छूट नहीं`
        : `${label}: ${qLab} — no discount yet`;
    const nextLevel = levels.find((l) => (l.targetAmount || 0) > qty + 1e-9);
    const next = nextLevel
      ? locale === "hi"
        ? `${label}: ${(nextLevel.targetAmount - qty).toFixed(0)} ${unit} और → ${orderDiscountOffLabel(scheme, nextLevel, locale)}`
        : `${label}: add ${(nextLevel.targetAmount - qty).toFixed(0)} ${unit} more → ${orderDiscountOffLabel(scheme, nextLevel, locale)}`
      : undefined;
    items.push({ label, current, next });
  }
  return items;
}

/** Plain-language per-order discount for dealers (home, schemes, checkout). */
export function dealerOrderDiscountView(
  scheme: Scheme,
  locale: Locale,
  thisOrderQty?: number,
  extra?: {
    amount?: number;
    estimate?: boolean;
    items?: DealerOrderDiscountItemView[];
  }
): DealerOrderDiscountView {
  const unit = schemeUnitLabel(scheme, locale);
  const levels = getSchemeLevels(scheme);
  const isPct = scheme.rewardType === "order_percent";
  const isRateOff = isRupeeOffRateScheme(scheme);
  const isNamedRateOff = scheme.rewardType === "order_rate";
  const how = isNamedRateOff
    ? locale === "hi"
      ? "एक उत्पाद के सभी साइज़ और रंग जुड़ते हैं। मात्रा पूरी हो तो रेट से ₹ छूट — इसी बिल पर, तौल के बाद।"
      : "All sizes and colours of one product add up. Hit the qty and the rate drops on this bill — after weighment."
    : isRateOff
    ? locale === "hi"
      ? "एक उत्पाद के सभी साइज़ और रंग जुड़ते हैं। मात्रा पूरी हो तो प्रति किलो ₹ छूट — इसी बिल पर।"
      : "All sizes and colours of one product add up. Hit the qty and you get ₹ off per kg on this bill."
    : isPct
      ? locale === "hi"
        ? "एक उत्पाद के सभी साइज़ और रंग जुड़ते हैं। मात्रा पूरी हो तो रेट पर % छूट — इसी बिल पर।"
        : "All sizes and colours of one product add up. Hit the qty and you get % off the rate on this bill."
      : locale === "hi"
        ? "एक उत्पाद के सभी साइज़ और रंग जुड़ते हैं। मात्रा पूरी हो तो इस बिल से ₹ छूट।"
        : "All sizes and colours of one product add up. Hit the qty and ₹ comes off this bill.";
  const tiers = levels.map((l) => ({
    need:
      locale === "hi"
        ? `${l.targetAmount} ${unit} या ज़्यादा (प्रति आइटम)`
        : `${l.targetAmount} ${unit} or more (per item)`,
    off: orderDiscountOffLabel(scheme, l, locale),
  }));
  const items = extra?.items;
  const saveBit =
    extra?.amount != null && extra.amount > 0
      ? locale === "hi"
        ? ` बचत ₹${extra.amount}.`
        : ` Save ₹${extra.amount}.`
      : "";
  const after =
    extra?.estimate !== false
      ? locale === "hi"
        ? " असली वजन के बाद फाइनल।"
        : " Final after actual weight."
      : "";
  if (items && items.length > 0) {
    const current = extra?.amount != null && extra.amount > 0
      ? locale === "hi"
        ? `कुल बचत ₹${extra.amount}.${after}`
        : `Total save ₹${extra.amount}.${after}`
      : undefined;
    return { how, tiers, current, items };
  }
  if (thisOrderQty == null || Number.isNaN(thisOrderQty) || thisOrderQty < 0) {
    return { how, tiers };
  }
  const qty = thisOrderQty;
  const qtyLabel = formatDealerQty(qty, unit);
  const achieved = getAchievedTier(scheme, qty);
  const current = achieved
    ? locale === "hi"
      ? `अनुमान ${qtyLabel} → ${orderDiscountOffLabel(scheme, achieved, locale)}.${saveBit}${after}`
      : `Estimate ${qtyLabel} → ${orderDiscountOffLabel(scheme, achieved, locale)}.${saveBit}${after}`
    : locale === "hi"
      ? `अनुमान ${qtyLabel} — छूट अभी नहीं`
      : `Estimate ${qtyLabel} — no discount yet`;
  const nextLevel = levels.find((l) => (l.targetAmount || 0) > qty + 1e-9);
  const next = nextLevel
    ? locale === "hi"
      ? `${(nextLevel.targetAmount - qty).toFixed(0)} ${unit} और जोड़ें → ${orderDiscountOffLabel(scheme, nextLevel, locale)}`
      : `Add ${(nextLevel.targetAmount - qty).toFixed(0)} ${unit} more → ${orderDiscountOffLabel(scheme, nextLevel, locale)}`
    : undefined;
  return { how, tiers, current, next };
}

export type ManualDiscountKind = "percent" | "flat";

export type AppliedBillDiscount = {
  schemeAmount: number;
  manualAmount: number;
  total: number;
};

/** Scheme auto + staff %/₹, capped at goods subtotal (not shipping). */
export function applyBillDiscounts(opts: {
  goodsSubtotal: number;
  schemeAmount?: number;
  manualKind?: ManualDiscountKind | "" | null;
  manualValue?: number | null;
}): AppliedBillDiscount {
  const subtotal = roundMoney(Math.max(0, opts.goodsSubtotal));
  const schemeAmount = roundMoney(
    Math.min(Math.max(0, opts.schemeAmount || 0), subtotal)
  );
  const kind = opts.manualKind === "percent" || opts.manualKind === "flat"
    ? opts.manualKind
    : undefined;
  const value = Number(opts.manualValue);
  let manualRaw = 0;
  if (kind && Number.isFinite(value) && value > 0) {
    manualRaw = kind === "percent" ? (subtotal * value) / 100 : value;
  }
  const manualAmount = roundMoney(
    Math.min(Math.max(0, manualRaw), Math.max(0, subtotal - schemeAmount))
  );
  return {
    schemeAmount,
    manualAmount,
    total: roundMoney(schemeAmount + manualAmount),
  };
}

export function billDiscountReceiptLabel(
  best: OrderDiscountResult | null | undefined,
  applied: AppliedBillDiscount,
  kind?: ManualDiscountKind | "" | null,
  value?: number | null,
  locale: Locale = "en"
): string {
  if (!(applied.total > 0)) return "";
  const parts: string[] = [];
  if (applied.schemeAmount > 0 && best) {
    parts.push(orderDiscountReceiptLabel(best, locale));
  }
  if (applied.manualAmount > 0) {
    if (kind === "percent" && (value || 0) > 0) {
      parts.push(
        locale === "hi"
          ? `स्टाफ ${value}% छूट`
          : `Staff ${value}% off`
      );
    } else {
      parts.push(
        locale === "hi"
          ? `स्टाफ ₹${applied.manualAmount} छूट`
          : `Staff ₹${applied.manualAmount} off`
      );
    }
  }
  return parts.join(" + ");
}

/** Default T&C when creating or switching scheme type (copy only). */
export function defaultSchemeTerms(
  rewardType: SchemeRewardType
): { en: string; hi: string } {
  if (rewardType === "order_rate") {
    return {
      en: "Sizes of the same item add up. Different items do not. Hit that item's qty → rupees off the rate (₹100 − ₹1 = ₹99). Final bill uses actual kg × discounted rate. It is not added to wallet later.",
      hi: "एक आइटम के साइज़ जुड़ते हैं, अलग आइटम नहीं। उस आइटम की मात्रा पर रेट से रुपये छूट (₹100 − ₹1 = ₹99)। फाइनल बिल असली किग्रा × छूटा रेट। बाद में वॉलेट में नहीं जाएगी।",
    };
  }
  if (
    rewardType === "order_percent" ||
    rewardType === "order_flat" ||
    rewardType === "order_per_kg"
  ) {
    return {
      en: "Sizes of the same item add up. Different items do not. Discount applies to that item once the qty is hit. Final bill uses actual kg. It is not added to wallet later.",
      hi: "एक आइटम के साइज़ जुड़ते हैं, अलग आइटम नहीं। छूट उसी आइटम पर जिसकी मात्रा पूरी हो। फाइनल बिल असली किग्रा पर। बाद में वॉलेट में नहीं जाएगी।",
    };
  }
  return {
    en: "Highest lift in the scheme period sets the rate. One wallet credit after the end date — not off each bill.",
    hi: "अवधि में सबसे ऊँची लिफ्ट से रेट। समाप्ति के बाद एक वॉलेट क्रेडिट — हर बिल से नहीं कटेगा।",
  };
}

function adminLevelOffLabel(
  scheme: Scheme,
  level: SchemeLevel,
  locale: Locale
): string {
  if (scheme.rewardType === "order_percent") {
    const pct = schemeTierPercent(scheme, level);
    return locale === "hi" ? `₹/किग्रा पर ${pct}% छूट` : `${pct}% off ₹/kg`;
  }
  if (isRupeeOffRateScheme(scheme)) {
    const off = schemeTierRate(scheme, level);
    if (scheme.rewardType === "order_rate") {
      const after = Math.max(0, roundMoney(100 - off));
      return locale === "hi"
        ? `रेट से ₹${off} छूट (100 → ${after})`
        : `₹${off} off rate (100 → ${after})`;
    }
    const unit = schemeUnitLabel(scheme, locale);
    return locale === "hi" ? `₹${off}/${unit} छूट` : `₹${off}/${unit} off`;
  }
  if (scheme.rewardType === "order_flat") {
    const flat = schemeTierRate(scheme, level);
    return locale === "hi" ? `₹${flat} छूट` : `₹${flat} off`;
  }
  if (isPercentScheme(scheme)) {
    const pct = schemeTierPercent(scheme, level);
    return locale === "hi" ? `${pct}% बिक्री (वॉलेट)` : `${pct}% of sales (wallet)`;
  }
  const rate = schemeTierRate(scheme, level);
  const unit = schemeUnitLabel(scheme, locale);
  return locale === "hi"
    ? `₹${rate}/${unit} पूरे लिफ्ट पर (वॉलेट)`
    : `₹${rate}/${unit} on full lift (wallet)`;
}

/** Admin row preview: "This bill: 100 kg+ → 2% off" vs wallet lifting. */
export function adminSchemeLevelPreview(
  scheme: Scheme,
  level: SchemeLevel,
  locale: Locale
): string {
  const unit = schemeUnitLabel(scheme, locale);
  const qty = level.targetAmount || 0;
  const off = adminLevelOffLabel(scheme, level, locale);
  if (isOrderDiscountScheme(scheme)) {
    return locale === "hi"
      ? `इस बिल पर, प्रति आइटम: ${qty} ${unit}+ → ${off}`
      : `This bill, per item: ${qty} ${unit}+ → ${off}`;
  }
  return locale === "hi"
    ? `वॉलेट बाद में: ${qty} ${unit}+ लिफ्ट → ${off}`
    : `Wallet later: ${qty} ${unit}+ lift → ${off}`;
}

export function previewDealerOrderDiscount(
  schemes: Scheme[],
  assignedSchemeIds: string[] | null | undefined,
  lines: OrderLine[],
  products: Product[],
  locale: Locale,
  at = new Date()
): { best: OrderDiscountResult | null; view: DealerOrderDiscountView | null } {
  const best = pickBestOrderDiscount(
    schemes,
    assignedSchemeIds,
    lines,
    products,
    at
  );
  const scheme =
    best?.scheme ||
    schemes.find(
      (s) =>
        isOrderDiscountScheme(s) &&
        isSchemeActiveNow(s, at) &&
        dealerHasScheme(s, assignedSchemeIds)
    );
  if (!scheme) return { best, view: null };
  const items = lines.length
    ? dealerItemProgressViews(scheme, lines, products, locale)
    : [];
  return {
    best,
    view: dealerOrderDiscountView(
      scheme,
      locale,
      items.length ? undefined : orderQtyForScheme(scheme, lines, products),
      {
        amount: best?.amount,
        estimate: true,
        items: items.length ? items : undefined,
      }
    ),
  };
}

export function orderDiscountLabelForOrder(
  order: {
    schemeDiscountId?: string;
    schemeDiscountLabel?: string;
    lines: OrderLine[];
    manualDiscountKind?: "percent" | "flat";
    manualDiscountValue?: number;
  },
  schemes: Scheme[],
  products: Product[],
  locale: Locale
): string {
  const scheme = schemes.find((s) => s.id === order.schemeDiscountId);
  const goodsSubtotal = roundMoney(
    order.lines.reduce((s, l) => s + (Number(l.lineTotal) || 0), 0)
  );
  let best: OrderDiscountResult | null = null;
  if (scheme && isOrderDiscountScheme(scheme) && order.lines.length) {
    const resolved = resolveOrderDiscount(scheme, order.lines, products);
    if (resolved.amount > 0 && resolved.tier) {
      best = {
        amount: resolved.amount,
        tier: resolved.tier,
        scheme,
        groups: resolved.groups,
      };
    }
  }
  const applied = applyBillDiscounts({
    goodsSubtotal,
    schemeAmount: best?.amount ?? 0,
    manualKind: order.manualDiscountKind,
    manualValue: order.manualDiscountValue,
  });
  const live = billDiscountReceiptLabel(
    best,
    applied,
    order.manualDiscountKind,
    order.manualDiscountValue,
    locale
  );
  return live || order.schemeDiscountLabel || "";
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
  if (scheme.rewardType === "order_flat" || isRupeeOffRateScheme(scheme)) {
    return schemeTierRate(scheme, top);
  }
  return estimateSchemePayout(scheme, top.targetAmount);
}

export function schemeRewardLabel(scheme: Scheme, locale: Locale): string {
  const unit = schemeUnitLabel(scheme, locale);
  const levels = getSchemeLevels(scheme);
  if (isOrderDiscountScheme(scheme)) {
    const view = dealerOrderDiscountView(scheme, locale);
    const rows = view.tiers.map((row) => `${row.need} → ${row.off}`);
    return `${view.how} ${rows.join(". ")}`.trim();
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
