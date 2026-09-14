import { getSizeColorStock } from "@/lib/inventory";
import { resolveWeightKg } from "@/lib/pricing";
import type { CartItem, OrderLine, Product } from "@/lib/types";

export const ORDER_AGAIN_HINT_KEY = "tt_order_again_hint";

export function cartLineKey(
  productId: string,
  variationId?: string,
  colorId?: string
): string {
  return `${productId}:${variationId ?? ""}:${colorId ?? ""}`;
}

function availableStock(
  product: Product,
  line: Pick<OrderLine, "variationId" | "colorId">
): number {
  return getSizeColorStock(product, line.variationId, line.colorId);
}

function weightForQty(
  product: Product,
  line: Pick<OrderLine, "variationId">,
  quantity: number
): number {
  const variation = line.variationId
    ? product.variations.find((v) => v.id === line.variationId)
    : product.variations[0];
  return resolveWeightKg(product, variation, quantity);
}

/**
 * Copy in-stock order lines into the current cart. Inactive / zero-stock
 * SKUs are skipped. Existing cart lines for the same SKU are increased,
 * capped at remaining stock.
 */
export function mergeOrderLinesIntoCart(
  lines: OrderLine[],
  products: Product[],
  existing: CartItem[]
): {
  cart: CartItem[];
  addedLines: number;
  skippedLines: number;
} {
  const cart = existing.map((item) => ({ ...item }));
  let addedLines = 0;
  let skippedLines = 0;

  for (const line of lines) {
    const product = products.find((p) => p.id === line.productId);
    if (!product || product.active === false) {
      skippedLines += 1;
      continue;
    }
    const want = Math.max(0, Math.floor(Number(line.quantity) || 0));
    if (want <= 0) {
      skippedLines += 1;
      continue;
    }
    const key = cartLineKey(product.id, line.variationId, line.colorId);
    const already = cart
      .filter((c) => c.key === key)
      .reduce((s, c) => s + c.quantity, 0);
    const room = Math.max(0, availableStock(product, line) - already);
    const addQty = Math.min(want, room);
    if (addQty <= 0) {
      skippedLines += 1;
      continue;
    }
    const found = cart.find((c) => c.key === key);
    if (found) {
      found.quantity += addQty;
      found.weightKg = weightForQty(product, line, found.quantity);
    } else {
      cart.push({
        key,
        productId: product.id,
        variationId: line.variationId,
        colorId: line.colorId,
        quantity: addQty,
        weightKg: weightForQty(product, line, addQty),
      });
    }
    addedLines += 1;
  }

  return { cart, addedLines, skippedLines };
}

export function orderAgainHint(input: {
  addedLines: number;
  skippedLines: number;
  locale: "en" | "hi";
}): string {
  const { addedLines, skippedLines, locale } = input;
  if (addedLines <= 0) {
    return locale === "hi"
      ? "ये आइटम स्टॉक में नहीं हैं"
      : "Those items are out of stock";
  }
  if (skippedLines <= 0) {
    return locale === "hi"
      ? `${addedLines} आइटम ऑर्डर में जोड़े`
      : `${addedLines} added to your order`;
  }
  return locale === "hi"
    ? `${addedLines} जोड़े · ${skippedLines} स्टॉक में नहीं`
    : `${addedLines} added · ${skippedLines} out of stock`;
}
