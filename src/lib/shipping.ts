import type {
  AppSettings,
  ShippingRule,
  WeightShippingRule,
} from "@/lib/types";

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Weight rule (when enabled):
 * - Any weight > 0 and ≤ minKg → flat X
 * - weight > minKg → X + ceil((weight − minKg) / stepKg) × (X × fraction)
 */
export function calcWeightSlabShipping(
  weightKg: number,
  rule: {
    minWeightKg: number;
    flatRateX: number;
    stepKg: number;
    stepFractionOfX: number;
  }
): number {
  if (!(weightKg > 0)) return 0;
  const x = Math.max(0, rule.flatRateX || 0);
  if (!(weightKg > rule.minWeightKg)) return roundMoney(x);
  const step = Math.max(1, rule.stepKg || 50);
  const fraction = rule.stepFractionOfX ?? 0.5;
  const over = weightKg - rule.minWeightKg;
  const steps = over > 0 ? Math.ceil(over / step) : 0;
  return roundMoney(x + steps * (x * fraction));
}

/** Match client shipping rules: max bound is exclusive (`weight < max`). */
export function calcRuleShipping(
  rules: ShippingRule[] | undefined,
  weightKg: number,
  orderValue: number
): number {
  const active = (rules ?? []).filter((r) => r.active);
  const rule =
    active.find(
      (r) =>
        weightKg >= r.minWeightKg &&
        (r.maxWeightKg == null || weightKg < r.maxWeightKg) &&
        orderValue >= r.minOrderValue
    ) || active[0];
  if (!rule) return 0;
  if (
    (rule.freeAboveWeightKg != null && weightKg >= rule.freeAboveWeightKg) ||
    (rule.freeAboveValue != null && orderValue >= rule.freeAboveValue)
  ) {
    return 0;
  }
  return Number(rule.shippingAmount) || 0;
}

/** Flat ₹ × number of jhals (1 jhal = ratePerJhal). */
export function calcJhalShipping(
  jhalQty: number,
  ratePerJhal: number
): number {
  if (!(jhalQty > 0) || !(ratePerJhal > 0)) return 0;
  return roundMoney(jhalQty * ratePerJhal);
}

/** Shared shipping used by client checkout and server order reprice. */
export function calcShippingAmount(input: {
  settings?: Pick<AppSettings, "weightShipping" | "jhalShipping"> | null;
  shippingRules?: ShippingRule[];
  subtotal: number;
  /** Weight for kg/pcs lines only (exclude jhal lines when possible) */
  totalWeightKg: number;
  /** Number of jhals on the order */
  jhalQty?: number;
}): number {
  const jhalPart = calcJhalShipping(
    input.jhalQty ?? 0,
    input.settings?.jhalShipping?.ratePerJhal ?? 0
  );

  const ws = input.settings?.weightShipping as WeightShippingRule | undefined;
  let weightPart = 0;
  if (ws?.enabled) {
    // Slab mode: only charge when there is weight; never fall back to band rules
    if (input.totalWeightKg > 0) {
      weightPart = calcWeightSlabShipping(input.totalWeightKg, {
        minWeightKg: ws.minWeightKg ?? 100,
        flatRateX: ws.flatRateX ?? 0,
        stepKg: ws.stepKg ?? 50,
        stepFractionOfX: ws.stepFractionOfX ?? 0.5,
      });
    }
  } else if (input.totalWeightKg > 0 || !(input.jhalQty && input.jhalQty > 0)) {
    weightPart = calcRuleShipping(
      input.shippingRules,
      input.totalWeightKg,
      input.subtotal
    );
  }

  return roundMoney(weightPart + jhalPart);
}
