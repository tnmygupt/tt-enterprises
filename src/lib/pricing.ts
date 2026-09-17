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

/** 1 ft² = 0.092903 m². kg = L(ft) × W(ft) × GSM × 0.092903 / 1000 */
export const SQFT_TO_SQM = 0.092903;

export function pieceWeightGFromGsm(
  lengthFt: number,
  widthFt: number,
  gsm: number
): number {
  const l = Number(lengthFt) || 0;
  const w = Number(widthFt) || 0;
  const g = Number(gsm) || 0;
  if (!(l > 0) || !(w > 0) || !(g > 0)) return 0;
  return roundMoney(l * w * g * SQFT_TO_SQM);
}

export function pieceWeightKgFromGsm(
  lengthFt: number,
  widthFt: number,
  gsm: number
): number {
  const grams = pieceWeightGFromGsm(lengthFt, widthFt, gsm);
  if (!(grams > 0)) return 0;
  return roundMoney(grams / 1000);
}

export function packetWeightKgFromGsm(
  lengthFt: number,
  widthFt: number,
  gsm: number,
  pcsPerPacket: number
): number {
  const l = Number(lengthFt) || 0;
  const w = Number(widthFt) || 0;
  const g = Number(gsm) || 0;
  const pcs = Number(pcsPerPacket) || 0;
  if (!(l > 0) || !(w > 0) || !(g > 0) || !(pcs > 0)) return 0;
  return roundMoney((l * w * g * pcs * SQFT_TO_SQM) / 1000);
}

export function piecesInPacketLine(
  pcs: number,
  locale: "en" | "hi" = "en"
): string {
  const n = Number(pcs) || 0;
  if (!(n > 0)) return "";
  return locale === "hi" ? `${n} पीस 1 पैकेट में` : `${n} pieces in 1 packet`;
}

export function resolvePcsPerPacket(
  product?: {
    pcsPerPacket?: number;
    lengthFt?: number;
    widthFt?: number;
    ratePerSqft?: number;
    baseRate?: number;
  } | null,
  variation?: {
    pcsPerPacket?: number;
    lengthFt?: number;
    widthFt?: number;
    ratePerSqft?: number;
    rate?: number;
  } | null
): number {
  const fromVar = Number(variation?.pcsPerPacket);
  if (fromVar > 0) return Math.round(fromVar);
  const fromProd = Number(product?.pcsPerPacket);
  if (fromProd > 0) return Math.round(fromProd);
  if (!product) return 0;
  const lengthFt = Number(variation?.lengthFt ?? product.lengthFt) || 0;
  const widthFt = Number(variation?.widthFt ?? product.widthFt) || 0;
  const rps =
    Number(variation?.ratePerSqft ?? product.ratePerSqft ?? product.baseRate) ||
    0;
  const pc = ratePerPiece(rps, lengthFt, widthFt);
  const pkt = Number(variation?.rate) || 0;
  if (pc > 0 && pkt > 0) {
    const inferred = Math.round(pkt / pc);
    if (inferred > 0) return inferred;
  }
  return 0;
}

export function pcsPerPacketLabel(
  pcs: number,
  locale: "en" | "hi" = "en"
): string {
  const n = Number(pcs) || 0;
  if (!(n > 0)) return "";
  return locale === "hi" ? `${n} पीस/पैकेट` : `${n} pcs/pkt`;
}

export function resolveGsmPacketWeightKg(
  product: Pick<Product, "gsm" | "lengthFt" | "widthFt" | "pcsPerPacket">,
  variation?: Pick<
    ProductVariation,
    "lengthFt" | "widthFt" | "pcsPerPacket"
  > | null
): number {
  const lengthFt = Number(variation?.lengthFt ?? product.lengthFt) || 0;
  const widthFt = Number(variation?.widthFt ?? product.widthFt) || 0;
  const pcs = resolvePcsPerPacket(product, variation);
  const gsm = Number(product.gsm) || 0;
  return packetWeightKgFromGsm(lengthFt, widthFt, gsm, pcs);
}

function isDummyPackWeightKg(
  product: Pick<Product, "unit" | "baseWeightKg">,
  typedKg: number,
  gsmPacketKg: number
): boolean {
  // Old admin required pack kg and defaulted it to 1. That leftover must not
  // hide GSM shipping weight on sqft/pkt/pcs silpauline.
  return (
    isPackCountUnit(product.unit) &&
    gsmPacketKg > 0 &&
    typedKg === 1 &&
    (product.baseWeightKg == null || product.baseWeightKg === 1)
  );
}

/**
 * Weight of one bundle/packet/piece.
 * Typed variation.weightKg wins (except leftover dummy 1 on pack goods);
 * else GSM × size × pcs/pkt; else product base.
 */
export function resolveUnitWeightKg(
  product: Pick<
    Product,
    "baseWeightKg" | "gsm" | "lengthFt" | "widthFt" | "pcsPerPacket" | "unit"
  >,
  variation?: Pick<
    ProductVariation,
    "weightKg" | "lengthFt" | "widthFt" | "pcsPerPacket"
  > | null
): number {
  const gsmWt = resolveGsmPacketWeightKg(product, variation);
  const typed = Number(variation?.weightKg) || 0;
  if (typed > 0 && !isDummyPackWeightKg(product, typed, gsmWt)) {
    return typed;
  }
  if (gsmWt > 0) return gsmWt;
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
    if (unit === "sqft") return "वर्ग फुट";
    return "पीस";
  }
  if (unit === "kg") return "kg";
  if (unit === "jhal") return "jhal";
  if (unit === "pkt") return "pkt/pc";
  if (unit === "sqft") return "sq/ft";
  return "pcs";
}

