import type {
  Order,
  OrderLine,
  Product,
  ProductVariation,
  UnitOfSale,
} from "./types";

export function calcLineTotal(params: {
  pricingMode: "bundle" | "pcs";
  rate: number;
  quantity: number;
  weightKg: number;
}): number {
  const { pricingMode, rate, quantity, weightKg } = params;
  if (pricingMode === "bundle") {
    return roundMoney(rate * weightKg);
  }
  return roundMoney(rate * quantity);
}

/** Final bill from actual kg (bundle = ₹/kg × kg; pcs = rate × qty). */
export function computeBillFromActualWeights(
  order: Pick<
    Order,
    "lines" | "shippingAmount" | "walletUsed" | "schemeDiscount"
  >,
  lineActualKg: number[]
): {
  lineAmounts: number[];
  subtotal: number;
  shippingAmount: number;
  schemeDiscount: number;
  walletUsed: number;
  /** Gross bill before wallet (stored as actualBillAmount). */
  grossBill: number;
  billAmount: number;
  totalKg: number;
} {
  const lineAmounts = order.lines.map((line, i) => {
    const kg = Number(lineActualKg[i]) || 0;
    return calcLineTotal({
      pricingMode: line.pricingMode,
      rate: line.rate,
      quantity: line.quantity,
      weightKg: kg,
    });
  });
  const subtotal = roundMoney(lineAmounts.reduce((s, n) => s + n, 0));
  const shippingAmount = roundMoney(order.shippingAmount || 0);
  const schemeDiscount = roundMoney(
    Math.min(Math.max(0, order.schemeDiscount || 0), subtotal)
  );
  // Payable / stored bill is always whole rupees (matches uploadBill).
  const grossBill = roundOffRupees(
    Math.max(0, subtotal + shippingAmount - schemeDiscount)
  );
  const walletUsed = roundMoney(
    Math.min(order.walletUsed || 0, grossBill)
  );
  const totalKg = roundMoney(
    lineActualKg.reduce((s, n) => s + (Number(n) > 0 ? Number(n) : 0), 0)
  );
  return {
    lineAmounts,
    subtotal,
    shippingAmount,
    schemeDiscount,
    walletUsed,
    grossBill,
    billAmount: roundOffRupees(grossBill - walletUsed),
    totalKg,
  };
}

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Final payable amount — nearest whole rupee. */
export function roundOffRupees(n: number): number {
  return Math.round(Number(n) || 0);
}

export function resolveRate(
  product: Product,
  variation?: ProductVariation
): number {
  return variation?.rate ?? product.baseRate;
}

/** Weight of one bundle/piece. Variation weight wins when set; else product base. */
export function resolveUnitWeightKg(
  product: Pick<Product, "baseWeightKg">,
  variation?: Pick<ProductVariation, "weightKg"> | null
): number {
  if (variation?.weightKg != null && variation.weightKg > 0) {
    return variation.weightKg;
  }
  return product.baseWeightKg ?? 0;
}

export function resolveWeightKg(
  product: Product,
  variation: ProductVariation | undefined,
  quantity: number,
  explicitWeightKg?: number
): number {
  if (explicitWeightKg != null && explicitWeightKg > 0) {
    return roundMoney(explicitWeightKg);
  }
  const qty = Math.max(1, quantity || 1);
  const unitWeight = resolveUnitWeightKg(product, variation);
  // Always: total kg = admin unit/bundle weight × quantity (1 bundle × 35kg = 35kg)
  return roundMoney(unitWeight * qty);
}

export function buildOrderLine(params: {
  product: Product;
  variation?: ProductVariation;
  colorId?: string;
  colorName?: { en: string; hi: string };
  quantity: number;
  weightKg?: number;
}): OrderLine {
  const { product, variation, colorId, colorName, quantity } = params;
  const rate = resolveRate(product, variation);
  const weightKg = resolveWeightKg(
    product,
    variation,
    quantity,
    params.weightKg
  );
  const lineTotal = calcLineTotal({
    pricingMode: product.pricingMode,
    rate,
    quantity,
    weightKg,
  });

  return {
    productId: product.id,
    productCode: variation?.sku ?? product.code,
    productName: product.name,
    variationId: variation?.id,
    variationLabel: variation?.label,
    size: variation?.size,
    colorId,
    colorName,
    unit: product.unit,
    pricingMode: product.pricingMode,
    rate,
    quantity,
    weightKg,
    estimatedWeightKg: weightKg,
    lineTotal,
  };
}

export function variationDisplayLabel(
  variation: ProductVariation | undefined,
  locale: "en" | "hi"
): string {
  if (!variation) return "—";
  const size = variation.size?.[locale] || variation.size?.en;
  const label = variation.label?.[locale] || variation.label?.en;
  if (size && label && size !== label) return `${label} · ${size}`;
  return size || label || variation.sku || "—";
}

export function formatInr(amount: number, locale: "en" | "hi" = "en"): string {
  return new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(amount);
}

export function unitLabel(unit: UnitOfSale, locale: "en" | "hi"): string {
  if (locale === "hi") {
    if (unit === "kg") return "किग्रा";
    if (unit === "jhal") return "झाल";
    if (unit === "pkt") return "पैकेट";
    return "पीस";
  }
  if (unit === "kg") return "kg";
  if (unit === "jhal") return "jhal";
  if (unit === "pkt") return "pkt/pc";
  return "pcs";
}
