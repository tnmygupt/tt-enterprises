import type { Product } from "./types";

const FALLBACK_NEW_LIMIT = 6;

export function productsByIds(
  products: Product[],
  ids: string[]
): Product[] {
  const active = new Map(
    products.filter((p) => p.active).map((p) => [p.id, p] as const)
  );
  const out: Product[] = [];
  for (const id of ids) {
    const p = active.get(id);
    if (p) out.push(p);
  }
  return out;
}

export function fallbackNewProducts(
  products: Product[],
  limit = FALLBACK_NEW_LIMIT
): Product[] {
  return [...products]
    .filter((p) => p.active)
    .sort((a, b) => {
      if (a.featured !== b.featured) return a.featured ? -1 : 1;
      return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
    })
    .slice(0, limit);
}

/** Manual list when ids are set; otherwise featured / newest. */
export function resolveHomeNewProducts(
  products: Product[],
  ids?: string[] | null
): Product[] {
  if (ids && ids.length) return productsByIds(products, ids);
  return fallbackNewProducts(products);
}

export function resolveHomePromoProducts(
  products: Product[],
  ids?: string[] | null
): Product[] {
  if (!ids?.length) return [];
  return productsByIds(products, ids);
}

export function toggleId(ids: string[], id: string, on: boolean): string[] {
  const next = ids.filter((x) => x !== id);
  if (on) next.push(id);
  return next;
}

export function moveId(ids: string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  if (i < 0) return ids;
  const j = i + dir;
  if (j < 0 || j >= ids.length) return ids;
  const next = [...ids];
  const swap = next[i];
  next[i] = next[j];
  next[j] = swap;
  return next;
}
