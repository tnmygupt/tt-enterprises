"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { ProductImage } from "@/components/ProductImage";
import { categoryLabel } from "@/lib/categories";
import { useDb, useSession } from "@/lib/hooks";
import { loc } from "@/lib/localized";
import { catalogFromRate, formatInr, unitLabel } from "@/lib/pricing";
import { productStockSummary } from "@/lib/inventory";
import { CatalogRetry } from "@/components/CatalogRetry";
import type { ProductCategory } from "@/lib/types";

export default function CatalogPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { db, cloudReady } = useDb();
  const { session, ready } = useSession();
  const showRates = ready && !!session;
  const [category, setCategory] = useState<ProductCategory | "all">("all");
  const [q, setQ] = useState("");

  const categoryTabs = useMemo(() => {
    const cats = (db?.categories ?? []).filter((c) => c.active);
    return [{ id: "all" as const }, ...cats.map((c) => ({ id: c.id }))];
  }, [db]);

  const products = useMemo(() => {
    if (!db) return [];
    return (db.products ?? [])
      .filter((p) => p?.active)
      .filter((p) => (category === "all" ? true : p.category === category))
      .filter((p) => {
        const hay =
          `${p.code || ""} ${loc(p.name, "en")} ${loc(p.name, "hi")} ${loc(p.itemName, "en")} ${loc(p.itemName, "hi")}`.toLowerCase();
        return hay.includes(q.toLowerCase().trim());
      });
  }, [db, category, q]);

  return (
    <section className="tt-section">
      <div className="tt-wrap">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{t("nav.catalog")}</h1>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {t("shop.catalogSubtitle")}
            </p>
          </div>
          <input
            className="tt-input w-full sm:max-w-sm"
            placeholder={t("common.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {categoryTabs.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setCategory(c.id)}
              className={`min-h-11 rounded-lg px-3 py-2 text-sm font-semibold ${
                category === c.id
                  ? "tt-selected bg-[var(--brand)] text-white"
                  : "bg-white text-[var(--ink-muted)] border border-[var(--line)]"
              }`}
            >
              {c.id === "all"
                ? t("common.all")
                : categoryLabel(db?.categories, c.id, locale)}
            </button>
          ))}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {products.map((p) => {
            const fromRate = catalogFromRate(p);
            const stock = productStockSummary(p);
            const sizeCount = (p.variations ?? []).length;
            const title = loc(p.name, locale, p.code || "Product");
            const item = loc(p.itemName, locale);
            const brand = (p.brand || "").trim();
            return (
              <Link
                key={p.id}
                href={`/catalog/${p.id}`}
                className="tt-panel flex items-center gap-4 p-4 transition hover:border-[var(--brand)]"
              >
                <ProductImage
                  src={p.logoUrl || p.media?.[0]?.url || ""}
                  alt={brand || title}
                  className="tt-logo"
                  width={72}
                  height={72}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                    {categoryLabel(db?.categories, p.category, locale)}
                    {item && item !== title ? ` · ${item}` : ""}
                  </p>
                  {brand ? (
                    <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--brand)]">
                      {brand}
                    </p>
                  ) : null}
                  <h2 className="truncate font-semibold text-[var(--ink)]">
                    {title}
                  </h2>
                  <p className="mt-1 text-sm font-semibold text-[var(--brand-deep)]">
                    {showRates
                      ? sizeCount > 1
                        ? `${t("shop.fromRate")} ${formatInr(fromRate, locale)}`
                        : formatInr(fromRate, locale)
                      : t("shop.loginForRates")}
                    {showRates ? (
                      <span className="font-normal text-[var(--ink-muted)]">
                        {" "}
                        /{" "}
                        {p.pricingMode === "bundle"
                          ? t("common.kg")
                          : unitLabel(p.unit, locale)}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                    {sizeCount
                      ? `${sizeCount} ${t("shop.sizes")}`
                      : "—"}
                    {" · "}
                    {stock.bundles}{" "}
                    {t("shop.bundles")}
                    {stock.fromMatrix || stock.fromVariations
                      ? locale === "hi"
                        ? " कुल"
                        : " total"
                      : ""}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
        {products.length ? null : !cloudReady ? (
          <p className="mt-6 text-[var(--ink-muted)]">{t("common.loading")}</p>
        ) : (
          <CatalogRetry className="mt-6" />
        )}
      </div>
    </section>
  );
}
