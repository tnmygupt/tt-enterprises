import type { Product, ProductVariation } from "@/lib/types";

/** Normalize size text for duplicate detection: "12X18 ft" → "12x18" */
export function normalizeSizeKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/feet|foot|ft\.?/g, "")
    .replace(/×/g, "x")
    .replace(/[^a-z0-9x./-]/g, "")
    .trim();
}

/**
 * Collapse duplicate sizes on a product (same size label repeating).
 * Keeps the first variation; merges stock into it.
 */
export function dedupeProductVariations(product: Product): Product {
  const seen = new Map<string, ProductVariation>();
  const kept: ProductVariation[] = [];

  for (const v of product.variations ?? []) {
    const label = v.size?.en || v.label?.en || v.id;
    const key = normalizeSizeKey(label) || v.id;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, v);
      kept.push(v);
      continue;
    }
    existing.stock = (existing.stock || 0) + (v.stock || 0);
    if ((v.rate || 0) > 0 && !(existing.rate > 0)) existing.rate = v.rate;
    if ((v.weightKg || 0) > 0 && !(existing.weightKg && existing.weightKg > 0)) {
      existing.weightKg = v.weightKg;
    }
    if (!existing.sku && v.sku) existing.sku = v.sku;
  }

  return { ...product, variations: kept };
}
