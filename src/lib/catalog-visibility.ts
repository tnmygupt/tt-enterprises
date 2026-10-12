import type { Product } from "./types";

/** Plant input. Kept for stock, purchases, and job cards. */
export function isRawMaterial(
  product: Pick<Product, "rawMaterial"> | null | undefined
): boolean {
  return product?.rawMaterial === true;
}

/** Finished goods a dealer or a public visitor can see and order. */
export function isPublicCatalogProduct(
  product: Pick<Product, "active" | "rawMaterial"> | null | undefined
): boolean {
  return !!product && product.active !== false && !isRawMaterial(product);
}
