"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { NumberField } from "@/components/NumberField";
import { categoryLabel } from "@/lib/categories";
import { useDb, useSession } from "@/lib/hooks";
import { dedupeProductVariations, normalizeSizeKey } from "@/lib/media";
import { formatInr } from "@/lib/pricing";
import { checkCapability, upsertProduct } from "@/lib/store/db";
import type { Product } from "@/lib/types";

type SizeMember = {
  productId: string;
  variationId: string;
  sizeLabel: string;
  sku: string;
  weightKg: number;
};

/** One clubbed row: same product name + same rate → bulk edit */
type RateGroup = {
  key: string;
  productName: string;
  category: string;
  rate: number;
  pricingMode: Product["pricingMode"];
  sizes: SizeMember[];
  /** Unique product ids in this club (usually 1) */
  productIds: string[];
};

function productDisplayName(p: Product, locale: "en" | "hi"): string {
  return (p.itemName?.[locale] || p.name[locale] || p.name.en || "").trim();
}

export default function AdminRatesPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [q, setQ] = useState("");
  const [draft, setDraft] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState("");
  const [cleaning, setCleaning] = useState(false);

  const isSuperAdmin = session?.role === "super_admin";

  const groups = useMemo(() => {
    if (!db) return [] as RateGroup[];
    const map = new Map<string, RateGroup>();

    for (const p of db.products) {
      if (!p.active && !q) continue;
      const productName = productDisplayName(p, locale);
      const nameKey = productName.toLowerCase();
      const category = categoryLabel(db.categories, p.category, locale);
      const seenSizes = new Set<string>();

      for (const v of p.variations) {
        const sizeLabel = (v.size?.[locale] || v.label[locale] || v.label.en || "").trim();
        const sizeKey = normalizeSizeKey(sizeLabel) || v.id;
        // Skip duplicate size rows inside the same product
        const dedupeKey = `${p.id}::${sizeKey}`;
        if (seenSizes.has(dedupeKey)) continue;
        seenSizes.add(dedupeKey);

        const rate = Number(v.rate) || 0;
        const clubKey = `${nameKey}__${rate}`;
        let group = map.get(clubKey);
        if (!group) {
          group = {
            key: clubKey,
            productName: productName || p.code || p.id,
            category,
            rate,
            pricingMode: p.pricingMode,
            sizes: [],
            productIds: [],
          };
          map.set(clubKey, group);
        }
        if (!group.productIds.includes(p.id)) group.productIds.push(p.id);
        group.sizes.push({
          productId: p.id,
          variationId: v.id,
          sizeLabel: sizeLabel || "—",
          sku: v.sku || "",
          weightKg: v.weightKg ?? 0,
        });
      }
    }

    let list = [...map.values()].sort((a, b) =>
      a.productName.localeCompare(b.productName) || a.rate - b.rate
    );
    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (g) =>
          g.productName.toLowerCase().includes(needle) ||
          g.category.toLowerCase().includes(needle) ||
          g.sizes.some(
            (s) =>
              s.sizeLabel.toLowerCase().includes(needle) ||
              s.sku.toLowerCase().includes(needle)
          )
      );
    }
    return list;
  }, [db, locale, q]);

  const dirtyCount = useMemo(() => {
    let n = 0;
    for (const g of groups) {
      if (draft[g.key] !== undefined && draft[g.key] !== g.rate) n += 1;
    }
    return n;
  }, [groups, draft]);

  if (!session || !checkCapability(session, db?.users, "manage_products") || !isSuperAdmin) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  if (!db) {
    return (
      <AdminShell>
        <p>{t("common.loading")}</p>
      </AdminShell>
    );
  }

  const rateValue = (g: RateGroup) =>
    draft[g.key] !== undefined ? draft[g.key] : g.rate;

  const saveAll = () => {
    const byProduct = new Map<string, Product>();

    for (const g of groups) {
      const nextRate = draft[g.key];
      if (nextRate === undefined || nextRate === g.rate) continue;
      if (!(nextRate > 0)) {
        setMsg(locale === "hi" ? "रेट > 0 होना चाहिए" : "Rate must be > 0");
        return;
      }
      for (const s of g.sizes) {
        let product = byProduct.get(s.productId);
        if (!product) {
          const src = db.products.find((p) => p.id === s.productId);
          if (!src) continue;
          product = structuredClone(src);
          byProduct.set(s.productId, product);
        }
        const v = product.variations.find((x) => x.id === s.variationId);
        if (!v) continue;
        v.rate = nextRate;
      }
    }

    for (const product of byProduct.values()) {
      if (product.variations[0]) product.baseRate = product.variations[0].rate;
      upsertProduct(product);
    }

    setDraft({});
    refresh();
    setMsg(
      locale === "hi"
        ? `${byProduct.size} प्रोडक्ट · ${dirtyCount} ग्रुप अपडेट`
        : `Saved ${byProduct.size} product(s) · ${dirtyCount} rate group(s)`
    );
  };

  const cleanDuplicateSizes = () => {
    setCleaning(true);
    let touched = 0;
    for (const p of db.products) {
      const before = p.variations.length;
      const after = dedupeProductVariations(p).variations.length;
      if (after < before) {
        upsertProduct(p);
        touched += 1;
      }
    }
    refresh();
    setCleaning(false);
    setMsg(
      locale === "hi"
        ? `डुप्लिकेट साइज़ साफ़ · ${touched} प्रोडक्ट`
        : `Cleaned duplicate sizes on ${touched} product(s)`
    );
  };

  return (
    <AdminShell wide>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            Super admin
          </p>
          <h1 className="tt-h2 mt-1">
            {locale === "hi" ? "रेट एडिटर" : "Quick rate editor"}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {locale === "hi"
              ? "एक ही नाम + एक ही रेट वाले साइज़ एक ग्रुप में — एक बार रेट बदलें। पुराने ऑर्डर पर पुराना रेट ही रहेगा; नए ऑर्डर पर नया रेट लगेगा।"
              : "Same product name + same rate are clubbed — change once. Existing orders keep their old rate; only new orders get the new rate."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/admin/products" className="tt-btn tt-btn-outline">
            {t("admin.products")}
          </Link>
          <button
            type="button"
            className="tt-btn tt-btn-outline"
            disabled={cleaning}
            onClick={cleanDuplicateSizes}
          >
            {locale === "hi" ? "डुप्लिकेट साइज़ हटाएँ" : "Remove duplicate sizes"}
          </button>
          <button
            type="button"
            className="tt-btn tt-btn-dark"
            disabled={dirtyCount === 0}
            onClick={saveAll}
          >
            {locale === "hi"
              ? `सेव (${dirtyCount})`
              : `Save changes (${dirtyCount})`}
          </button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <input
          className="tt-input max-w-md"
          placeholder={
            locale === "hi"
              ? "प्रोडक्ट / साइज़ खोजें"
              : "Search product / size"
          }
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>

      {msg ? (
        <p className="mt-3 text-sm font-medium text-[var(--brand-deep)]">{msg}</p>
      ) : null}

      <div className="tt-panel mt-5 overflow-x-auto">
        <table className="tt-table min-w-[920px]">
          <thead>
            <tr>
              <th>{locale === "hi" ? "कैटेगरी" : "Category"}</th>
              <th>{locale === "hi" ? "आइटम" : "Item"}</th>
              <th>{locale === "hi" ? "साइज़ (क्लब)" : "Sizes (clubbed)"}</th>
              <th>{locale === "hi" ? "कितने" : "Count"}</th>
              <th>{locale === "hi" ? "रेट (₹)" : "Rate (₹)"}</th>
              <th>{locale === "hi" ? "अनुमान" : "Estimate"}</th>
            </tr>
          </thead>
          <tbody>
            {groups.length === 0 ? (
              <tr>
                <td colSpan={6} className="text-[var(--ink-muted)]">
                  {t("common.empty")}
                </td>
              </tr>
            ) : (
              groups.map((g) => {
                const rate = rateValue(g);
                const dirty =
                  draft[g.key] !== undefined && draft[g.key] !== g.rate;
                const sampleWt =
                  g.sizes.find((s) => s.weightKg > 0)?.weightKg ?? 0;
                const estimate =
                  g.pricingMode === "bundle" && sampleWt > 0 && rate > 0
                    ? `${formatInr(rate * sampleWt, locale)} / bundle`
                    : rate > 0
                      ? formatInr(rate, locale)
                      : "—";
                const sizeList = g.sizes.map((s) => s.sizeLabel).join(", ");
                return (
                  <tr
                    key={g.key}
                    className={dirty ? "bg-[var(--surface-2)]" : undefined}
                  >
                    <td className="text-sm text-[var(--ink-muted)]">
                      {g.category}
                    </td>
                    <td className="font-medium">{g.productName}</td>
                    <td className="max-w-[280px] text-sm">{sizeList}</td>
                    <td className="text-sm">{g.sizes.length}</td>
                    <td>
                      <NumberField
                        className="tt-input w-28"
                        min={0}
                        step={0.01}
                        emptyAs={null}
                        value={rate}
                        onValueChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            [g.key]: typeof v === "number" ? v : 0,
                          }))
                        }
                      />
                    </td>
                    <td className="text-sm text-[var(--ink-muted)]">
                      {estimate}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
