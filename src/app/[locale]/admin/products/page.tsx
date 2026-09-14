"use client";

import { FormEvent, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { FilePick } from "@/components/FilePick";
import { NumberField } from "@/components/NumberField";
import { RichTextEditor, sanitizeHtml, stripHtml, hasRichContent } from "@/components/RichTextEditor";
import { categoryLabel } from "@/lib/categories";
import {
  getSizeColorStock,
  productStockSummary,
  setSizeColorStock,
} from "@/lib/inventory";
import { useDb, useSession } from "@/lib/hooks";
import { asLocalized, loc } from "@/lib/localized";
import { normalizeSizeKey } from "@/lib/media";
import {
  applySqftComputedRate,
  catalogFromRate,
  formatInr,
  isPackCountUnit,
  isSqftUnit,
  ratePerPacket,
  ratePerPiece,
  sqftPerPiece,
  sqftSizeLabel,
} from "@/lib/pricing";
import { autoFillLocalized } from "@/lib/translate-client";
import { uploadProductMedia } from "@/lib/upload-media";
import {
  deleteProduct,
  checkCapability,
  setProductHomePlacement,
  upsertCategory,
  upsertProduct,
} from "@/lib/store/db";
import type {
  CategoryDef,
  LocalizedString,
  Product,
  ProductCategory,
  ProductMedia,
  ProductVariation,
  UnitOfSale,
} from "@/lib/types";

/** Turn free-text into a URL-safe id, e.g. "Cotton Ropes" → "cotton_ropes". */
function slugifyCategory(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || `cat_${Math.random().toString(36).slice(2, 7)}`;
}

function blankVariation(
  product: Pick<
    Product,
    | "baseRate"
    | "baseWeightKg"
    | "code"
    | "unit"
    | "lengthFt"
    | "widthFt"
    | "pcsPerPacket"
    | "ratePerSqft"
  >
): ProductVariation {
  const lengthFt = product.lengthFt ?? 0;
  const widthFt = product.widthFt ?? 0;
  const sizeEn = isSqftUnit(product.unit)
    ? sqftSizeLabel(lengthFt, widthFt)
    : "";
  return {
    id: `var_${crypto.randomUUID()}`,
    label: { en: sizeEn || "Standard", hi: sizeEn || "स्टैंडर्ड" },
    size: { en: sizeEn, hi: sizeEn },
    sku: product.code ? `${product.code}-1` : "",
    rate: product.baseRate || 0,
    lengthFt: product.lengthFt,
    widthFt: product.widthFt,
    pcsPerPacket: product.pcsPerPacket,
    ratePerSqft: product.ratePerSqft ?? product.baseRate,
    weightKg: product.baseWeightKg ?? 1,
    stock: 0,
  };
}

/**
 * Bulk size lines — one per row:
 *   12x18
 *   15x18, 90
 *   18x24, 90, 18.5
 * Format: size[, rate][, weightKg]
 */
function parseBulkVariationLines(
  text: string,
  product: Pick<Product, "baseRate" | "baseWeightKg" | "code" | "variations">
): ProductVariation[] {
  const defaults = {
    rate:
      product.variations[product.variations.length - 1]?.rate ||
      product.baseRate ||
      0,
    weightKg:
      product.variations[product.variations.length - 1]?.weightKg ??
      product.baseWeightKg ??
      1,
  };
  const existing = new Set(
    product.variations.map((v) =>
      normalizeSizeKey(v.size?.en || v.label.en || "")
    )
  );
  const startIndex = product.variations.length;
  const out: ProductVariation[] = [];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(/[,|\t]/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) continue;
    const sizeEn = parts[0];
    const key = normalizeSizeKey(sizeEn);
    if (key && existing.has(key)) continue; // skip duplicates already on product
    if (key) existing.add(key);
    const rate =
      parts[1] !== undefined && parts[1] !== ""
        ? Number(parts[1])
        : defaults.rate;
    const weightKg =
      parts[2] !== undefined && parts[2] !== ""
        ? Number(parts[2])
        : defaults.weightKg;
    const n = startIndex + out.length + 1;
    out.push({
      id: `var_${crypto.randomUUID()}`,
      label: { en: sizeEn, hi: sizeEn },
      size: { en: sizeEn, hi: sizeEn },
      sku: product.code ? `${product.code}-${n}` : `SIZE-${n}`,
      rate: Number.isFinite(rate) ? rate : defaults.rate,
      weightKg: Number.isFinite(weightKg) ? weightKg : defaults.weightKg,
      stock: 0,
    });
  }
  return out;
}

function blankProduct(defaultCategory: string = "tarpaulin"): Product {
  const now = new Date().toISOString();
  const product: Product = {
    id: `prod_${crypto.randomUUID()}`,
    code: "",
    category: defaultCategory,
    itemName: { en: "", hi: "" },
    name: { en: "", hi: "" },
    description: { en: "", hi: "" },
    unit: "kg",
    baseRate: 0,
    baseWeightKg: 1,
    pricingMode: "bundle",
    gsm: undefined,
    thicknessMm: undefined,
    material: "",
    brand: "TT",
    hsnCode: "",
    minOrderQty: 1,
    variations: [],
    colors: [
      {
        id: `col_${crypto.randomUUID()}`,
        name: { en: "Blue", hi: "नीला" },
        hex: "#1d4ed8",
      },
    ],
    media: [
      {
        id: `m_${crypto.randomUUID()}`,
        type: "image",
        url: "https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=1200&q=80",
      },
    ],
    logoUrl:
      "https://images.unsplash.com/photo-1581094794329-c8112a89af12?w=200&h=200&fit=crop&q=80",
    active: true,
    featured: false,
    stock: 0,
    createdAt: now,
    updatedAt: now,
  };
  product.variations = [blankVariation(product)];
  return product;
}

function cloneForEdit(p: Product): Product {
  return structuredClone({
    ...p,
    name: asLocalized(p.name, p.code || "Product"),
    itemName: asLocalized(p.itemName, asLocalized(p.name, p.code || "").en),
    description: asLocalized(p.description, ""),
    colors: (p.colors || []).map((c, i) => ({
      ...c,
      name: asLocalized(c.name, `Color ${i + 1}`),
    })),
    variations: (p.variations || []).map((v) => ({
      ...v,
      label: asLocalized(v.label, v.sku || "Size"),
      size: asLocalized(v.size, asLocalized(v.label, v.sku || "Size").en),
      weightKg: v.weightKg ?? p.baseWeightKg ?? 0,
    })),
  });
}

