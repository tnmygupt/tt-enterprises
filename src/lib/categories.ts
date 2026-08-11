import type { CategoryDef, Locale } from "./types";
import { loc } from "./localized";

export function categoryLabel(
  categories: CategoryDef[] | undefined,
  categoryId: string,
  locale: Locale
): string {
  const found = categories?.find((c) => c.id === categoryId);
  if (found) return loc(found.name, locale, categoryId);
  return categoryId;
}

export function slugifyCategory(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u0900-\u097f]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || `cat_${Date.now()}`;
}
