"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { NumberField } from "@/components/NumberField";
import { ProductImage } from "@/components/ProductImage";
import { useDb } from "@/lib/hooks";
import {
  calcLineTotal,
  formatInr,
  resolveRate,
  resolveWeightKg,
  roundMoney,
  roundOffRupees,
  variationDisplayLabel,
} from "@/lib/pricing";
import { getSizeColorStock } from "@/lib/inventory";
import {
  calcShipping,
  countOrderJhals,
  getCart,
  saveCart,
  shippingWeightExcludingJhal,
} from "@/lib/store/db";
import type { CartItem, Product, ProductVariation } from "@/lib/types";

interface QuickRow {
  id: string;
  productId: string;
  variationId: string;
  colorId: string;
  quantity: number;
}

function productThumb(product: Product): string {
  return (
    product.logoUrl ||
    product.media?.find((m) => m.type === "image" && m.url)?.url ||
    ""
  );
}

function rateUnitSuffix(product: Product, locale: "en" | "hi"): string {
  if (product.pricingMode === "bundle") return locale === "hi" ? "/किग्रा" : "/kg";
  return locale === "hi" ? "/पीस" : "/pc";
}

/** Lowest–highest rate for list display (₹ / kg or / pc). */
function productRateLabel(product: Product, locale: "en" | "hi"): string {
  const rates = (
    product.variations.length
      ? product.variations.map((v) => resolveRate(product, v))
      : [resolveRate(product, undefined)]
  ).filter((r) => r > 0);
  if (!rates.length) return "—";
  const min = Math.min(...rates);
  const max = Math.max(...rates);
  const unit = rateUnitSuffix(product, locale);
  if (min === max) return `${formatInr(min, locale)}${unit}`;
  return `${formatInr(min, locale)}–${formatInr(max, locale)}${unit}`;
}