/** Lowest visible catalog rate: ₹/sqft for sqft items, else variation/base rate. */
export function catalogFromRate(product: Product): number {
  if (isSqftUnit(product.unit)) {
    const rates = (product.variations ?? [])
      .map((v) => resolveSqftPack(product, v).ratePerSqft)
      .filter((r) => r > 0);
    if (rates.length) return Math.min(...rates);
    return Number(product.ratePerSqft ?? product.baseRate) || 0;
  }
  const rates = (product.variations ?? [])
    .map((v) => v.rate)
    .filter((r) => r > 0);
  if (rates.length) return Math.min(...rates);
  return Number(product.baseRate) || 0;
}

/** pkt, pcs, and sqft bill/stock by pack count (not weighed kg). */
export function isPackCountUnit(unit: UnitOfSale | string | undefined): boolean {
  return unit === "pkt" || unit === "pcs" || unit === "sqft";
}

export function isSqftUnit(unit: UnitOfSale | string | undefined): boolean {
  return unit === "sqft";
}

export function sqftPerPiece(lengthFt: number, widthFt: number): number {
  const l = Number(lengthFt) || 0;
  const w = Number(widthFt) || 0;
  if (!(l > 0) || !(w > 0)) return 0;
  return roundMoney(l * w);
}

export function sqftSizeLabel(lengthFt: number, widthFt: number): string {
  const l = Number(lengthFt) || 0;
  const w = Number(widthFt) || 0;
  if (!(l > 0) || !(w > 0)) return "";
  const fmt = (n: number) =>
    Number.isInteger(n) ? String(n) : String(roundMoney(n));
  return `${fmt(l)}×${fmt(w)} ft`;
}

export function ratePerPiece(
  ratePerSqft: number,
  lengthFt: number,
  widthFt: number
): number {
  return roundMoney((Number(ratePerSqft) || 0) * sqftPerPiece(lengthFt, widthFt));
}

export function ratePerPacket(
  ratePerSqft: number,
  lengthFt: number,
  widthFt: number,
  pcsPerPacket: number
): number {
  const pcs = Number(pcsPerPacket) || 0;
  if (!(pcs > 0)) return 0;
  return roundMoney(ratePerPiece(ratePerSqft, lengthFt, widthFt) * pcs);
}

export function sqftPacketAmount(params: {
  packets: number;
  ratePerSqft: number;
  lengthFt: number;
  widthFt: number;
  pcsPerPacket: number;
}): number {
  const packets = Number(params.packets) || 0;
  if (!(packets > 0)) return 0;
  return roundMoney(
    packets *
      ratePerPacket(
        params.ratePerSqft,
        params.lengthFt,
        params.widthFt,
        params.pcsPerPacket
      )
  );
}

export type SqftPackSpec = {
  lengthFt: number;
  widthFt: number;
  pcsPerPacket: number;
  ratePerSqft: number;
};

export function resolveSqftPack(
  product: Pick<
    Product,
    "lengthFt" | "widthFt" | "pcsPerPacket" | "ratePerSqft" | "baseRate"
  >,
  variation?: Pick<
    ProductVariation,
    "lengthFt" | "widthFt" | "pcsPerPacket" | "ratePerSqft" | "rate"
  > | null
): SqftPackSpec {
  const lengthFt = Number(variation?.lengthFt ?? product.lengthFt) || 0;
  const widthFt = Number(variation?.widthFt ?? product.widthFt) || 0;
  const pcsPerPacket = resolvePcsPerPacket(product, variation);
  const ratePerSqft =
    Number(variation?.ratePerSqft ?? product.ratePerSqft ?? product.baseRate) ||
    0;
  return { lengthFt, widthFt, pcsPerPacket, ratePerSqft };
}

export function applySqftComputedRate(
  product: Pick<
    Product,
    "lengthFt" | "widthFt" | "pcsPerPacket" | "ratePerSqft" | "baseRate"
  >,
  variation: ProductVariation
): ProductVariation {
  const spec = resolveSqftPack(product, variation);
  const ratePerSqft =
    Number(variation.ratePerSqft ?? spec.ratePerSqft) || 0;
  return {
    ...variation,
    lengthFt: spec.lengthFt,
    widthFt: spec.widthFt,
    pcsPerPacket: spec.pcsPerPacket,
    ratePerSqft,
    rate: ratePerPacket(
      ratePerSqft,
      spec.lengthFt,
      spec.widthFt,
      spec.pcsPerPacket
    ),
    size: {
      en: variation.size?.en || sqftSizeLabel(spec.lengthFt, spec.widthFt),
      hi: variation.size?.hi || sqftSizeLabel(spec.lengthFt, spec.widthFt),
    },
    label: {
      en:
        variation.label?.en ||
        variation.size?.en ||
        sqftSizeLabel(spec.lengthFt, spec.widthFt),
      hi:
        variation.label?.hi ||
        variation.size?.hi ||
        variation.label?.en ||
        sqftSizeLabel(spec.lengthFt, spec.widthFt),
    },
  };
}
