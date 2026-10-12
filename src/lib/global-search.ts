import { isPublicCatalogProduct } from "./catalog-visibility";
import { loc } from "./localized";
import { productStockSummary } from "./inventory";
import { formatInr } from "./pricing";
import type { Order, Product } from "./types";

export type GlobalHitKind = "product" | "order";

export type GlobalHit = {
  kind: GlobalHitKind;
  id: string;
  title: string;
  subtitle: string;
  href: string;
  score: number;
};

export type GlobalSearchInput = {
  products?: Product[];
  orders?: Order[];
};

export type GlobalSearchOptions = {
  locale: "en" | "hi";
  /** Staff see every order and land on the admin list */
  staff: boolean;
  /** Dealers only ever see their own orders */
  userId?: string;
  limit?: number;
};

function scoreMatch(hay: string, q: string): number {
  const h = hay.toLowerCase();
  if (h === q) return 100;
  if (h.startsWith(q)) return 80;
  if (h.includes(q)) return 50;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => h.includes(t))) return 40;
  return 0;
}

/** One bar for the whole app: products from the catalog plus orders. */
export function searchGlobal(
  db: GlobalSearchInput | null | undefined,
  query: string,
  opts: GlobalSearchOptions
): GlobalHit[] {
  const q = query.trim().toLowerCase();
  if (!db || q.length < 2) return [];
  const limit = opts.limit ?? 12;
  const hits: GlobalHit[] = [];

  for (const p of db.products ?? []) {
    if (!isPublicCatalogProduct(p)) continue;
    const title = loc(p.name, opts.locale, p.code || "Product");
    const hay = `${p.code || ""} ${loc(p.name, "en")} ${loc(p.name, "hi")} ${
      loc(p.itemName, "en") || ""
    } ${p.brand || ""}`;
    const score = scoreMatch(hay, q);
    if (!score) continue;
    const stock = productStockSummary(p).bundles;
    const rate = p.baseRate > 0 ? formatInr(p.baseRate, opts.locale) : "";
    hits.push({
      kind: "product",
      id: p.id,
      title,
      subtitle: [p.code, rate, `${stock} ${opts.locale === "hi" ? "बंडल" : "bdl"}`]
        .filter(Boolean)
        .join(" · "),
      href: `/catalog/${p.id}`,
      score: score + 5,
    });
  }

  for (const o of db.orders ?? []) {
    if (!opts.staff && o.userId !== opts.userId) continue;
    const hay = opts.staff
      ? `${o.orderNumber} ${o.userName || ""} ${o.phone || ""} ${o.lrNumber || ""}`
      : `${o.orderNumber} ${o.lrNumber || ""}`;
    const score = scoreMatch(hay, q);
    if (!score) continue;
    hits.push({
      kind: "order",
      id: o.id,
      title: o.orderNumber,
      subtitle: [
        o.status.replaceAll("_", " "),
        opts.staff ? o.userName || o.phone || "" : "",
        o.createdAt.slice(0, 10),
      ]
        .filter(Boolean)
        .join(" · "),
      href: opts.staff
        ? `/admin/orders?q=${encodeURIComponent(o.orderNumber)}`
        : `/orders/${o.id}`,
      score,
    });
  }

  return hits
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit);
}
