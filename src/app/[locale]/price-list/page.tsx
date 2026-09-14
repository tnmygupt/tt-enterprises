"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { useDb, useSession } from "@/lib/hooks";
import { loc } from "@/lib/localized";
import { formatInr, isSqftUnit, resolveSqftPack, unitLabel } from "@/lib/pricing";
import { CatalogRetry } from "@/components/CatalogRetry";
import type { ProductCategory } from "@/lib/types";

/** Prefer real size text; strip leading "Size" / "साइज़" so list shows "12x18" not "Size 12x18". */
function cleanSizeLabel(
  variation: {
    size?: { en?: string; hi?: string };
    label?: { en?: string; hi?: string };
    sku?: string;
  },
  locale: "en" | "hi"
): string {
  const raw =
    variation.size?.[locale] ||
    variation.size?.en ||
    variation.label?.[locale] ||
    variation.label?.en ||
    variation.sku ||
    "";
  return raw
    .replace(/^(size|साइज़|साईज)\s*[:\-.]?\s*/i, "")
    .trim();
}

const PINS_KEY = "tt_price_list_pins_v1";

export default function PriceListPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { db, cloudReady } = useDb();
  const { session, ready } = useSession();
  const [category, setCategory] = useState<ProductCategory | "all">("all");
  const [q, setQ] = useState("");
  const [pinned, setPinned] = useState<string[]>([]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINS_KEY);
      const list = raw ? (JSON.parse(raw) as string[]) : [];
      if (Array.isArray(list) && list.length) {
        // Hydrating pins from localStorage — intentional
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPinned(list.filter((id) => typeof id === "string"));
      }
    } catch {
      /* ignore */
    }
  }, []);

  const togglePin = (productId: string) => {
    setPinned((current) => {
      const next = current.includes(productId)
        ? current.filter((id) => id !== productId)
        : [...current, productId];
      try {
        localStorage.setItem(PINS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const pinnedSet = useMemo(() => new Set(pinned), [pinned]);

  /**
   * One block per product+rate (same as before visually), but never put
   * two different products in the same block — even when rates match
   * (e.g. Green Net and Paras Fresh at the same ₹).
   */
  const blocks = useMemo(() => {
    if (!db) return [];

    type Block = {
      key: string;
      productId: string;
      productName: string;
      sizes: string[];
      rate: number;
      unitLabel: string;
    };

    const map = new Map<string, Block>();

    for (const p of db.products ?? []) {
      if (!p?.active) continue;
      if (category !== "all" && p.category !== category) continue;

      const productName = loc(p.name, locale, p.code || "Product");
      const hay =
        `${p.code || ""} ${loc(p.name, "en")} ${loc(p.name, "hi")} ${p.brand || ""}`.toLowerCase();
      if (!hay.includes(q.toLowerCase().trim())) continue;

      const variations = (p.variations ?? []).length
        ? p.variations
        : [
            {
              id: "base",
              label: p.name,
              size: p.name,
              sku: p.code,
              rate: p.baseRate,
              weightKg: p.baseWeightKg,
              stock: p.stock,
            },
          ];

      const unitText =
        p.pricingMode === "bundle"
          ? locale === "hi"
            ? "किग्रा"
            : "kg"
          : unitLabel(p.unit, locale);

      for (const v of variations) {
        const rate = isSqftUnit(p.unit)
          ? resolveSqftPack(p, v).ratePerSqft
          : v.rate || p.baseRate;
        if (!(rate > 0)) continue;

        const sizeRaw = cleanSizeLabel(v, locale);
        const size =
          sizeRaw &&
          sizeRaw.toLowerCase() !== productName.toLowerCase()
            ? sizeRaw
            : "";

        // Key includes productId so same-rate products stay in separate blocks
        const key = `${p.id}|${rate}|${unitText}`;
        let block = map.get(key);
        if (!block) {
          block = {
            key,
            productId: p.id,
            productName,
            sizes: [],
            rate,
            unitLabel: unitText,
          };
          map.set(key, block);
        }
        if (size && !block.sizes.includes(size)) {
          block.sizes.push(size);
        }
      }
    }

    return [...map.values()]
      .map((b) => ({
        ...b,
        sizes: b.sizes.sort((a, c) =>
          a.localeCompare(c, locale === "hi" ? "hi" : "en", {
            numeric: true,
            sensitivity: "base",
          })
        ),
      }))
      .sort((a, b) => {
        // Pinned products stay on top of the list
        const pinDiff =
          Number(pinnedSet.has(b.productId)) - Number(pinnedSet.has(a.productId));
        if (pinDiff !== 0) return pinDiff;
        // A–Z by product name; same name → by rate
        const byName = a.productName.localeCompare(
          b.productName,
          locale === "hi" ? "hi" : "en",
          { sensitivity: "base", numeric: true }
        );
        if (byName !== 0) return byName;
        if (a.rate !== b.rate) return a.rate - b.rate;
        return a.unitLabel.localeCompare(b.unitLabel);
      });
  }, [db, category, q, locale, pinnedSet]);

  if (!ready) {
    return (
      <section className="tt-section">
        <div className="tt-wrap">
          <p className="text-sm text-[var(--ink-muted)]">{t("common.loading")}</p>
        </div>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="tt-section">
        <div className="tt-wrap tt-panel max-w-lg p-6">
          <h1 className="tt-display text-3xl text-[var(--brand-deep)]">
            {t("nav.priceList")}
          </h1>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            {t("shop.priceListLogin")}
          </p>
          <Link href="/" className="tt-btn tt-btn-dark mt-4 inline-flex">
            {t("nav.login")}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="tt-section">
      <div className="tt-wrap">
        <div className="flex flex-col gap-3">
          <h1 className="text-2xl font-semibold text-[var(--ink)]">
            {t("nav.priceList")}
          </h1>
          <div className="grid gap-2 sm:grid-cols-2">
            <input
              className="tt-input w-full"
              placeholder={t("common.search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="tt-select w-full"
              value={category}
              onChange={(e) =>
                setCategory(e.target.value as ProductCategory | "all")
              }
            >
              <option value="all">{t("common.all")}</option>
              {(db?.categories ?? [])
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {loc(c.name, locale, c.id)}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="tt-panel mt-4 overflow-hidden">
          {!cloudReady || !db ? (
            <p className="px-3 py-4 text-sm text-[var(--ink-muted)]">
              {t("common.loading")}
            </p>
          ) : !blocks.length ? (
            (db.products?.length ?? 0) === 0 ? (
              <div className="px-3 py-4">
                <CatalogRetry />
              </div>
            ) : (
            <p className="px-3 py-4 text-sm text-[var(--ink-muted)]">
              {t("common.empty")}
            </p>
            )
          ) : (
            <ul>
              {blocks.map((g) => (
                <li
                  key={g.key}
                  className="grid grid-cols-[1fr_auto] items-start gap-x-3 border-b border-[var(--line)] last:border-b-0"
                >
                  <div className="min-w-0 py-2 pl-3">
                    <Link
                      href={`/catalog/${g.productId}`}
                      className="block min-h-11 py-1 hover:opacity-80"
                    >
                      <span className="block font-bold text-[var(--ink)]">
                        {g.productName}
                      </span>
                      {g.sizes.length ? (
                        <span className="block text-sm text-[var(--ink-muted)]">
                          {g.sizes.join(", ")}
                        </span>
                      ) : null}
                    </Link>
                  </div>
                  <div className="flex items-center gap-1 whitespace-nowrap py-2 pr-3 text-right text-sm font-semibold tabular-nums text-[var(--brand-deep)]">
                    <span>
                      {formatInr(g.rate, locale)}
                      <span className="font-normal text-[var(--ink-muted)]">
                        /{g.unitLabel}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={() => togglePin(g.productId)}
                      aria-pressed={pinnedSet.has(g.productId)}
                      aria-label={
                        locale === "hi"
                          ? "पसंदीदा में रखें"
                          : "Pin to top of list"
                      }
                      className={`min-h-11 min-w-11 rounded-lg text-base ${
                        pinnedSet.has(g.productId)
                          ? "text-[var(--brand)]"
                          : "text-[var(--line)] hover:text-[var(--ink-muted)]"
                      }`}
                    >
                      {pinnedSet.has(g.productId) ? "★" : "☆"}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {blocks.length ? (
          <div className="tt-sticky-bar">
            <Link href="/quick-order" className="tt-btn tt-btn-dark">
              {t("common.orderNow")}
            </Link>
          </div>
        ) : null}
      </div>
    </section>
  );
}