/** New unsaved product copied from an existing one — open in editor to tweak & save. */
function duplicateProductForEdit(
  source: Product,
  existingCodes: string[]
): Product {
  const now = new Date().toISOString();
  const base = cloneForEdit(source);
  const varIdMap = new Map<string, string>();
  const colorIdMap = new Map<string, string>();

  const variations = (base.variations || []).map((v, i) => {
    const id = `var_${crypto.randomUUID()}`;
    varIdMap.set(v.id, id);
    return {
      ...v,
      id,
      sku: v.sku ? `${v.sku}-COPY` : `COPY-${i + 1}`,
      stock: 0,
      stockSecondary: 0,
    };
  });

  const colors = (base.colors || []).map((c) => {
    const id = `col_${crypto.randomUUID()}`;
    colorIdMap.set(c.id, id);
    return { ...c, id };
  });

  const media = (base.media || []).map((m) => ({
    ...m,
    id: `m_${crypto.randomUUID()}`,
  }));

  let stockMatrix: Record<string, number> | undefined;
  if (base.stockMatrix && Object.keys(base.stockMatrix).length) {
    stockMatrix = {};
    for (const key of Object.keys(base.stockMatrix)) {
      const [oldVar, oldCol = ""] = key.split("__");
      const nv = varIdMap.get(oldVar);
      const nc = oldCol ? colorIdMap.get(oldCol) : undefined;
      if (nv && nc) stockMatrix[`${nv}__${nc}`] = 0;
      else if (nv) stockMatrix[`${nv}__`] = 0;
    }
  }

  let minStockMatrix: Record<string, number> | undefined;
  if (base.minStockMatrix && Object.keys(base.minStockMatrix).length) {
    minStockMatrix = {};
    for (const [key, qty] of Object.entries(base.minStockMatrix)) {
      const [oldVar, oldCol = ""] = key.split("__");
      const nv = varIdMap.get(oldVar);
      const nc = oldCol ? colorIdMap.get(oldCol) : undefined;
      if (nv && nc) minStockMatrix[`${nv}__${nc}`] = qty;
      else if (nv) minStockMatrix[`${nv}__`] = qty;
    }
  }

  const taken = new Set(
    existingCodes.map((c) => c.trim().toUpperCase()).filter(Boolean)
  );
  let codeBase = (base.code || "PROD").trim() || "PROD";
  if (/[-_]COPY\d*$/i.test(codeBase)) {
    codeBase = codeBase.replace(/[-_]COPY\d*$/i, "");
  }
  let code = `${codeBase}-COPY`;
  let n = 2;
  while (taken.has(code.toUpperCase())) {
    code = `${codeBase}-COPY${n}`;
    n += 1;
  }

  const nameEn = (base.name?.en || "").trim();
  const nameHi = (base.name?.hi || "").trim();
  const itemEn = (base.itemName?.en || nameEn).trim();
  const itemHi = (base.itemName?.hi || nameHi).trim();

  return {
    ...base,
    id: `prod_${crypto.randomUUID()}`,
    code,
    name: {
      en: nameEn ? `${nameEn} (copy)` : "Copy",
      hi: nameHi ? `${nameHi} (कॉपी)` : nameEn ? `${nameEn} (कॉपी)` : "कॉपी",
    },
    itemName: {
      en: itemEn ? `${itemEn} (copy)` : "Copy",
      hi: itemHi ? `${itemHi} (कॉपी)` : itemEn ? `${itemEn} (कॉपी)` : "कॉपी",
    },
    variations,
    colors,
    media,
    stockMatrix,
    minStockMatrix,
    stock: 0,
    stockSecondary: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export default function AdminProductsPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [editing, setEditing] = useState<Product | null>(null);
  const [homeNew, setHomeNew] = useState(false);
  const [homePromo, setHomePromo] = useState(false);
  const [q, setQ] = useState("");
  const [bulkSizes, setBulkSizes] = useState("");
  const [bulkMsg, setBulkMsg] = useState("");
  const [catFilter, setCatFilter] = useState<ProductCategory | "all">("all");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaMsg, setMediaMsg] = useState("");
  const [showNewCategory, setShowNewCategory] = useState(false);
  const [newCategory, setNewCategory] = useState<{ en: string; hi: string }>({
    en: "",
    hi: "",
  });
  const [categoryError, setCategoryError] = useState("");

  const activeCategories = useMemo(
    () => (db?.categories ?? []).filter((c) => c.active),
    [db?.categories]
  );

  const handleCreateCategory = () => {
    setCategoryError("");
    const en = newCategory.en.trim();
    if (!en) {
      setCategoryError(
        locale === "hi"
          ? "श्रेणी का अंग्रेज़ी नाम ज़रूरी है"
          : "English name is required"
      );
      return;
    }
    let id = slugifyCategory(en);
    const existing = db?.categories ?? [];
    if (existing.some((c) => c.id === id)) {
      id = `${id}_${Math.random().toString(36).slice(2, 5)}`;
    }
    const dup = existing.find(
      (c) => c.name.en.trim().toLowerCase() === en.toLowerCase()
    );
    if (dup) {
      // Reuse the existing one instead of creating a duplicate.
      if (editing) setEditing({ ...editing, category: dup.id });
      setShowNewCategory(false);
      setNewCategory({ en: "", hi: "" });
      return;
    }
    const category: CategoryDef = {
      id,
      name: { en, hi: newCategory.hi.trim() || en },
      active: true,
    };
    upsertCategory(category);
    if (editing) setEditing({ ...editing, category: id });
    setShowNewCategory(false);
    setNewCategory({ en: "", hi: "" });
    refresh();
  };

  const rows = useMemo(() => {
    return (db?.products ?? []).filter((p) => {
      if (catFilter !== "all" && p.category !== catFilter) return false;
      const hay =
        `${p.code} ${loc(p.name, "en")} ${loc(p.name, "hi")} ${loc(p.itemName, "en")} ${loc(p.itemName, "hi")}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });
  }, [db, q, catFilter]);

  const hasVariations = !!editing && editing.variations.length > 0;
  const stockSummary = editing ? productStockSummary(editing) : null;

  const updateVariation = (
    index: number,
    patch: Partial<ProductVariation>
  ) => {
    if (!editing) return;
    const variations = [...editing.variations];
    variations[index] = { ...variations[index], ...patch };
    setEditing({ ...editing, variations });
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    setError("");
    setBusy(true);
    try {
      if (!editing.code.trim()) throw new Error("Product code is required");
      if (!editing.name.en.trim()) throw new Error("Product name is required");
      if (!editing.category) {
        throw new Error("Pick a category — or create one with '+ New category'");
      }
      if (!editing.variations.length) {
        throw new Error("Add at least one size / variation");
      }
      for (const v of editing.variations) {
        if (!v.label.en.trim() && !v.size?.en?.trim()) {
          throw new Error("Each variation needs a label or size");
        }
        if (!(v.rate > 0) && !isSqftUnit(editing.unit)) {
          throw new Error("Each variation needs a rate > 0");
        }
        if (isSqftUnit(editing.unit)) {
          const lengthFt = Number(v.lengthFt ?? editing.lengthFt) || 0;
          const widthFt = Number(v.widthFt ?? editing.widthFt) || 0;
          const pcs = Number(v.pcsPerPacket ?? editing.pcsPerPacket) || 0;
          const rps = Number(v.ratePerSqft ?? editing.ratePerSqft) || 0;
          if (!(lengthFt > 0) || !(widthFt > 0)) {
            throw new Error("Sq/ft sizes need length and width in feet");
          }
          if (!(pcs > 0)) {
            throw new Error("Sq/ft needs pieces per packet > 0");
          }
          if (!(rps > 0)) {
            throw new Error("Sq/ft needs ₹ per sqft > 0");
          }
        }
        const unitWt =
          v.weightKg != null && v.weightKg > 0
            ? v.weightKg
            : editing.baseWeightKg ?? 0;
        // pkt/pcs/sqft need pack weight for shipping; kg/jhal need it for billing
        if (
          (isPackCountUnit(editing.unit) ||
            editing.unit === "jhal" ||
            editing.unit === "kg" ||
            editing.pricingMode === "bundle") &&
          !(unitWt > 0)
        ) {
          throw new Error(
            isPackCountUnit(editing.unit)
              ? "Pkt/pc/sqft needs pack weight (kg) on each size — used for shipping"
              : "Each variation needs weight (kg) > 0"
          );
        }
      }

      // Sanitize the rich HTML on save and derive plain-text descriptions
      // so search, PDFs and legacy consumers still work.
      const htmlEnRaw = editing.descriptionHtml?.en ?? "";
      const htmlHiRaw = editing.descriptionHtml?.hi ?? "";
      const htmlEn = hasRichContent(htmlEnRaw) ? sanitizeHtml(htmlEnRaw) : "";
      const htmlHi = hasRichContent(htmlHiRaw) ? sanitizeHtml(htmlHiRaw) : "";
      const plainEn =
        (htmlEn ? stripHtml(htmlEn) : "") ||
        (editing.description?.en || "").trim();
      const plainHi =
        (htmlHi ? stripHtml(htmlHi) : "") ||
        (editing.description?.hi || "").trim();

      // Auto-translate empty Hindi — never crash save if translate fails / truncates
      const baseFields: LocalizedString[] = [
        editing.name || { en: "", hi: "" },
        {
          en: editing.itemName?.en || editing.name?.en || "",
          hi: editing.itemName?.hi || "",
        },
        { en: plainEn || "", hi: plainHi || "" },
        ...editing.variations.flatMap((v) => [
          {
            en: v.size?.en || v.label?.en || "",
            hi: v.size?.hi || "",
          },
          {
            en: v.label?.en || v.size?.en || "",
            hi: v.label?.hi || "",
          },
        ]),
        ...editing.colors.map((c) => c.name || { en: "", hi: "" }),
      ];
      let translated: LocalizedString[] = baseFields.map((f) => ({
        en: f.en || "",
        hi: f.hi || f.en || "",
      }));
      try {
        const filled = await autoFillLocalized(baseFields);
        if (Array.isArray(filled) && filled.length === baseFields.length) {
          translated = filled.map((f, idx) => ({
            en: f?.en || baseFields[idx]?.en || "",
            hi: f?.hi || f?.en || baseFields[idx]?.en || "",
          }));
        }
      } catch {
        /* keep fallback above */
      }
      const take = (idx: number, fallback: LocalizedString): LocalizedString => {
        const f = translated[idx];
        if (!f) return { en: fallback.en || "", hi: fallback.hi || fallback.en || "" };
        return {
          en: f.en || fallback.en || "",
          hi: f.hi || f.en || fallback.hi || fallback.en || "",
        };
      };
      let i = 0;
      const name = take(i++, editing.name || { en: "", hi: "" });
      const itemName = take(i++, {
        en: editing.itemName?.en || editing.name?.en || "",
        hi: editing.itemName?.hi || "",
      });
      const description = take(i++, {
        en: plainEn || "",
        hi: plainHi || "",
      });
      const variations = editing.variations.map((v) => {
        const size = take(i++, {
          en: v.size?.en || v.label?.en || "",
          hi: v.size?.hi || "",
        });
        const label = take(i++, {
          en: v.label?.en || v.size?.en || "",
          hi: v.label?.hi || "",
        });
        return {
          ...v,
          size,
          label: {
            en: label.en || size.en || v.label?.en || "",
            hi: label.hi || size.hi || label.en || "",
          },
        };
      });
      const colors = editing.colors.map((c) => ({
        ...c,
        name: take(i++, c.name || { en: "", hi: "" }),
      }));

      if (!name.en.trim()) {
        throw new Error("Product name is required");
      }

      const p: Product = {
        ...editing,
        pricingMode: isPackCountUnit(editing.unit)
          ? "pcs"
          : editing.unit === "jhal" || editing.unit === "kg"
            ? "bundle"
            : editing.pricingMode,
        name,
        itemName,
        description,
        descriptionHtml:
          htmlEn || htmlHi
            ? {
                en: htmlEn,
                hi: htmlHi || htmlEn,
              }
            : undefined,
        colors,
        variations: variations.map((v, idx) => {
          const row: ProductVariation = {
            ...v,
            label: {
              en: v.size?.en || v.label?.en || `${idx + 1}`,
              hi:
                v.size?.hi ||
                v.label?.hi ||
                v.size?.en ||
                v.label?.en ||
                `${idx + 1}`,
            },
            size: {
              en: v.size?.en || v.label?.en || `${idx + 1}`,
              hi:
                v.size?.hi ||
                v.label?.hi ||
                v.size?.en ||
                v.label?.en ||
                `${idx + 1}`,
            },
            sku: v.sku || `${editing.code}-V${idx + 1}`,
            rate: v.rate || editing.baseRate,
            weightKg:
              v.weightKg != null && v.weightKg > 0
                ? v.weightKg
                : editing.baseWeightKg ?? 1,
          };
          return isSqftUnit(editing.unit)
            ? applySqftComputedRate(editing, row)
            : row;
        }),
      };
      if (p.variations[0]) {
        p.baseRate = p.variations[0].rate;
        if (isSqftUnit(p.unit)) {
          p.ratePerSqft = p.variations[0].ratePerSqft;
          p.lengthFt = p.variations[0].lengthFt;
          p.widthFt = p.variations[0].widthFt;
          p.pcsPerPacket = p.variations[0].pcsPerPacket;
        }
      }
      if (session?.role === "super_admin") {
        p.featured = homeNew;
        upsertProduct(p);
        setProductHomePlacement(p.id, { homeNew, homePromo });
      } else {
        upsertProduct(p);
      }
      setEditing(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  if (!session || !checkCapability(session, db, "manage_products")) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {editing
              ? (db?.products ?? []).some((p) => p.id === editing.id)
                ? t("admin.editProduct")
                : editing.code?.includes("-COPY")
                  ? t("admin.duplicateProduct")
                  : t("admin.newProduct")
              : t("admin.products")}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {editing
              ? locale === "hi"
                ? "अंग्रेज़ी भरें — खाली हिंदी सेव पर अपने आप अनुवाद हो जाएगी।"
                : "Fill English — empty Hindi fields auto-translate on save."
              : t("admin.productListHint")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {editing ? (
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={() => {
                setEditing(null);
                setError("");
                setBulkSizes("");
                setBulkMsg("");
                setShowNewCategory(false);
                setNewCategory({ en: "", hi: "" });
                setCategoryError("");
              }}
            >
              {t("common.back")}
            </button>
          ) : (
            <>
                {session?.role === "super_admin" ? (
                <Link href="/admin/home" className="tt-btn tt-btn-outline">
                  {t("admin.homePage")}
                </Link>
                ) : null}
                <Link href="/admin/rates" className="tt-btn tt-btn-outline">
                  {t("admin.rates")}
                </Link>
              <button
                type="button"
                className="tt-btn tt-btn-dark"
                onClick={() => {
                  const firstCat = activeCategories[0]?.id ?? "";
                  setEditing(blankProduct(firstCat));
                  setHomeNew(false);
                  setHomePromo(false);
                  setBulkSizes("");
                  setBulkMsg("");
                  if (!firstCat) {
                    setShowNewCategory(true);
                  }
                }}
              >
                {t("admin.newProduct")}
              </button>
            </>
          )}
        </div>
      </div>

      {!editing ? (
        <>
          <div className="mt-4 flex flex-wrap gap-2">
            <input
              className="tt-input max-w-xs"
              placeholder={t("common.search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="tt-select max-w-[180px]"
              value={catFilter}
              onChange={(e) =>
                setCatFilter(e.target.value as ProductCategory | "all")
              }
            >
              <option value="all">{t("common.all")}</option>
              {(db?.categories ?? [])
                .filter((c) => c.active)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name?.[locale] || c.name?.en || c.id}
                  </option>
                ))}
            </select>
          </div>

          <div className="tt-panel mt-5 overflow-x-auto">
            <table className="tt-table min-w-[960px]">
              <thead>
                <tr>
                  <th>Category</th>
                  <th>Product</th>
                  <th>Sizes</th>
                  <th>Pricing</th>
                  <th>From rate</th>
                  <th>Stock</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const stock = productStockSummary(p);
                  const minRate = catalogFromRate(p);
                  return (
                    <tr key={p.id}>
                      <td>
                        {categoryLabel(db?.categories, p.category, locale)}
                      </td>
                      <td>
                        <div className="font-medium">{loc(p.name, locale, p.code)}</div>
                        <div className="font-mono text-xs text-[var(--ink-muted)]">
                          {p.code}
                          {p.gsm ? ` · ${p.gsm} GSM` : ""}
                        </div>
                      </td>
                      <td className="text-sm">
                        {p.variations.length
                          ? p.variations
                              .map(
                                (v) =>
                                  v.size?.[locale] ||
                                  v.label[locale] ||
                                  v.sku
                              )
                              .join(", ")
                          : "—"}
                      </td>
                      <td className="text-sm capitalize">
                        {p.unit === "sqft"
                          ? "₹/sqft → ₹/pkt"
                          : p.pricingMode === "bundle"
                            ? "rate × kg"
                            : "rate × qty"}
                      </td>
                      <td>{formatInr(minRate, locale)}</td>
                      <td className="text-sm">
                        {stock.bundles} bdl
                        <span className="block text-xs text-[var(--ink-muted)]">
                          {stock.secondary} {p.unit}
                          {stock.fromMatrix
                            ? " · size×color"
                            : stock.fromVariations
                              ? " · by size"
                              : ""}
                        </span>
                      </td>
                      <td className="space-x-2 whitespace-nowrap text-sm">
                        <button
                          type="button"
                          className="text-[var(--brand)]"
                          onClick={() => {
                            setEditing(cloneForEdit(p));
                            setHomeNew(
                              (db?.settings.homeNewProductIds ?? []).includes(
                                p.id
                              )
                            );
                            setHomePromo(
                              (db?.settings.homePromoProductIds ?? []).includes(
                                p.id
                              )
                            );
                          }}
                        >
                          {t("common.edit")}
                        </button>
                        <button
                          type="button"
                          className="text-[var(--brand-deep)]"
                          onClick={() => {
                            const codes = (db?.products ?? []).map((x) => x.code);
                            setEditing(duplicateProductForEdit(p, codes));
                            setHomeNew(false);
                            setHomePromo(false);
                            setBulkSizes("");
                            setBulkMsg("");
                            setError("");
                          }}
                        >
                          {t("common.duplicate")}
                        </button>
                        <button
                          type="button"
                          className="text-[var(--danger)]"
                          onClick={() => {
                            deleteProduct(p.id);
                            refresh();
                          }}
                        >
                          {t("common.delete")}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      {editing ? (
        <form onSubmit={onSave} className="tt-panel mt-6 space-y-6 p-5">
          {error ? (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-[var(--danger)]">
              {error}
            </p>
          ) : null}

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              1 · Category & names
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="tt-label">Category *</label>
                <div className="flex gap-2">
                  <select
                    className="tt-select flex-1"
                    value={editing.category}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "__new__") {
                        setShowNewCategory(true);
                        setCategoryError("");
                        return;
                      }
                      setEditing({
                        ...editing,
                        category: val as ProductCategory,
                      });
                    }}
                  >
                    {activeCategories.length ? null : (
                      <option value="">
                        {locale === "hi"
                          ? "कोई श्रेणी नहीं — नई बनाएँ"
                          : "No categories yet — create one"}
                      </option>
                    )}
                    {activeCategories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name?.[locale] || c.name?.en || c.id}
                      </option>
                    ))}
                    <option value="__new__">
                      {locale === "hi"
                        ? "+ नई श्रेणी बनाएँ…"
                        : "+ New category…"}
                    </option>
                  </select>
                  <button
                    type="button"
                    className="tt-btn tt-btn-outline whitespace-nowrap px-3"
                    onClick={() => {
                      setShowNewCategory((s) => !s);
                      setCategoryError("");
                    }}
                    aria-expanded={showNewCategory}
                    title={locale === "hi" ? "नई श्रेणी" : "New category"}
                  >
                    +
                  </button>
                </div>
                {showNewCategory ? (
                  <div className="mt-2 space-y-2 rounded-lg border border-dashed border-[var(--line)] bg-[var(--surface-2)] p-3">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                      {locale === "hi"
                        ? "नई श्रेणी जोड़ें"
                        : "Add a new category"}
                    </p>
                    <input
                      className="tt-input"
                      placeholder={
                        locale === "hi"
                          ? "अंग्रेज़ी नाम (जैसे Cotton Ropes)"
                          : "English name (e.g. Cotton Ropes)"
                      }
                      value={newCategory.en}
                      onChange={(e) =>
                        setNewCategory({ ...newCategory, en: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleCreateCategory();
                        }
                      }}
                      autoFocus
                    />
                    <input
                      className="tt-input"
                      placeholder={
                        locale === "hi"
                          ? "हिंदी नाम (वैकल्पिक — खाली छोड़ें तो अंग्रेज़ी नाम इस्तेमाल होगा)"
                          : "Hindi name (optional — falls back to English)"
                      }
                      value={newCategory.hi}
                      onChange={(e) =>
                        setNewCategory({ ...newCategory, hi: e.target.value })
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleCreateCategory();
                        }
                      }}
                    />
                    {categoryError ? (
                      <p className="text-xs text-[var(--danger)]">
                        {categoryError}
                      </p>
                    ) : null}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="tt-btn tt-btn-dark"
                        onClick={handleCreateCategory}
                      >
                        {locale === "hi" ? "श्रेणी जोड़ें" : "Add category"}
                      </button>
                      <button
                        type="button"
                        className="tt-btn tt-btn-outline"
                        onClick={() => {
                          setShowNewCategory(false);
                          setNewCategory({ en: "", hi: "" });
                          setCategoryError("");
                        }}
                      >
                        {t("common.cancel")}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
              <div>
                <label className="tt-label">Item name (EN)</label>
                <input
                  className="tt-input"
                  value={editing.itemName?.en ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      itemName: {
                        en: e.target.value,
                        hi: editing.itemName?.hi ?? "",
                      },
                    })
                  }
                  placeholder="e.g. HDPE Tarpaulin"
                />
              </div>
              <div>
                <label className="tt-label">Item name (HI)</label>
                <input
                  className="tt-input"
                  value={editing.itemName?.hi ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      itemName: {
                        en: editing.itemName?.en ?? "",
                        hi: e.target.value,
                      },
                    })
                  }
                />
              </div>
              <div>
                <label className="tt-label">Product code *</label>
                <input
                  className="tt-input"
                  value={editing.code}
                  onChange={(e) =>
                    setEditing({ ...editing, code: e.target.value })
                  }
                  required
                />
              </div>
              <div>
                <label className="tt-label">Product name (EN) *</label>
                <input
                  className="tt-input"
                  value={editing.name.en}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      name: { ...editing.name, en: e.target.value },
                    })
                  }
                  required
                />
              </div>
              <div>
                <label className="tt-label">
                  Product name (HI)
                  <span className="ml-1 text-xs font-normal text-[var(--ink-muted)]">
                    {locale === "hi" ? "(वैकल्पिक)" : "(optional)"}
                  </span>
                </label>
                <input
                  className="tt-input"
                  value={editing.name.hi}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      name: { ...editing.name, hi: e.target.value },
                    })
                  }
                  placeholder={
                    locale === "hi"
                      ? "खाली छोड़ें — सेव पर अपने आप अनुवाद हो जाएगा"
                      : "Leave blank — auto-translated on save"
                  }
                />
              </div>
              <div className="sm:col-span-3">
                <label className="tt-label">
                  Description (EN)
                  <span className="ml-1 text-xs font-normal text-[var(--ink-muted)]">
                    {locale === "hi"
                      ? "— इमेज/टेबल जोड़ सकते हैं"
                      : "— images & tables supported"}
                  </span>
                </label>
                <RichTextEditor
                  locale={locale}
                  value={editing.descriptionHtml?.en ?? editing.description.en}
                  placeholder={
                    locale === "hi"
                      ? "प्रोडक्ट की जानकारी…"
                      : "Product details…"
                  }
                  minHeight="12rem"
                  uploadImage={async (file) => {
                    const up = await uploadProductMedia(file);
                    if (up.type !== "image") {
                      throw new Error("Only images can be inserted here");
                    }
                    return up.url;
                  }}
                  onChange={(html) => {
                    setEditing({
                      ...editing,
                      descriptionHtml: {
                        en: html,
                        hi: editing.descriptionHtml?.hi ?? "",
                      },
                    });
                  }}
                />
              </div>
              <div className="sm:col-span-3">
                <label className="tt-label">
                  Description (HI)
                  <span className="ml-1 text-xs font-normal text-[var(--ink-muted)]">
                    {locale === "hi" ? "(वैकल्पिक)" : "(optional)"}
                  </span>
                </label>
                <RichTextEditor
                  locale={locale}
                  value={editing.descriptionHtml?.hi ?? editing.description.hi}
                  placeholder={
                    locale === "hi"
                      ? "खाली छोड़ें — सेव पर अनुवाद हो जाएगा"
                      : "Leave blank — auto-translated on save"
                  }
                  minHeight="10rem"
                  uploadImage={async (file) => {
                    const up = await uploadProductMedia(file);
                    if (up.type !== "image") {
                      throw new Error("Only images can be inserted here");
                    }
                    return up.url;
                  }}
                  onChange={(html) => {
                    setEditing({
                      ...editing,
                      descriptionHtml: {
                        en: editing.descriptionHtml?.en ?? "",
                        hi: html,
                      },
                    });
                  }}
                />
              </div>
            </div>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              2 · Pricing rules
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div>
                <label className="tt-label">Unit *</label>
                <select
                  className="tt-select"
                  value={editing.unit}
                  onChange={(e) => {
                    const unit = e.target.value as UnitOfSale;
                    setEditing({
                      ...editing,
                      unit,
                      // pkt/pcs/sqft = rate × qty; kg/jhal = rate × weight
                      ...(isPackCountUnit(unit)
                        ? { pricingMode: "pcs" as const }
                        : unit === "jhal" || unit === "kg"
                          ? { pricingMode: "bundle" as const }
                          : {}),
                    });
                  }}
                >
                  <option value="kg">kg</option>
                  <option value="pcs">pcs</option>
                  <option value="pkt">pkt/pc</option>
                  <option value="sqft">sq/ft</option>
                  <option value="jhal">jhal</option>
                </select>
              </div>
              <div>
                <label className="tt-label">Pricing mode *</label>
                <select
                  className="tt-select"
                  value={editing.pricingMode}
                  disabled={
                    editing.unit === "jhal" ||
                    isPackCountUnit(editing.unit) ||
                    editing.unit === "kg"
                  }
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      pricingMode: e.target.value as "bundle" | "pcs",
                    })
                  }
                >
                  <option value="bundle">
                    kg / jhal = rate × weight (kg)
                  </option>
                  <option value="pcs">
                    pkt / pcs / sqft = qty × packet or pc rate
                  </option>
                </select>
                {editing.unit === "jhal" ? (
                  <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                    Bill = rate × weighed kg. Shipping = ₹ per jhal (Admin →
                    Shipping), not the weight slab.
                  </p>
                ) : null}
                {editing.unit === "pkt" || editing.unit === "pcs" ? (
                  <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                    Bill = number of pcs × rate per pc. Shipping uses the pack
                    weight (kg) you set below × qty on the weight slab — not
                    weighed on the slip.
                  </p>
                ) : null}
                {isSqftUnit(editing.unit) ? (
                  <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                    Enter L × W (ft), pcs in a packet, and ₹/sqft. Bill is
                    packets × ₹/pkt. Shipping uses pack weight × packets.
                  </p>
                ) : null}
              </div>
              <div>
                <label className="tt-label">
                  {isSqftUnit(editing.unit)
                    ? "Default ₹ / sqft"
                    : "Default rate (₹)"}
                </label>
                <NumberField
                  className="tt-input"
                  emptyAs={null}
                  value={
                    isSqftUnit(editing.unit)
                      ? editing.ratePerSqft ?? editing.baseRate
                      : editing.baseRate
                  }
                  onValueChange={(v) =>
                    setEditing({
                      ...editing,
                      baseRate: typeof v === "number" ? v : 0,
                      ...(isSqftUnit(editing.unit)
                        ? { ratePerSqft: typeof v === "number" ? v : 0 }
                        : {}),
                    })
                  }
                />
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  Used for new sizes only
                </p>
              </div>
              <div>
                <label className="tt-label">
                  {isPackCountUnit(editing.unit)
                    ? "Pack weight for shipping (kg) *"
                    : "Default weight / bundle (kg)"}
                </label>
                <NumberField
                  className="tt-input"
                  step={0.1}
                  min={0}
                  emptyAs={null}
                  value={editing.baseWeightKg ?? 0}
                  onValueChange={(v) =>
                    setEditing({
                      ...editing,
                      baseWeightKg: typeof v === "number" ? v : 0,
                    })
                  }
                />
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  {isPackCountUnit(editing.unit)
                    ? "Per pack — bill is qty × rate; shipping uses this × qty on the weight slab"
                    : "Default for new sizes — existing size weights stay independent"}
                </p>
              </div>
              {isSqftUnit(editing.unit) ? (
                <>
                  <div>
                    <label className="tt-label">Default length (ft)</label>
                    <NumberField
                      className="tt-input"
                      min={0}
                      step={0.01}
                      emptyAs={null}
                      value={editing.lengthFt ?? ""}
                      onValueChange={(v) =>
                        setEditing({
                          ...editing,
                          lengthFt: v === "" ? undefined : v,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="tt-label">Default width (ft)</label>
                    <NumberField
                      className="tt-input"
                      min={0}
                      step={0.01}
                      emptyAs={null}
                      value={editing.widthFt ?? ""}
                      onValueChange={(v) =>
                        setEditing({
                          ...editing,
                          widthFt: v === "" ? undefined : v,
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="tt-label">Default pcs / packet</label>
                    <NumberField
                      className="tt-input"
                      min={0}
                      integer
                      emptyAs={null}
                      value={editing.pcsPerPacket ?? ""}
                      onValueChange={(v) =>
                        setEditing({
                          ...editing,
                          pcsPerPacket: v === "" ? undefined : v,
                        })
                      }
                    />
                  </div>
                </>
              ) : null}
              <div>
                <label className="tt-label">GSM</label>
                <NumberField
                  className="tt-input"
                  emptyAs={null}
                  value={editing.gsm ?? ""}
                  onValueChange={(v) =>
                    setEditing({
                      ...editing,
                      gsm: v === "" ? undefined : v,
                    })
                  }
                />
              </div>
              <div>
                <label className="tt-label">Brand</label>
                <input
                  className="tt-input"
                  value={editing.brand ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, brand: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="tt-label">HSN</label>
                <input
                  className="tt-input"
                  value={editing.hsnCode ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, hsnCode: e.target.value })
                  }
                />
              </div>
              <div>
                <label className="tt-label">Min order qty</label>
                <NumberField
                  className="tt-input"
                  integer
                  emptyAs={null}
                  value={editing.minOrderQty ?? 1}
                  onValueChange={(v) =>
                    setEditing({
                      ...editing,
                      minOrderQty: typeof v === "number" ? v : 1,
                    })
                  }
                  onBlur={() =>
                    setEditing({
                      ...editing,
                      minOrderQty: Math.max(1, editing.minOrderQty ?? 1),
                    })
                  }
                />
              </div>
              <div>
                <label className="tt-label">Reorder min (bundles)</label>
                <NumberField
                  className="tt-input"
                  min={0}
                  integer
                  emptyAs={null}
                  value={editing.minStockLevel ?? ""}
                  placeholder="Alert when at/below"
                  onValueChange={(v) =>
                    setEditing({
                      ...editing,
                      minStockLevel: v === "" ? undefined : v,
                    })
                  }
                />
              </div>
              <div>
                <label className="tt-label">Reorder target (fill-to)</label>
                <NumberField
                  className="tt-input"
                  min={0}
                  integer
                  emptyAs={null}
                  value={editing.reorderQty ?? ""}
                  placeholder="Defaults to min"
                  onValueChange={(v) =>
                    setEditing({
                      ...editing,
                      reorderQty: v === "" ? undefined : v,
                    })
                  }
                />
              </div>
              <div>
                <label className="tt-label">Lead time (days)</label>
                <NumberField
                  className="tt-input"
                  min={0}
                  integer
                  emptyAs={null}
                  value={editing.leadTimeDays ?? ""}
                  placeholder="Company default"
                  onValueChange={(v) =>
                    setEditing({
                      ...editing,
                      leadTimeDays: v === "" ? undefined : v,
                    })
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <label className="tt-label">Preferred supplier (auto PO)</label>
                <select
                  className="tt-select"
                  value={editing.preferredSupplierId ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      preferredSupplierId: e.target.value || undefined,
                    })
                  }
                >
                  <option value="">— none —</option>
                  {(db?.parties ?? [])
                    .filter((p) => p.active && p.type === "supplier")
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                </select>
              </div>
            </div>

            {!hasVariations ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="tt-label">Stock (bundles)</label>
                  <NumberField
                    className="tt-input"
                    integer
                    emptyAs={null}
                    value={editing.stock}
                    onValueChange={(v) =>
                      setEditing({
                        ...editing,
                        stock: typeof v === "number" ? v : 0,
                      })
                    }
                  />
                </div>
                <div>
                  <label className="tt-label">
                    Stock ({editing.unit === "kg" ? "kg" : "pcs"})
                  </label>
                  <NumberField
                    className="tt-input"
                    emptyAs={null}
                    value={editing.stockSecondary ?? ""}
                    placeholder="auto from bundles × wt"
                    onValueChange={(v) =>
                      setEditing({
                        ...editing,
                        stockSecondary: v === "" ? undefined : v,
                      })
                    }
                  />
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-4 py-3 text-sm">
                <p className="font-semibold text-[var(--ink)]">
                  {editing.colors.length
                    ? "Stock is per size × color (see matrix below)"
                    : "Stock is per size / variation"}
                </p>
                <p className="mt-1 text-[var(--ink-muted)]">
                  Total: {stockSummary?.bundles ?? 0} bundles ·{" "}
                  {stockSummary?.secondary ?? 0} {editing.unit}
                </p>
              </div>
            )}
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              3 · Media (photo / video)
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Take a photo, pick from this phone or PC, or paste a server / CDN URL.
            </p>

            <div className="mt-3 space-y-3 rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-4">
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[220px] flex-1">
                  <label className="tt-label">Logo URL (server)</label>
                  <input
                    className="tt-input"
                    value={editing.logoUrl ?? ""}
                    placeholder="https://… or /uploads/…"
                    onChange={(e) =>
                      setEditing({ ...editing, logoUrl: e.target.value })
                    }
                  />
                </div>
                <FilePick
                  kind="photo"
                  compact
                  busy={mediaBusy}
                  onPick={async (files) => {
                    const file = files[0];
                    if (!file || !editing) return;
                    setMediaBusy(true);
                    setMediaMsg("");
                    setError("");
                    try {
                      const up = await uploadProductMedia(file);
                      if (up.type !== "image") {
                        throw new Error("Logo must be an image");
                      }
                      setEditing({ ...editing, logoUrl: up.url });
                      setMediaMsg("Logo uploaded");
                    } catch (err) {
                      setError(
                        err instanceof Error ? err.message : "Upload failed"
                      );
                    } finally {
                      setMediaBusy(false);
                    }
                  }}
                />
              </div>
              {editing.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={editing.logoUrl}
                  alt="Logo preview"
                  className="h-20 w-20 rounded-lg border border-[var(--line)] object-cover bg-white"
                />
              ) : null}
            </div>

            <div className="mt-4 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-[var(--ink)]">
                  Gallery — photos & videos
                </p>
                <div className="flex flex-wrap gap-2">
                  <FilePick
                    kind="media"
                    multiple
                    camera
                    compact
                    busy={mediaBusy}
                    onPick={async (files) => {
                      if (!files.length || !editing) return;
                      setMediaBusy(true);
                      setMediaMsg("");
                      setError("");
                      const added: ProductMedia[] = [];
                      const errors: string[] = [];
                      let firstImageUrl = "";
                      for (const file of files) {
                        try {
                          const up = await uploadProductMedia(file);
                          if (up.type !== "image" && up.type !== "video") {
                            errors.push(`${file.name}: unsupported type`);
                            continue;
                          }
                          added.push({
                            id: `m_${crypto.randomUUID()}`,
                            type: up.type,
                            url: up.url,
                            alt: file.name,
                          });
                          if (!firstImageUrl && up.type === "image") {
                            firstImageUrl = up.url;
                          }
                        } catch (err) {
                          errors.push(
                            `${file.name}: ${
                              err instanceof Error ? err.message : "upload failed"
                            }`
                          );
                        }
                      }
                      if (added.length) {
                        setEditing({
                          ...editing,
                          media: [...editing.media, ...added],
                          logoUrl:
                            editing.logoUrl || firstImageUrl || editing.logoUrl,
                        });
                        setMediaMsg(
                          locale === "hi"
                            ? `${added.length} फ़ाइल जोड़ी गईं`
                            : `${added.length} file${added.length === 1 ? "" : "s"} uploaded`
                        );
                      }
                      if (errors.length) {
                        setError(errors.join(" · "));
                      }
                      setMediaBusy(false);
                    }}
                  />
                  <button
                    type="button"
                    className="tt-btn tt-btn-outline text-sm font-bold"
                    onClick={() => {
                      if (!editing) return;
                      const item: ProductMedia = {
                        id: `m_${crypto.randomUUID()}`,
                        type: "image",
                        url: "",
                      };
                      setEditing({
                        ...editing,
                        media: [...editing.media, item],
                      });
                    }}
                  >
                    + Add server URL
                  </button>
                </div>
              </div>

              {mediaMsg ? (
                <p className="text-sm font-semibold text-[var(--ok)]">
                  {mediaMsg}
                </p>
              ) : null}

              {!editing.media.length ? (
                <p className="text-sm text-[var(--ink-muted)]">
                  No media yet — take a photo, pick files, or add a URL.
                </p>
              ) : (
                <ul className="space-y-3">
                  {editing.media.map((m, idx) => (
                    <li
                      key={m.id}
                      className="rounded-xl border border-[var(--line)] bg-white p-3"
                    >
                      <div className="mb-1 text-xs font-semibold text-[var(--ink-muted)]">
                        #{idx + 1}
                        {idx === 0 ? (
                          <span className="ml-2 rounded bg-[var(--brand)]/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-[var(--brand-deep,var(--brand))]">
                            {locale === "hi" ? "कवर" : "Cover"}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="h-24 w-28 shrink-0 overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--surface-2)]">
                          {m.url && m.type === "video" ? (
                            <video
                              src={m.url}
                              className="h-full w-full object-cover"
                              muted
                              playsInline
                            />
                          ) : m.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={m.url}
                              alt=""
                              className="h-full w-full object-cover"
                            />
                          ) : (
                            <div className="flex h-full items-center justify-center text-xs text-[var(--ink-muted)]">
                              No preview
                            </div>
                          )}
                        </div>
                        <div className="min-w-[200px] flex-1 space-y-2">
                          <div className="flex flex-wrap gap-2">
                            <select
                              className="tt-select max-w-[140px] font-semibold"
                              value={m.type}
                              onChange={(e) => {
                                const type = e.target.value as
                                  | "image"
                                  | "video";
                                const media = [...editing.media];
                                media[idx] = { ...m, type };
                                setEditing({ ...editing, media });
                              }}
                            >
                              <option value="image">Photo</option>
                              <option value="video">Video</option>
                            </select>
                            <FilePick
                              kind="media"
                              camera={m.type !== "video"}
                              compact
                              busy={mediaBusy}
                              accept={
                                m.type === "video"
                                  ? "video/*"
                                  : "image/*,video/*"
                              }
                              onPick={async (files) => {
                                const file = files[0];
                                if (!file || !editing) return;
                                setMediaBusy(true);
                                setError("");
                                try {
                                  const up = await uploadProductMedia(file);
                                  if (up.type !== "image" && up.type !== "video") {
                                    throw new Error("Only images or videos allowed");
                                  }
                                  const media = [...editing.media];
                                  media[idx] = {
                                    ...m,
                                    type: up.type,
                                    url: up.url,
                                    alt: file.name,
                                  };
                                  setEditing({ ...editing, media });
                                  setMediaMsg("File replaced");
                                } catch (err) {
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : "Upload failed"
                                  );
                                } finally {
                                  setMediaBusy(false);
                                }
                              }}
                            />
                            <button
                              type="button"
                              className="tt-btn tt-btn-outline text-xs font-bold"
                              disabled={idx === 0}
                              onClick={() => {
                                if (idx === 0) return;
                                const media = [...editing.media];
                                [media[idx - 1], media[idx]] = [
                                  media[idx],
                                  media[idx - 1],
                                ];
                                setEditing({ ...editing, media });
                              }}
                              title={locale === "hi" ? "ऊपर ले जाएँ" : "Move up"}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="tt-btn tt-btn-outline text-xs font-bold"
                              disabled={idx === editing.media.length - 1}
                              onClick={() => {
                                if (idx >= editing.media.length - 1) return;
                                const media = [...editing.media];
                                [media[idx], media[idx + 1]] = [
                                  media[idx + 1],
                                  media[idx],
                                ];
                                setEditing({ ...editing, media });
                              }}
                              title={locale === "hi" ? "नीचे ले जाएँ" : "Move down"}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="tt-btn tt-btn-outline text-xs font-bold"
                              disabled={idx === 0}
                              onClick={() => {
                                if (idx === 0) return;
                                const media = [...editing.media];
                                const [item] = media.splice(idx, 1);
                                media.unshift(item);
                                setEditing({
                                  ...editing,
                                  media,
                                  logoUrl:
                                    item.type === "image" ? item.url : editing.logoUrl,
                                });
                              }}
                              title={locale === "hi" ? "पहले पर लगाएँ" : "Make cover"}
                            >
                              ⭐
                            </button>
                            <button
                              type="button"
                              className="tt-btn tt-btn-outline text-xs font-bold text-[var(--danger)]"
                              onClick={() => {
                                setEditing({
                                  ...editing,
                                  media: editing.media.filter(
                                    (_, i) => i !== idx
                                  ),
                                });
                              }}
                            >
                              {locale === "hi" ? "हटाएँ" : "Remove"}
                            </button>
                          </div>
                          <div>
                            <label className="tt-label">
                              Server / CDN URL
                            </label>
                            <input
                              className="tt-input"
                              value={m.url}
                              placeholder="https://… or /uploads/products/…"
                              onChange={(e) => {
                                const media = [...editing.media];
                                media[idx] = { ...m, url: e.target.value };
                                setEditing({
                                  ...editing,
                                  media,
                                  logoUrl:
                                    editing.logoUrl ||
                                    (m.type === "image"
                                      ? e.target.value
                                      : editing.logoUrl),
                                });
                              }}
                            />
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                  4 · Sizes / variations *
                </p>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  {isSqftUnit(editing.unit)
                    ? "₹/pc and ₹/pkt are computed from L × W × pcs/packet × ₹/sqft. Stock is packets."
                    : editing.pricingMode === "bundle"
                    ? "Price = rate × weight(kg) × qty. Weight per size; stock per size × color."
                    : "Price = rate × qty. Weight for shipping; stock per size × color."}
                </p>
              </div>
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                onClick={() =>
                  setEditing({
                    ...editing,
                    variations: [
                      ...editing.variations,
                      blankVariation(editing),
                    ],
                  })
                }
              >
                + Add size
              </button>
            </div>

            <div className="mt-3 rounded-xl border border-dashed border-[var(--line)] bg-[var(--surface-2)] p-4">
              <p className="text-sm font-semibold text-[var(--brand-deep)]">
                {locale === "hi"
                  ? "एक साथ कई साइज़ जोड़ें"
                  : "Bulk create sizes"}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {locale === "hi"
                  ? "हर लाइन = एक साइज़। फॉर्मेट: साइज़  या  साइज़, रेट  या  साइज़, रेट, वजन(kg)"
                  : "One size per line. Format: size  or  size, rate  or  size, rate, weightKg"}
              </p>
              <textarea
                className="tt-input mt-2 min-h-[110px] font-mono text-sm"
                placeholder={"12x18\n15x18, 90\n18x24, 90, 18.5"}
                value={bulkSizes}
                onChange={(e) => {
                  setBulkSizes(e.target.value);
                  setBulkMsg("");
                }}
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="tt-btn tt-btn-dark"
                  onClick={() => {
                    const created = parseBulkVariationLines(bulkSizes, editing);
                    if (!created.length) {
                      setBulkMsg(
                        locale === "hi"
                          ? "कम से कम एक लाइन लिखें"
                          : "Enter at least one size line"
                      );
                      return;
                    }
                    setEditing({
                      ...editing,
                      variations: [...editing.variations, ...created],
                    });
                    setBulkSizes("");
                    setBulkMsg(
                      locale === "hi"
                        ? `${created.length} साइज़ जोड़े गए — नीचे चेक करें फिर सेव करें`
                        : `Added ${created.length} size(s) — review below, then save product`
                    );
                  }}
                >
                  {locale === "hi" ? "साइज़ जोड़ें" : "Add these sizes"}
                </button>
                {bulkMsg ? (
                  <p className="text-sm text-[var(--brand-deep)]">{bulkMsg}</p>
                ) : null}
              </div>
            </div>

            <div className="mt-3 space-y-3">
              {editing.variations.map((v, i) => (
                <div
                  key={v.id}
                  className="rounded-xl border border-[var(--line)] bg-white p-4"
                >
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-[var(--brand-deep)]">
                      Size {i + 1}
                      {v.size?.en || v.label.en
                        ? ` · ${v.size?.en || v.label.en}`
                        : ""}
                    </p>
                    <button
                      type="button"
                      className="text-sm font-semibold text-[var(--danger)] disabled:opacity-40"
                      disabled={editing.variations.length <= 1}
                      onClick={() =>
                        setEditing({
                          ...editing,
                          variations: editing.variations.filter(
                            (x) => x.id !== v.id
                          ),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <label className="tt-label">Label (EN)</label>
                      <input
                        className="tt-input"
                        value={v.label.en}
                        onChange={(e) =>
                          updateVariation(i, {
                            label: { ...v.label, en: e.target.value },
                          })
                        }
                        placeholder="e.g. 12x18"
                      />
                    </div>
                    <div>
                      <label className="tt-label">Size (EN)</label>
                      <input
                        className="tt-input"
                        value={v.size?.en ?? ""}
                        onChange={(e) =>
                          updateVariation(i, {
                            size: {
                              en: e.target.value,
                              hi: v.size?.hi || e.target.value,
                            },
                          })
                        }
                        placeholder="12x18 ft"
                      />
                    </div>
                    <div>
                      <label className="tt-label">Size (HI)</label>
                      <input
                        className="tt-input"
                        value={v.size?.hi ?? ""}
                        onChange={(e) =>
                          updateVariation(i, {
                            size: {
                              en: v.size?.en || e.target.value,
                              hi: e.target.value,
                            },
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="tt-label">SKU</label>
                      <input
                        className="tt-input"
                        value={v.sku}
                        onChange={(e) =>
                          updateVariation(i, { sku: e.target.value })
                        }
                        placeholder={`${editing.code || "CODE"}-${i + 1}`}
                      />
                    </div>
                    <div>
                      <label className="tt-label">
                        {isSqftUnit(editing.unit) ? "Rate ₹ / sqft *" : "Rate (₹) *"}
                      </label>
                      <NumberField
                        className="tt-input"
                        min={0}
                        emptyAs={null}
                        value={
                          isSqftUnit(editing.unit)
                            ? v.ratePerSqft ?? editing.ratePerSqft ?? 0
                            : v.rate
                        }
                        onValueChange={(val) =>
                          updateVariation(i, isSqftUnit(editing.unit)
                            ? {
                                ratePerSqft:
                                  typeof val === "number" ? val : 0,
                              }
                            : {
                                rate: typeof val === "number" ? val : 0,
                              })
                        }
                      />
                    </div>
                    {isSqftUnit(editing.unit) ? (
                      <>
                        <div>
                          <label className="tt-label">Length (ft) *</label>
                          <NumberField
                            className="tt-input"
                            min={0}
                            step={0.01}
                            emptyAs={null}
                            value={v.lengthFt ?? editing.lengthFt ?? ""}
                            onValueChange={(val) => {
                              const lengthFt =
                                typeof val === "number" ? val : 0;
                              const widthFt =
                                v.widthFt ?? editing.widthFt ?? 0;
                              const sizeEn = sqftSizeLabel(lengthFt, widthFt);
                              updateVariation(i, {
                                lengthFt,
                                size: sizeEn
                                  ? { en: sizeEn, hi: sizeEn }
                                  : v.size,
                                label: sizeEn
                                  ? { en: sizeEn, hi: sizeEn }
                                  : v.label,
                              });
                            }}
                          />
                        </div>
                        <div>
                          <label className="tt-label">Width (ft) *</label>
                          <NumberField
                            className="tt-input"
                            min={0}
                            step={0.01}
                            emptyAs={null}
                            value={v.widthFt ?? editing.widthFt ?? ""}
                            onValueChange={(val) => {
                              const widthFt =
                                typeof val === "number" ? val : 0;
                              const lengthFt =
                                v.lengthFt ?? editing.lengthFt ?? 0;
                              const sizeEn = sqftSizeLabel(lengthFt, widthFt);
                              updateVariation(i, {
                                widthFt,
                                size: sizeEn
                                  ? { en: sizeEn, hi: sizeEn }
                                  : v.size,
                                label: sizeEn
                                  ? { en: sizeEn, hi: sizeEn }
                                  : v.label,
                              });
                            }}
                          />
                        </div>
                        <div>
                          <label className="tt-label">Pcs / packet *</label>
                          <NumberField
                            className="tt-input"
                            min={0}
                            integer
                            emptyAs={null}
                            value={
                              v.pcsPerPacket ?? editing.pcsPerPacket ?? ""
                            }
                            onValueChange={(val) =>
                              updateVariation(i, {
                                pcsPerPacket:
                                  typeof val === "number" ? val : 0,
                              })
                            }
                          />
                        </div>
                      </>
                    ) : null}
                    <div>
                      <label className="tt-label">
                        Weight / bundle (kg)
                        {editing.pricingMode === "bundle" ? " *" : ""}
                      </label>
                      <NumberField
                        className="tt-input"
                        step={0.1}
                        min={0}
                        emptyAs={null}
                        value={v.weightKg ?? 0}
                        onValueChange={(val) =>
                          updateVariation(i, {
                            weightKg: typeof val === "number" ? val : 0,
                            stockSecondary: undefined,
                          })
                        }
                      />
                    </div>
                    <div>
                      <label className="tt-label">Reorder min (size)</label>
                      <NumberField
                        className="tt-input"
                        min={0}
                        integer
                        emptyAs={null}
                        value={v.minStockLevel ?? ""}
                        placeholder="Alert when ≤"
                        onValueChange={(val) =>
                          updateVariation(i, {
                            minStockLevel: val === "" ? undefined : val,
                          })
                        }
                      />
                    </div>
                    {!editing.colors.length ? (
                      <>
                        <div>
                          <label className="tt-label">Stock (bundles)</label>
                          <NumberField
                            className="tt-input"
                            min={0}
                            integer
                            emptyAs={null}
                            value={v.stock}
                            onValueChange={(val) =>
                              updateVariation(i, {
                                stock: typeof val === "number" ? val : 0,
                                stockSecondary: undefined,
                              })
                            }
                          />
                        </div>
                        <div>
                          <label className="tt-label">
                            Stock ({editing.unit === "kg" ? "kg" : "pcs"})
                          </label>
                          <NumberField
                            className="tt-input"
                            min={0}
                            emptyAs={null}
                            value={v.stockSecondary ?? ""}
                            placeholder="auto"
                            onValueChange={(val) =>
                              updateVariation(i, {
                                stockSecondary:
                                  val === "" ? undefined : val,
                              })
                            }
                          />
                        </div>
                      </>
                    ) : (
                      <div className="sm:col-span-2">
                        <p className="tt-label">Stock (size total)</p>
                        <p className="text-sm text-[var(--ink-muted)]">
                          {v.stock || 0} bundles — edit in size × color matrix
                          below
                        </p>
                      </div>
                    )}
                  </div>
                  {isSqftUnit(editing.unit) ? (
                    <p className="mt-2 text-xs text-[var(--ink-muted)]">
                      {(() => {
                        const lengthFt = v.lengthFt ?? editing.lengthFt ?? 0;
                        const widthFt = v.widthFt ?? editing.widthFt ?? 0;
                        const pcs = v.pcsPerPacket ?? editing.pcsPerPacket ?? 0;
                        const rps =
                          v.ratePerSqft ?? editing.ratePerSqft ?? 0;
                        const sqft = sqftPerPiece(lengthFt, widthFt);
                        const pc = ratePerPiece(rps, lengthFt, widthFt);
                        const pkt = ratePerPacket(
                          rps,
                          lengthFt,
                          widthFt,
                          pcs
                        );
                        if (!(sqft > 0 && pcs > 0 && rps > 0)) {
                          return "Enter L, W, pcs/packet and ₹/sqft to see ₹/pc and ₹/pkt.";
                        }
                        return `${sqftSizeLabel(lengthFt, widthFt)} = ${sqft} sqft/pc · ${formatInr(pc, locale)}/pc · ${formatInr(pkt, locale)}/pkt${
                          (v.weightKg ?? 0) > 0
                            ? ` · pack ${v.weightKg} kg (shipping)`
                            : ""
                        }`;
                      })()}
                    </p>
                  ) : v.rate > 0 && (v.weightKg ?? 0) > 0 ? (
                    <p className="mt-2 text-xs text-[var(--ink-muted)]">
                      {editing.pricingMode === "bundle"
                        ? `1 bundle ≈ ${formatInr(v.rate * (v.weightKg || 0), locale)} (${formatInr(v.rate, locale)} × ${v.weightKg} kg)`
                        : `1 pc = ${formatInr(v.rate, locale)} · wt ${v.weightKg} kg (shipping)`}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                5 · Colors
              </p>
              <button
                type="button"
                className="text-sm font-semibold text-[var(--brand)]"
                onClick={() =>
                  setEditing({
                    ...editing,
                    colors: [
                      ...editing.colors,
                      {
                        id: `col_${crypto.randomUUID()}`,
                        name: { en: "New", hi: "नया" },
                        hex: "#166534",
                      },
                    ],
                  })
                }
              >
                + Color
              </button>
            </div>
            <div className="mt-2 space-y-3">
              {editing.colors.map((c, i) => (
                <div
                  key={c.id}
                  className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)] p-3"
                >
                  <div className="grid gap-2 sm:grid-cols-[1fr_1fr_80px_auto]">
                    <input
                      className="tt-input"
                      placeholder="Color EN"
                      value={c.name?.en || ""}
                      onChange={(e) => {
                        const colors = [...editing.colors];
                        colors[i] = {
                          ...c,
                          name: {
                            en: e.target.value,
                            hi: c.name?.hi || "",
                          },
                        };
                        setEditing({ ...editing, colors });
                      }}
                    />
                    <input
                      className="tt-input"
                      placeholder="Color HI"
                      value={c.name?.hi || ""}
                      onChange={(e) => {
                        const colors = [...editing.colors];
                        colors[i] = {
                          ...c,
                          name: {
                            en: c.name?.en || "",
                            hi: e.target.value,
                          },
                        };
                        setEditing({ ...editing, colors });
                      }}
                    />
                    <input
                      className="tt-input h-10"
                      type="color"
                      value={c.hex}
                      onChange={(e) => {
                        const colors = [...editing.colors];
                        colors[i] = { ...c, hex: e.target.value };
                        setEditing({ ...editing, colors });
                      }}
                    />
                    <button
                      type="button"
                      className="text-sm font-semibold text-[var(--danger)] disabled:opacity-40"
                      disabled={editing.colors.length <= 1}
                      onClick={() =>
                        setEditing({
                          ...editing,
                          colors: editing.colors.filter((x) => x.id !== c.id),
                        })
                      }
                    >
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    {c.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={c.imageUrl}
                        alt=""
                        className="h-14 w-14 rounded-lg border border-[var(--line)] object-cover"
                      />
                    ) : (
                      <span
                        className="inline-block h-14 w-14 rounded-lg border border-[var(--line)]"
                        style={{ background: c.hex }}
                        title="Hex swatch"
                      />
                    )}
                    <FilePick
                      kind="photo"
                      compact
                      busy={busy}
                      onPick={async (files) => {
                        const file = files[0];
                        if (!file) return;
                        try {
                          setBusy(true);
                          setError("");
                          const up = await uploadProductMedia(file);
                          const colors = [...editing.colors];
                          colors[i] = { ...c, imageUrl: up.url };
                          setEditing({ ...editing, colors });
                        } catch (err) {
                          setError(
                            err instanceof Error
                              ? err.message
                              : "Upload failed"
                          );
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                    {c.imageUrl ? (
                      <button
                        type="button"
                        className="text-sm font-semibold text-[var(--danger)]"
                        onClick={() => {
                          const colors = [...editing.colors];
                          colors[i] = { ...c, imageUrl: undefined };
                          setEditing({ ...editing, colors });
                        }}
                      >
                        {locale === "hi" ? "फ़ोटो हटाएँ" : "Remove photo"}
                      </button>
                    ) : (
                      <span className="text-xs text-[var(--ink-muted)]">
                        {locale === "hi"
                          ? "वैकल्पिक — रंग का सैंपल फ़ोटो"
                          : "Optional — sample photo for this color"}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {editing.variations.length > 0 && editing.colors.length > 0 ? (
            <>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                  6 · Stock matrix (size × color)
                </p>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  Each cell = bundles available for that size and color.
                </p>
                <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--line)]">
                  <table className="tt-table min-w-[480px] text-sm">
                    <thead>
                      <tr>
                        <th>Size</th>
                        {editing.colors.map((c) => (
                          <th key={c.id}>
                            <span className="inline-flex items-center gap-1.5">
                              {c.imageUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={c.imageUrl}
                                  alt=""
                                  className="h-6 w-6 rounded-full border object-cover"
                                />
                              ) : (
                                <span
                                  className="inline-block h-2.5 w-2.5 rounded-full border"
                                  style={{ background: c.hex }}
                                />
                              )}
                              {loc(c.name, locale, `Color`)}
                            </span>
                          </th>
                        ))}
                        <th>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editing.variations.map((v) => (
                        <tr key={v.id}>
                          <td className="font-medium whitespace-nowrap">
                            {v.size?.[locale] || v.label[locale] || v.sku}
                          </td>
                          {editing.colors.map((c) => (
                            <td key={c.id}>
                              <NumberField
                                min={0}
                                integer
                                emptyAs={null}
                                className="tt-input w-20 px-2 text-center"
                                value={getSizeColorStock(editing, v.id, c.id)}
                                onValueChange={(val) => {
                                  const next = structuredClone(editing);
                                  setSizeColorStock(
                                    next,
                                    v.id,
                                    c.id,
                                    typeof val === "number" ? val : 0
                                  );
                                  setEditing(next);
                                }}
                              />
                            </td>
                          ))}
                          <td className="tabular-nums font-semibold">
                            {v.stock || 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                  6b · Reorder mins (size × color)
                </p>
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  Optional. When set, alerts use these cells instead of size /
                  product mins. Leave blank to ignore that SKU.
                </p>
                <div className="mt-3 overflow-x-auto rounded-xl border border-[var(--line)]">
                  <table className="tt-table min-w-[480px] text-sm">
                    <thead>
                      <tr>
                        <th>Size</th>
                        {editing.colors.map((c) => (
                          <th key={c.id}>
                            {loc(c.name, locale, `Color`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {editing.variations.map((v) => (
                        <tr key={v.id}>
                          <td className="font-medium whitespace-nowrap">
                            {v.size?.[locale] || v.label[locale] || v.sku}
                          </td>
                          {editing.colors.map((c) => {
                            const key = `${v.id}__${c.id}`;
                            const val = editing.minStockMatrix?.[key];
                            return (
                              <td key={c.id}>
                                <NumberField
                                  min={0}
                                  integer
                                  emptyAs={null}
                                  className="tt-input w-20 px-2 text-center"
                                  value={val ?? ""}
                                  placeholder="—"
                                  onValueChange={(n) => {
                                    const next = structuredClone(editing);
                                    const matrix = {
                                      ...(next.minStockMatrix || {}),
                                    };
                                    if (n === "") {
                                      delete matrix[key];
                                    } else {
                                      matrix[key] = n;
                                    }
                                    next.minStockMatrix = Object.keys(matrix)
                                      .length
                                      ? matrix
                                      : undefined;
                                    setEditing(next);
                                  }}
                                />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          ) : null}

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={editing.active}
              onChange={(e) =>
                setEditing({ ...editing, active: e.target.checked })
              }
            />
            Active on store
          </label>
          {session.role === "super_admin" ? (
            <>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={homeNew}
              onChange={(e) => setHomeNew(e.target.checked)}
            />
            {t("admin.showOnHomeNew")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={homePromo}
              onChange={(e) => setHomePromo(e.target.checked)}
            />
            {t("admin.showOnHomePromo")}
          </label>
            </>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              className="tt-btn tt-btn-dark"
              disabled={busy}
            >
              {busy
                ? locale === "hi"
                  ? "अनुवाद व सेव…"
                  : "Translating & saving…"
                : t("common.save")}
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              disabled={busy}
              onClick={() => {
                setEditing(null);
                setError("");
              }}
            >
              {t("common.cancel")}
            </button>
          </div>
        </form>
      ) : null}
    </AdminShell>
  );
}
