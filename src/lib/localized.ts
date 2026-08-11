import type { LocalizedString, Locale, Product } from "./types";

/** Always return a safe { en, hi } pair. */
export function asLocalized(
  value: LocalizedString | string | null | undefined,
  fallback = ""
): LocalizedString {
  if (typeof value === "string") {
    const s = value.trim() || fallback;
    return { en: s, hi: s };
  }
  if (value && typeof value === "object") {
    const en = String(value.en ?? "").trim() || fallback;
    const hi = String(value.hi ?? "").trim() || en || fallback;
    return { en, hi };
  }
  return { en: fallback, hi: fallback };
}

/** Safe locale pick — never throws. */
export function loc(
  value: LocalizedString | null | undefined,
  locale: Locale | "en" | "hi",
  fallback = ""
): string {
  const n = asLocalized(value, fallback);
  return (locale === "hi" ? n.hi || n.en : n.en || n.hi) || fallback;
}

/**
 * Repair product localized fields corrupted by truncated auto-translate
 * (e.g. color.name became undefined). Returns true if anything changed.
 */
export function normalizeProductLocalized(p: Product): boolean {
  let changed = false;

  const fix = (
    current: LocalizedString | undefined,
    fallback: string
  ): LocalizedString => {
    const next = asLocalized(current, fallback);
    if (
      !current ||
      current.en !== next.en ||
      current.hi !== next.hi ||
      typeof current.en !== "string" ||
      typeof current.hi !== "string"
    ) {
      changed = true;
    }
    return next;
  };

  p.name = fix(p.name, p.code || "Product");
  p.itemName = fix(p.itemName, p.name.en);
  p.description = fix(p.description, "");
  if (p.descriptionHtml) {
    p.descriptionHtml = fix(p.descriptionHtml, "");
  }

  p.variations = (p.variations ?? []).map((v, i) => {
    const label = fix(v.label, v.size?.en || v.sku || `Size ${i + 1}`);
    const size = fix(v.size, label.en);
    if (v.label !== label || v.size !== size) changed = true;
    return { ...v, label, size };
  });

  p.colors = (p.colors ?? []).map((c, i) => {
    const name = fix(c.name, c.hex ? `Color ${i + 1}` : `Color ${i + 1}`);
    if (c.name !== name) changed = true;
    return { ...c, name };
  });

  if (!Array.isArray(p.media)) {
    p.media = [];
    changed = true;
  }

  return changed;
}