/** Code, names, size labels and colour names — so "12x18" or "blue" match. */
function productHaystack(product: Product): string {
  const parts: (string | undefined)[] = [
    product.code,
    product.name?.en,
    product.name?.hi,
    product.itemName?.en,
    product.itemName?.hi,
    product.brand,
    product.material,
  ];
  for (const v of product.variations ?? []) {
    parts.push(v.sku, v.label?.en, v.label?.hi, v.size?.en, v.size?.hi);
  }
  for (const c of product.colors ?? []) {
    parts.push(c.name?.en, c.name?.hi);
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function productTotalStock(product: Product): number {
  if (!product.variations?.length) {
    return Math.max(0, product.stock || 0);
  }
  if (!product.colors?.length) {
    return product.variations.reduce(
      (s, v) => s + Math.max(0, getSizeColorStock(product, v.id, undefined)),
      0
    );
  }
  let total = 0;
  for (const v of product.variations) {
    for (const c of product.colors) {
      total += Math.max(0, getSizeColorStock(product, v.id, c.id));
    }
  }
  return total;
}

function variationStockForColor(
  product: Product,
  variationId: string,
  colorId?: string
): number {
  if (colorId) return getSizeColorStock(product, variationId, colorId);
  if (!product.colors?.length) {
    return getSizeColorStock(product, variationId, undefined);
  }
  return product.colors.reduce(
    (s, c) => s + Math.max(0, getSizeColorStock(product, variationId, c.id)),
    0
  );
}

function sortedVariations(product: Product, colorId?: string) {
  return [...product.variations].sort((a, b) => {
    const saColor = colorId
      ? getSizeColorStock(product, a.id, colorId)
      : variationStockForColor(product, a.id);
    const sbColor = colorId
      ? getSizeColorStock(product, b.id, colorId)
      : variationStockForColor(product, b.id);
    const saTotal = variationStockForColor(product, a.id);
    const sbTotal = variationStockForColor(product, b.id);
    if (saColor > 0 !== sbColor > 0) return saColor > 0 ? -1 : 1;
    if (saTotal > 0 !== sbTotal > 0) return saTotal > 0 ? -1 : 1;
    return sbTotal - saTotal || sbColor - saColor;
  });
}

function sortedColors(product: Product, variationId?: string) {
  return [...product.colors].sort((a, b) => {
    const sa = getSizeColorStock(product, variationId, a.id);
    const sb = getSizeColorStock(product, variationId, b.id);
    if (sa > 0 !== sb > 0) return sa > 0 ? -1 : 1;
    return sb - sa;
  });
}

function pickInStockDefaults(product: Product): {
  variationId: string;
  colorId: string;
} {
  const colors = product.colors ?? [];
  const variations = sortedVariations(product);
  for (const v of variations) {
    if (!colors.length) {
      if (variationStockForColor(product, v.id) > 0) {
        return { variationId: v.id, colorId: "" };
      }
      continue;
    }
    for (const c of sortedColors(product, v.id)) {
      if (getSizeColorStock(product, v.id, c.id) > 0) {
        return { variationId: v.id, colorId: c.id };
      }
    }
  }
  return {
    variationId: variations[0]?.id ?? "",
    colorId: colors[0]?.id ?? "",
  };
}

function maxBundlesForRow(
  product: Product,
  variation: ProductVariation | undefined,
  colorId: string | undefined,
  rows: QuickRow[],
  rowId: string
): number {
  const vid = variation?.id ?? "";
  const cid = colorId || product.colors[0]?.id || "";
  const stock = getSizeColorStock(product, vid || undefined, cid || undefined);
  const inOtherRows = rows
    .filter(
      (r) =>
        r.id !== rowId &&
        r.productId === product.id &&
        (r.variationId || "") === vid &&
        (r.colorId || "") === cid
    )
    .reduce((s, r) => s + Math.max(0, r.quantity || 0), 0);
  return Math.max(0, stock - inOtherRows);
}

function clampQty(
  product: Product,
  variationId: string,
  colorId: string,
  rows: QuickRow[],
  rowId: string,
  requested: number
): number {
  const variation =
    product.variations.find((v) => v.id === variationId) ??
    product.variations[0];
  const maxQty = maxBundlesForRow(product, variation, colorId, rows, rowId);
  if (maxQty <= 0) return 0;
  const minQty = Math.min(product.minOrderQty ?? 1, maxQty);
  const n = Number.isFinite(requested) ? Math.trunc(requested) : minQty;
  if (n <= 0) return 0;
  return Math.min(maxQty, Math.max(minQty, n));
}

function rowsToCartItems(
  computed: Array<{
    product?: Product;
    variation?: ProductVariation;
    color?: { id: string };
    row: QuickRow;
    qty?: number;
    weightKg?: number;
  }>
): CartItem[] {
  const cart: CartItem[] = [];
  for (const c of computed) {
    if (!c.product || !c.variation) continue;
    const qty = c.qty ?? 0;
    if (qty <= 0) continue;
    const colorId = c.color?.id ?? c.row.colorId ?? "";
    const key = `${c.product.id}:${c.variation.id}:${colorId}`;
    const existing = cart.find((x) => x.key === key);
    if (existing) {
      existing.quantity += qty;
      existing.weightKg = resolveWeightKg(
        c.product,
        c.variation,
        existing.quantity
      );
    } else {
      cart.push({
        key,
        productId: c.product.id,
        variationId: c.variation.id,
        colorId: colorId || undefined,
        quantity: qty,
        weightKg: c.weightKg ?? 0,
      });
    }
  }
  return cart;
}

export default function QuickOrderPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const router = useRouter();
  const { db } = useDb();
  const [rows, setRows] = useState<QuickRow[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [sheetProductId, setSheetProductId] = useState<string | null>(null);
  const [sheetVariationId, setSheetVariationId] = useState("");
  const [sheetColorId, setSheetColorId] = useState("");
  const [sheetQty, setSheetQty] = useState(1);
  const summaryRef = useRef<HTMLElement | null>(null);

  const products = useMemo(() => {
    if (!db) return [];
    return db.products.filter((p) => p.active);
  }, [db]);

  /** Search text + total stock computed once per catalog change. */
  const productIndex = useMemo(
    () =>
      products.map((product) => ({
        product,
        stock: productTotalStock(product),
        hay: productHaystack(product),
      })),
    [products]
  );

  useEffect(() => {
    if (!db || hydrated) return;
    const cart = getCart();
    /* eslint-disable react-hooks/set-state-in-effect */
    if (cart.length) {
      setRows(
        cart.map((c) => ({
          id: crypto.randomUUID(),
          productId: c.productId,
          variationId: c.variationId || "",
          colorId: c.colorId || "",
          quantity: c.quantity,
        }))
      );
    }
    setHydrated(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [db, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const onCartCleared = () => {
      if (getCart().length === 0) setRows([]);
    };
    window.addEventListener("tt-cart-updated", onCartCleared);
    return () => window.removeEventListener("tt-cart-updated", onCartCleared);
  }, [hydrated]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return productIndex
      .filter(({ stock, hay }) => {
        if (!showOutOfStock && stock <= 0) return false;
        if (!q) return true;
        return hay.includes(q);
      })
      .sort((a, b) => {
        if (a.stock > 0 !== b.stock > 0) return a.stock > 0 ? -1 : 1;
        return b.stock - a.stock;
      });
  }, [productIndex, query, showOutOfStock]);

  const sheetProduct = sheetProductId
    ? products.find((p) => p.id === sheetProductId)
    : undefined;

  const sheetVariations = useMemo(() => {
    if (!sheetProduct) return [];
    const list = sortedVariations(sheetProduct, sheetColorId || undefined);
    if (showOutOfStock) return list;
    return list.filter(
      (v) =>
        variationStockForColor(
          sheetProduct,
          v.id,
          sheetColorId || undefined
        ) > 0
    );
  }, [sheetProduct, sheetColorId, showOutOfStock]);

  const sheetColors = useMemo(() => {
    if (!sheetProduct?.colors?.length) return [];
    const list = sortedColors(sheetProduct, sheetVariationId || undefined);
    if (showOutOfStock) return list;
    return list.filter(
      (c) =>
        getSizeColorStock(sheetProduct, sheetVariationId || undefined, c.id) >
        0
    );
  }, [sheetProduct, sheetVariationId, showOutOfStock]);

  const sheetVariation = sheetProduct
    ? sheetProduct.variations.find((v) => v.id === sheetVariationId) ??
      sheetProduct.variations[0]
    : undefined;

  const sheetStock = sheetProduct
    ? getSizeColorStock(
        sheetProduct,
        sheetVariationId || undefined,
        sheetColorId || undefined
      )
    : 0;

  const sheetMax = sheetProduct
    ? maxBundlesForRow(
        sheetProduct,
        sheetVariation,
        sheetColorId,
        rows,
        "__sheet__"
      )
    : 0;

  const sheetMinQty = sheetProduct
    ? Math.min(sheetProduct.minOrderQty ?? 1, sheetMax || 1)
    : 1;

  const sheetRate = sheetProduct ? resolveRate(sheetProduct, sheetVariation) : 0;
  const sheetWeight =
    sheetProduct && sheetQty > 0
      ? resolveWeightKg(sheetProduct, sheetVariation, sheetQty)
      : 0;
  const sheetTotal =
    sheetProduct && sheetQty > 0
      ? calcLineTotal({
          pricingMode: sheetProduct.pricingMode,
          rate: sheetRate,
          quantity: sheetQty,
          weightKg: sheetWeight,
        })
      : 0;

  const closeSheet = () => setSheetProductId(null);

  // Lock page scroll and allow Escape while the picker sheet is open.
  useEffect(() => {
    if (!sheetProductId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSheetProductId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
    };
  }, [sheetProductId]);

  /** Re-clamp sheet qty for a specific size/colour pair (never stale state). */
  const syncSheetQty = (
    product: Product,
    variationId: string,
    colorId: string
  ) => {
    const max = maxBundlesForRow(
      product,
      product.variations.find((v) => v.id === variationId),
      colorId,
      rows,
      "__sheet__"
    );
    if (max <= 0) {
      setSheetQty(0);
      return;
    }
    const min = Math.min(product.minOrderQty ?? 1, max);
    setSheetQty((prev) => Math.min(max, Math.max(min || 1, prev || min || 1)));
  };

  const openSheet = (product: Product) => {
    const defaults = pickInStockDefaults(product);
    setSheetProductId(product.id);
    setSheetVariationId(defaults.variationId);
    setSheetColorId(defaults.colorId);
    setSheetQty(1);
    syncSheetQty(product, defaults.variationId, defaults.colorId);
    setError("");
    setNote("");
  };

  const selectSheetVariation = (variationId: string) => {
    if (!sheetProduct) return;
    let nextColor = sheetColorId;
    const colors = sortedColors(sheetProduct, variationId).filter(
      (c) =>
        showOutOfStock ||
        getSizeColorStock(sheetProduct, variationId, c.id) > 0
    );
    if (colors.length && !colors.some((c) => c.id === nextColor)) {
      nextColor = colors[0].id;
    }
    setSheetVariationId(variationId);
    setSheetColorId(nextColor);
    syncSheetQty(sheetProduct, variationId, nextColor);
  };

  const selectSheetColor = (colorId: string) => {
    if (!sheetProduct) return;
    let nextVariation = sheetVariationId;
    const vars = sortedVariations(sheetProduct, colorId).filter(
      (v) =>
        showOutOfStock || getSizeColorStock(sheetProduct, v.id, colorId) > 0
    );
    if (vars.length && !vars.some((v) => v.id === nextVariation)) {
      nextVariation = vars[0].id;
    }
    setSheetColorId(colorId);
    setSheetVariationId(nextVariation);
    syncSheetQty(sheetProduct, nextVariation, colorId);
  };

  const addFromSheet = () => {
    if (!sheetProduct) return;
    const variationId =
      sheetVariationId || sheetProduct.variations[0]?.id || "";
    const colorId = sheetColorId || sheetProduct.colors[0]?.id || "";
    const qty = clampQty(
      sheetProduct,
      variationId,
      colorId,
      rows,
      "__sheet__",
      sheetQty
    );
    if (qty <= 0) {
      setError(
        locale === "hi" ? "स्टॉक उपलब्ध नहीं" : "No stock for this option"
      );
      return;
    }
    const existingIdx = rows.findIndex(
      (r) =>
        r.productId === sheetProduct.id &&
        (r.variationId || "") === variationId &&
        (r.colorId || "") === colorId
    );
    if (existingIdx >= 0) {
      const next = [...rows];
      const merged = clampQty(
        sheetProduct,
        variationId,
        colorId,
        rows.filter((_, i) => i !== existingIdx),
        next[existingIdx].id,
        next[existingIdx].quantity + qty
      );
      next[existingIdx] = { ...next[existingIdx], quantity: merged };
      setRows(next);
    } else {
      setRows([
        ...rows,
        {
          id: crypto.randomUUID(),
          productId: sheetProduct.id,
          variationId,
          colorId,
          quantity: qty,
        },
      ]);
    }
    const sizeLabel = sheetVariation
      ? variationDisplayLabel(sheetVariation, locale)
      : "";
    setToast({
      id: Date.now(),
      msg: `${locale === "hi" ? "जोड़ा" : "Added"} · ${sheetProduct.name[locale]}${sizeLabel ? ` ${sizeLabel}` : ""} × ${qty}`,
    });
    closeSheet();
    setError("");
    setNote("");
  };

  const computed = rows.map((row) => {
    const product = products.find((p) => p.id === row.productId);
    if (!product) {
      return {
        row,
        total: 0,
        rate: 0,
        weightKg: 0,
        stock: 0,
        maxQty: 0,
        qty: 0,
      };
    }
    const variation =
      product.variations.find((v) => v.id === row.variationId) ??
      product.variations[0];
    const color =
      product.colors.find((c) => c.id === row.colorId) ?? product.colors[0];
    const stock = getSizeColorStock(product, variation?.id, color?.id);
    const maxQty = maxBundlesForRow(
      product,
      variation,
      color?.id ?? row.colorId,
      rows,
      row.id
    );
    const minQty = Math.min(product.minOrderQty ?? 1, maxQty || 0);
    const qty =
      maxQty <= 0
        ? 0
        : Math.min(maxQty, Math.max(minQty || 1, row.quantity || 1));
    const rate = resolveRate(product, variation);
    const weightKg = qty > 0 ? resolveWeightKg(product, variation, qty) : 0;
    const total =
      qty > 0
        ? calcLineTotal({
            pricingMode: product.pricingMode,
            rate,
            quantity: qty,
            weightKg,
          })
        : 0;
    return {
      row,
      product,
      variation,
      color,
      rate,
      weightKg,
      total,
      stock,
      maxQty,
      qty,
    };
  });

  const subtotal = roundMoney(computed.reduce((s, c) => s + c.total, 0));
  const shipLines = computed
    .filter((c) => c.product && c.qty > 0)
    .map((c) => ({
      productId: c.product!.id,
      unit: c.product!.unit,
      quantity: c.qty,
      weightKg: c.weightKg || 0,
    }));
  const totalWeight = db
    ? shippingWeightExcludingJhal(shipLines, db.products)
    : roundMoney(computed.reduce((s, c) => s + (c.weightKg || 0), 0));
  const jhalQty = db ? countOrderJhals(shipLines, db.products) : 0;
  const shipping = db ? calcShipping(db, subtotal, totalWeight, jhalQty) : 0;
  const grand = roundOffRupees(subtotal + shipping);
  const lineCount = computed.filter((c) => c.qty > 0).length;
  const goodsWeight = roundMoney(
    computed.reduce((s, c) => s + (c.weightKg || 0), 0)
  );

  useEffect(() => {
    if (!hydrated || !db) return;
    const next = rowsToCartItems(computed);
    const prev = getCart();
    if (JSON.stringify(prev) !== JSON.stringify(next)) {
      saveCart(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sync derived cart from current rows
  }, [rows, hydrated, db, products]);

  const goToCheckout = () => {
    setError("");
    const cart = rowsToCartItems(computed);
    const needBySku = new Map<string, number>();
    for (const c of cart) {
      const k = `${c.productId}:${c.variationId || ""}:${c.colorId || ""}`;
      needBySku.set(k, (needBySku.get(k) ?? 0) + c.quantity);
    }
    for (const [k, need] of needBySku) {
      const [productId, variationId, colorId] = k.split(":");
      const product = products.find((p) => p.id === productId);
      if (!product) continue;
      const stock = getSizeColorStock(product, variationId, colorId);
      if (need > stock) {
        setError(
          locale === "hi"
            ? `${product.name[locale]}: केवल ${stock} बंडल उपलब्ध`
            : `${product.name[locale]}: only ${stock} bundles in stock`
        );
        return;
      }
    }
    if (!cart.length) {
      setError(
        locale === "hi"
          ? "चेकआउट के लिए कम से कम एक उत्पाद चुनें"
          : "Select at least one product to checkout"
      );
      return;
    }
    saveCart(cart);
    router.push("/checkout");
  };

  const setLineQty = (rowId: string, requested: number | "") => {
    const idx = rows.findIndex((r) => r.id === rowId);
    if (idx < 0) return;
    const row = rows[idx];
    const product = products.find((p) => p.id === row.productId);
    if (!product) return;
    if (requested === "") return;
    const qty = clampQty(
      product,
      row.variationId,
      row.colorId,
      rows,
      row.id,
      requested
    );
    const minOrder = product.minOrderQty ?? 1;
    if (requested > 0 && requested < minOrder && qty > requested) {
      setNote(
        locale === "hi"
          ? `${product.name[locale]}: कम से कम ${minOrder} बंडल`
          : `${product.name[locale]}: minimum ${minOrder} bundles`
      );
    } else {
      setNote("");
    }
    const next = [...rows];
    next[idx] = { ...row, quantity: qty };
    setRows(next);
    setError("");
  };

  if (!db) return <p className="tt-section tt-wrap">{t("common.loading")}</p>;

  return (
    <section className="tt-section tt-qo">
      <div className="tt-wrap tt-qo-layout">
        <div className="tt-qo-main">
          <div className="tt-qo-head">
            <h1>{t("nav.quickOrder")}</h1>
            <p>
              {locale === "hi"
                ? "खोजें → उत्पाद टैप करें → साइज़/रंग → जोड़ें"
                : "Search → tap product → size/color → add"}
            </p>
          </div>

          <div className="tt-qo-search-row">
            <input
              className="tt-input w-full"
              placeholder={
                locale === "hi"
                  ? "नाम, कोड या साइज़ खोजें…"
                  : "Search name, code or size…"
              }
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              enterKeyHint="search"
              autoComplete="off"
            />
            <label className="tt-qo-oos">
              <input
                type="checkbox"
                checked={showOutOfStock}
                onChange={(e) => setShowOutOfStock(e.target.checked)}
              />
              {locale === "hi" ? "स्टॉक 0 भी दिखाएँ" : "Show out of stock"}
            </label>
          </div>

          {error ? (
            <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>
          ) : null}
          {note ? <p className="tt-qo-note">{note}</p> : null}

          <div className="tt-qo-products">
            {filtered.length === 0 ? (
              <p className="tt-qo-empty">
                {locale === "hi" ? "कोई उत्पाद नहीं" : "No products found"}
              </p>
            ) : (
              filtered.map(({ product: p, stock }) => {
                const thumb = productThumb(p);
                const outOfStock = stock <= 0;
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`tt-qo-product${outOfStock ? " out" : ""}`}
                    onClick={() => openSheet(p)}
                    disabled={outOfStock}
                  >
                    <span className="tt-qo-product-thumb">
                      {thumb ? (
                        <ProductImage
                          src={thumb}
                          alt={p.name[locale]}
                          width={48}
                          height={48}
                        />
                      ) : (
                        <span>{p.name[locale].slice(0, 2)}</span>
                      )}
                    </span>
                    <span className="tt-qo-product-text">
                      <strong>{p.name[locale]}</strong>
                      <small>
                        {productRateLabel(p, locale)}
                        {outOfStock
                          ? locale === "hi"
                            ? " · स्टॉक खत्म"
                            : " · Out of stock"
                          : ""}
                      </small>
                    </span>
                    <span className="tt-qo-product-go">+</span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <aside className="tt-qo-summary" ref={summaryRef}>
          <p className="tt-qo-summary-title">
            {locale === "hi" ? "आपका ऑर्डर" : "Your order"}
            {lineCount ? ` (${lineCount})` : ""}
          </p>
          {!computed.length ? (
            <p className="tt-qo-empty">
              {locale === "hi"
                ? "उत्पाद टैप करके जोड़ें"
                : "Tap a product to add"}
            </p>
          ) : (
            <ul className="tt-qo-summary-list">
              {computed.map((c) => (
                <li key={c.row.id} className="tt-qo-summary-item">
                  <div className="tt-qo-summary-head">
                    <div>
                      <strong>
                        {c.product?.name[locale] || c.row.productId}
                      </strong>
                      <small>
                        {c.variation
                          ? variationDisplayLabel(c.variation, locale)
                          : ""}
                        {c.color ? ` · ${c.color.name[locale]}` : ""}
                        {c.rate > 0 && c.product
                          ? ` · ${formatInr(c.rate, locale)}${rateUnitSuffix(c.product, locale)}`
                          : ""}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="tt-qo-remove"
                      aria-label="Remove"
                      onClick={() =>
                        setRows(rows.filter((r) => r.id !== c.row.id))
                      }
                    >
                      ×
                    </button>
                  </div>
                  <div className="tt-qo-summary-meta">
                    <div className="tt-qo-stepper">
                      <button
                        type="button"
                        aria-label="Decrease"
                        disabled={!c.product || c.qty <= 0}
                        onClick={() =>
                          setLineQty(c.row.id, Math.max(0, c.qty - 1))
                        }
                      >
                        −
                      </button>
                      <NumberField
                        integer
                        className="tt-qo-qty"
                        value={c.maxQty <= 0 ? 0 : c.row.quantity}
                        emptyAs={null}
                        disabled={!c.product || c.maxQty <= 0}
                        onValueChange={(v) => setLineQty(c.row.id, v)}
                        onBlur={() => {
                          if (!c.product) return;
                          setLineQty(
                            c.row.id,
                            clampQty(
                              c.product,
                              c.row.variationId,
                              c.row.colorId,
                              rows,
                              c.row.id,
                              c.row.quantity
                            )
                          );
                        }}
                      />
                      <button
                        type="button"
                        aria-label="Increase"
                        disabled={!c.product || c.qty >= c.maxQty}
                        onClick={() => setLineQty(c.row.id, c.qty + 1)}
                      >
                        +
                      </button>
                    </div>
                    <div className="tt-qo-stat total">
                      <strong>{formatInr(c.total, locale)}</strong>
                      <small>
                        {c.maxQty <= 0
                          ? locale === "hi"
                            ? "स्टॉक खत्म"
                            : "Out of stock"
                          : `${roundMoney(c.weightKg || 0)} kg · max ${c.maxQty}`}
                      </small>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {sheetProduct ? (
        <div className="tt-qo-sheet-backdrop" onClick={closeSheet}>
          <div
            className="tt-qo-sheet"
            role="dialog"
            aria-modal="true"
            aria-label={sheetProduct.name[locale]}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="tt-qo-sheet-head">
              <div>
                <strong>{sheetProduct.name[locale]}</strong>
                <small>
                  {sheetRate > 0
                    ? `${formatInr(sheetRate, locale)}${rateUnitSuffix(sheetProduct, locale)}`
                    : sheetProduct.code}
                </small>
              </div>
              <button
                type="button"
                className="tt-qo-remove"
                aria-label={locale === "hi" ? "बंद करें" : "Close"}
                onClick={closeSheet}
              >
                ×
              </button>
            </div>

            {sheetVariations.length || sheetProduct.variations.length ? (
              <div className="tt-qo-sheet-block">
                <p className="tt-label">{t("common.variation")}</p>
                <div className="tt-qo-chips">
                  {(sheetVariations.length
                    ? sheetVariations
                    : sheetProduct.variations
                  ).map((v) => {
                    const st = variationStockForColor(
                      sheetProduct,
                      v.id,
                      sheetColorId || undefined
                    );
                    const active = sheetVariationId === v.id;
                    const vRate = resolveRate(sheetProduct, v);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className={`tt-qo-chip${active ? " active" : ""}${st <= 0 ? " out" : ""}`}
                        aria-pressed={active}
                        onClick={() => selectSheetVariation(v.id)}
                      >
                        {variationDisplayLabel(v, locale)}
                        {vRate > 0
                          ? ` · ${formatInr(vRate, locale)}${rateUnitSuffix(sheetProduct, locale)}`
                          : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {sheetProduct.colors?.length ? (
              <div className="tt-qo-sheet-block">
                <p className="tt-label">{t("common.color")}</p>
                <div className="tt-qo-chips">
                  {(sheetColors.length
                    ? sheetColors
                    : sheetProduct.colors
                  ).map((c) => {
                    const st = getSizeColorStock(
                      sheetProduct,
                      sheetVariationId || undefined,
                      c.id
                    );
                    const active = sheetColorId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={`tt-qo-chip${active ? " active" : ""}${st <= 0 ? " out" : ""}`}
                        aria-pressed={active}
                        onClick={() => selectSheetColor(c.id)}
                      >
                        <span
                          className="tt-qo-swatch"
                          style={
                            c.imageUrl
                              ? undefined
                              : { background: c.hex || "#ccc" }
                          }
                        >
                          {c.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.imageUrl} alt="" />
                          ) : null}
                        </span>
                        {c.name[locale]}
                        {st > 0 ? ` · ${st}` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="tt-qo-sheet-qty">
              <label className="tt-label">{t("common.bundles")}</label>
              <div className="tt-qo-stepper">
                <button
                  type="button"
                  aria-label="Decrease"
                  disabled={sheetMax <= 0 || sheetQty <= 0}
                  onClick={() =>
                    setSheetQty(Math.max(0, (sheetQty || 0) - 1))
                  }
                >
                  −
                </button>
                <NumberField
                  integer
                  className="tt-qo-qty"
                  value={sheetMax <= 0 ? 0 : sheetQty}
                  emptyAs={null}
                  disabled={sheetMax <= 0}
                  onValueChange={(v) => {
                    if (v === "") return;
                    setSheetQty(v);
                  }}
                  onBlur={() => {
                    if (sheetMax <= 0) {
                      setSheetQty(0);
                      return;
                    }
                    const n = Number(sheetQty) || 0;
                    setSheetQty(
                      Math.min(sheetMax, Math.max(sheetMinQty, n || sheetMinQty))
                    );
                  }}
                />
                <button
                  type="button"
                  aria-label="Increase"
                  disabled={sheetMax <= 0 || sheetQty >= sheetMax}
                  onClick={() =>
                    setSheetQty(Math.min(sheetMax, (sheetQty || 0) + 1))
                  }
                >
                  +
                </button>
              </div>
              <p className={`tt-qo-stock${sheetMax <= 0 ? " out" : ""}`}>
                {sheetMax <= 0
                  ? locale === "hi"
                    ? "स्टॉक खत्म"
                    : "Out of stock"
                  : locale === "hi"
                    ? `मैक्स ${sheetMax}`
                    : `Max ${sheetMax}`}
                {sheetStock > 0 && sheetMax < sheetStock
                  ? ` · ${sheetStock}`
                  : ""}
                {(sheetProduct.minOrderQty ?? 1) > 1
                  ? locale === "hi"
                    ? ` · कम से कम ${sheetProduct.minOrderQty}`
                    : ` · min ${sheetProduct.minOrderQty}`
                  : ""}
              </p>
            </div>

            {sheetMax > 0 && sheetQty > 0 ? (
              <div className="tt-qo-sheet-total">
                <span>
                  {sheetQty} {locale === "hi" ? "बंडल" : "bundles"}
                  {sheetWeight > 0
                    ? ` · ${roundMoney(sheetWeight)} kg`
                    : ""}
                </span>
                <strong>{formatInr(sheetTotal, locale)}</strong>
              </div>
            ) : null}

            <button
              type="button"
              className="tt-btn tt-btn-dark w-full"
              disabled={sheetMax <= 0}
              onClick={addFromSheet}
            >
              {locale === "hi" ? "ऑर्डर में जोड़ें" : "Add to order"}
            </button>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="tt-qo-toast" role="status">
          {toast.msg}
        </div>
      ) : null}

      <div className="tt-sticky-bar">
        <div className="tt-wrap">
          <div className="tt-qo-bar">
            <button
              type="button"
              className="tt-qo-bar-sum"
              onClick={() =>
                summaryRef.current?.scrollIntoView({
                  behavior: "smooth",
                  block: "start",
                })
              }
            >
              <p className="line">
                {lineCount
                  ? `${lineCount} ${locale === "hi" ? "आइटम" : lineCount === 1 ? "item" : "items"} · ${goodsWeight} kg · +${formatInr(shipping, locale)} ${locale === "hi" ? "भाड़ा" : "ship"}`
                  : locale === "hi"
                    ? "कोई आइटम नहीं"
                    : "No items yet"}
              </p>
              <p className="grand">{formatInr(grand, locale)}</p>
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-dark"
              disabled={lineCount === 0}
              onClick={goToCheckout}
            >
              {t("common.buyNow")}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
