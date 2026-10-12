"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { NumberField } from "@/components/NumberField";
import { ProductImage } from "@/components/ProductImage";
import { CatalogRetry } from "@/components/CatalogRetry";
import { useDb, useSession } from "@/lib/hooks";
import {
  buildOrderLine,
  catalogFromRate,
  calcLineTotal,
  formatInr,
  pcsPerPacketLabel,
  resolvePcsPerPacket,
  resolveRate,
  resolveSqftPack,
  resolveWeightKg,
  roundMoney,
  roundOffRupees,
  unitLabel,
  variationDisplayLabel,
} from "@/lib/pricing";
import { isPublicCatalogProduct } from "@/lib/catalog-visibility";
import { getSizeColorStock } from "@/lib/inventory";
import { ORDER_AGAIN_HINT_KEY } from "@/lib/order-again";
import {
  calcShipping,
  countOrderJhals,
  getCart,
  saveCart,
  shippingWeightExcludingJhal,
} from "@/lib/store/db";
import type { CartItem, Product, ProductVariation } from "@/lib/types";
import { OrderDiscountExplain } from "@/components/OrderDiscountExplain";
import {
  lineDiscountedRate,
  lineOrderDiscountTier,
  orderDiscountMathLabel,
  orderDiscountMathQty,
  previewDealerOrderDiscount,
} from "@/lib/schemes";

interface QuickRow {
  id: string;
  productId: string;
  variationId: string;
  colorId: string;
  quantity: number;
}

function comboKey(variationId: string, colorId: string): string {
  return `${variationId}::${colorId}`;
}

function parseCombo(key: string): { variationId: string; colorId: string } {
  const i = key.indexOf("::");
  if (i < 0) return { variationId: key, colorId: "" };
  return { variationId: key.slice(0, i), colorId: key.slice(i + 2) };
}

function productThumb(product: Product): string {
  return (
    product.logoUrl ||
    product.media?.find((m) => m.type === "image" && m.url)?.url ||
    ""
  );
}

function productPcsPktLabel(
  product: Product,
  locale: "en" | "hi"
): string {
  const fromVars = (product.variations ?? [])
    .map((v) => resolvePcsPerPacket(product, v))
    .filter((n) => n > 0);
  const pcs =
    fromVars.length && fromVars.every((n) => n === fromVars[0])
      ? fromVars[0]
      : resolvePcsPerPacket(product);
  return pcsPerPacketLabel(pcs, locale);
}

function rateUnitSuffix(product: Product, locale: "en" | "hi"): string {
  if (product.pricingMode === "bundle") return locale === "hi" ? "/किग्रा" : "/kg";
  return `/${unitLabel(product.unit, locale)}`;
}

/** Lowest–highest rate for list display (₹ / kg, / pc, or / sq/ft). */
function productRateLabel(product: Product, locale: "en" | "hi"): string {
  const unit = rateUnitSuffix(product, locale);
  const rates = (
    product.unit === "sqft"
      ? (product.variations.length
          ? product.variations.map((v) => resolveSqftPack(product, v).ratePerSqft)
          : [catalogFromRate(product)])
      : product.variations.length
        ? product.variations.map((v) => resolveRate(product, v))
        : [resolveRate(product, undefined)]
  ).filter((r) => r > 0);
  if (!rates.length) return "—";
  const min = Math.min(...rates);
  const max = Math.max(...rates);
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

/** Size for a newly tapped colour — keep the last size only if that colour has it. */
function sizeForNewColor(
  product: Product,
  colorId: string,
  preferredVariationId?: string
): string {
  if (
    preferredVariationId &&
    getSizeColorStock(product, preferredVariationId, colorId) > 0
  ) {
    return preferredVariationId;
  }
  const first = sortedVariations(product, colorId).find(
    (v) => getSizeColorStock(product, v.id, colorId) > 0
  );
  return first?.id || product.variations[0]?.id || "";
}

function colorTotalStock(product: Product, colorId: string): number {
  if (!product.variations.length) {
    return Math.max(0, getSizeColorStock(product, undefined, colorId));
  }
  return product.variations.reduce(
    (s, v) => s + Math.max(0, getSizeColorStock(product, v.id, colorId)),
    0
  );
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

function mergeQuickRows(
  product: Product,
  current: QuickRow[],
  toAdd: { variationId: string; colorId: string; qty: number }[]
): QuickRow[] {
  const next = [...current];
  for (const item of toAdd) {
    const existingIdx = next.findIndex(
      (r) =>
        r.productId === product.id &&
        (r.variationId || "") === item.variationId &&
        (r.colorId || "") === item.colorId
    );
    if (existingIdx >= 0) {
      const merged = clampQty(
        product,
        item.variationId,
        item.colorId,
        next.filter((_, i) => i !== existingIdx),
        next[existingIdx].id,
        next[existingIdx].quantity + item.qty
      );
      next[existingIdx] = { ...next[existingIdx], quantity: merged };
    } else {
      const qty = clampQty(
        product,
        item.variationId,
        item.colorId,
        next,
        "__new__",
        item.qty
      );
      if (qty <= 0) continue;
      next.push({
        id: crypto.randomUUID(),
        productId: product.id,
        variationId: item.variationId,
        colorId: item.colorId,
        quantity: qty,
      });
    }
  }
  return next;
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
  const { db, cloudReady } = useDb();
  const { session } = useSession();
  const [rows, setRows] = useState<QuickRow[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [toast, setToast] = useState<{ id: number; msg: string } | null>(null);
  const [showOutOfStock, setShowOutOfStock] = useState(false);
  const [sheetProductId, setSheetProductId] = useState<string | null>(null);
  const [sheetColorId, setSheetColorId] = useState("");
  const [sheetFocusSize, setSheetFocusSize] = useState("");
  const [sheetDraft, setSheetDraft] = useState<Record<string, number>>({});
  const summaryRef = useRef<HTMLElement | null>(null);

  const products = useMemo(() => {
    if (!db) return [];
    return db.products.filter((p) => isPublicCatalogProduct(p));
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
    try {
      const hint = sessionStorage.getItem(ORDER_AGAIN_HINT_KEY);
      if (hint) {
        sessionStorage.removeItem(ORDER_AGAIN_HINT_KEY);
        setToast({ id: Date.now(), msg: hint });
      }
    } catch {
      /* private mode */
    }
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
    return list.filter((v) =>
      sheetColorId
        ? getSizeColorStock(sheetProduct, v.id, sheetColorId) > 0
        : variationStockForColor(sheetProduct, v.id) > 0
    );
  }, [sheetProduct, sheetColorId, showOutOfStock]);

  const sheetColors = useMemo(() => {
    if (!sheetProduct?.colors?.length) return [];
    const list = [...sheetProduct.colors].sort((a, b) => {
      const sa = colorTotalStock(sheetProduct, a.id);
      const sb = colorTotalStock(sheetProduct, b.id);
      if (sa > 0 !== sb > 0) return sa > 0 ? -1 : 1;
      return sb - sa;
    });
    if (showOutOfStock) return list;
    return list.filter((c) => colorTotalStock(sheetProduct, c.id) > 0);
  }, [sheetProduct, showOutOfStock]);

  const sheetSelectedSizeIds = Object.keys(sheetDraft)
    .map(parseCombo)
    .filter((c) => (c.colorId || "") === (sheetColorId || ""))
    .map((c) => c.variationId);

  const sheetLines = sheetProduct
    ? Object.entries(sheetDraft).flatMap(([key, qty]) => {
        const { variationId, colorId } = parseCombo(key);
        const variation = sheetProduct.variations.find((v) => v.id === variationId);
        if (!variation) return [];
        const color =
          sheetProduct.colors.find((c) => c.id === colorId) ??
          (colorId ? undefined : sheetProduct.colors[0]);
        const max = maxBundlesForRow(
          sheetProduct,
          variation,
          colorId,
          rows,
          "__sheet__"
        );
        const minQty = Math.min(sheetProduct.minOrderQty ?? 1, max || 1);
        const rate = resolveRate(sheetProduct, variation);
        const weightKg =
          qty > 0 ? resolveWeightKg(sheetProduct, variation, qty) : 0;
        const total =
          qty > 0
            ? calcLineTotal({
                pricingMode: sheetProduct.pricingMode,
                rate,
                quantity: qty,
                weightKg,
              })
            : 0;
        return [
          {
            key,
            variation,
            color,
            colorId,
            qty,
            max,
            minQty,
            rate,
            weightKg,
            total,
          },
        ];
      })
    : [];

  const sheetAddable = sheetLines.filter((l) => l.qty > 0 && l.max > 0);
  const sheetWeight = sheetAddable.reduce((s, l) => s + l.weightKg, 0);
  const sheetTotal = sheetAddable.reduce((s, l) => s + l.total, 0);
  const sheetQtySum = sheetAddable.reduce((s, l) => s + l.qty, 0);
  const sheetFocusVariation = sheetProduct
    ? sheetProduct.variations.find((v) => v.id === sheetFocusSize) ??
      sheetProduct.variations[0]
    : undefined;
  const sheetRate =
    sheetProduct && sheetFocusVariation
      ? resolveRate(sheetProduct, sheetFocusVariation)
      : 0;

  const closeSheet = () => {
    setSheetProductId(null);
    setSheetColorId("");
    setSheetFocusSize("");
    setSheetDraft({});
  };

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

  const openSheet = (product: Product) => {
    const defaults = pickInStockDefaults(product);
    const qty = clampQty(
      product,
      defaults.variationId,
      defaults.colorId,
      rows,
      "__sheet__",
      product.minOrderQty ?? 1
    );
    setSheetProductId(product.id);
    setSheetColorId(defaults.colorId);
    setSheetFocusSize(defaults.variationId);
    setSheetDraft(
      defaults.variationId && qty > 0
        ? { [comboKey(defaults.variationId, defaults.colorId)]: qty }
        : {}
    );
    setError("");
    setNote("");
  };

  const putCombo = (
    draft: Record<string, number>,
    variationId: string,
    colorId: string,
    requested: number
  ): Record<string, number> => {
    if (!sheetProduct) return draft;
    const qty = clampQty(
      sheetProduct,
      variationId,
      colorId,
      rows,
      "__sheet__",
      requested
    );
    const key = comboKey(variationId, colorId);
    if (qty <= 0) {
      const next = { ...draft };
      delete next[key];
      return next;
    }
    return { ...draft, [key]: qty };
  };

  const toggleSheetSize = (variationId: string) => {
    if (!sheetProduct) return;
    const colorId = sheetColorId;
    const key = comboKey(variationId, colorId);
    const has = sheetDraft[key] != null;
    if (has) {
      setSheetDraft((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      const leftover = Object.keys(sheetDraft)
        .filter((k) => k !== key)
        .map(parseCombo)
        .find((c) => (c.colorId || "") === (colorId || ""));
      setSheetFocusSize(leftover?.variationId || variationId);
      return;
    }
    const stock = colorId
      ? getSizeColorStock(sheetProduct, variationId, colorId)
      : variationStockForColor(sheetProduct, variationId);
    if (stock <= 0) return;
    setSheetFocusSize(variationId);
    setSheetDraft((prev) =>
      putCombo(prev, variationId, colorId, sheetProduct.minOrderQty ?? 1)
    );
  };

  const pickSheetColor = (colorId: string) => {
    setSheetColorId(colorId);
    const existing = Object.keys(sheetDraft)
      .map(parseCombo)
      .find((c) => c.colorId === colorId);
    if (existing) {
      setSheetFocusSize(existing.variationId);
      return;
    }
    if (!sheetProduct) return;
    const first = sizeForNewColor(sheetProduct, colorId, "");
    if (first) setSheetFocusSize(first);
  };

  const setDraftQty = (key: string, requested: number) => {
    const { variationId, colorId } = parseCombo(key);
    setSheetDraft((prev) => putCombo(prev, variationId, colorId, requested));
  };

  const addFromSheet = () => {
    if (!sheetProduct) return;
    const toAdd = Object.entries(sheetDraft)
      .map(([key, requested]) => {
        const { variationId, colorId } = parseCombo(key);
        return {
          variationId,
          colorId,
          qty: clampQty(
            sheetProduct,
            variationId,
            colorId,
            rows,
            "__sheet__",
            requested
          ),
        };
      })
      .filter((x) => x.qty > 0);
    if (!toAdd.length) {
      setError(t("shop.qoNoStock"));
      return;
    }
    setRows(mergeQuickRows(sheetProduct, rows, toAdd));
    const sizeBits = toAdd
      .map(({ variationId, colorId, qty }) => {
        const v = sheetProduct.variations.find((x) => x.id === variationId);
        const c = sheetProduct.colors.find((x) => x.id === colorId);
        const label = v ? variationDisplayLabel(v, locale) : variationId;
        const color = c ? ` ${c.name[locale]}` : "";
        return `${label}${color} × ${qty}`;
      })
      .join(", ");
    setToast({
      id: Date.now(),
      msg: `${t("shop.qoAdded")} · ${sheetProduct.name[locale]} ${sizeBits}`,
    });
    closeSheet();
    setError("");
    setNote("");
  };

  const selectAllSheetSizes = () => {
    if (!sheetProduct) return;
    const colorId = sheetColorId;
    const minQty = sheetProduct.minOrderQty ?? 1;
    setSheetDraft((prev) => {
      let next = { ...prev };
      for (const v of sheetVariations) {
        const st = colorId
          ? getSizeColorStock(sheetProduct, v.id, colorId)
          : variationStockForColor(sheetProduct, v.id);
        if (st <= 0) continue;
        const key = comboKey(v.id, colorId);
        if (next[key] == null) {
          next = putCombo(next, v.id, colorId, minQty);
        }
      }
      return next;
    });
  };

  const selectAllSheetColors = () => {
    if (!sheetProduct?.colors.length) return;
    const sizes = sheetSelectedSizeIds.length
      ? sheetSelectedSizeIds
      : [sheetFocusSize].filter(Boolean);
    const minQty = sheetProduct.minOrderQty ?? 1;
    setSheetDraft((prev) => {
      let next = { ...prev };
      for (const variationId of sizes) {
        for (const color of sheetColors) {
          const st = getSizeColorStock(sheetProduct, variationId, color.id);
          if (st <= 0) continue;
          const key = comboKey(variationId, color.id);
          if (next[key] == null) {
            next = putCombo(next, variationId, color.id, minQty);
          }
        }
      }
      return next;
    });
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
  const user = db?.users.find((u) => u.id === session?.id);
  const orderLines = computed
    .filter((c) => c.product && c.variation && c.qty > 0)
    .map((c) =>
      buildOrderLine({
        product: c.product!,
        variation: c.variation,
        colorId: c.color?.id,
        colorName: c.color?.name,
        quantity: c.qty,
      })
    );
  const schemePreview =
    db && orderLines.length
      ? previewDealerOrderDiscount(
          db.schemes,
          user?.assignedSchemeIds,
          orderLines,
          db.products,
          locale
        )
      : { best: null, view: null };
  const schemeBest = schemePreview.best;
  const schemeDiscount = schemeBest?.amount ?? 0;
  const schemeQty =
    schemeBest && db
      ? orderDiscountMathQty(schemeBest.scheme, orderLines, db.products)
      : 0;
  const schemeMath = orderDiscountMathLabel(schemeBest, schemeQty, locale);
  const grand = roundOffRupees(subtotal + shipping - schemeDiscount);
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

  if (!db || (!cloudReady && products.length === 0)) {
    return <p className="tt-section tt-wrap">{t("common.loading")}</p>;
  }

  return (
    <section className="tt-section tt-qo">
      <div className="tt-wrap tt-qo-layout">
        <div className="tt-qo-main">
          <div className="tt-qo-head">
            <h1>{t("nav.quickOrder")}</h1>
            <p>
              {t("shop.qoHint")}
            </p>
          </div>

          <div className="tt-qo-search-row">
            <input
              className="tt-input w-full"
              placeholder={t("shop.qoSearch")}
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
              {t("shop.qoShowOos")}
            </label>
          </div>

          {error ? (
            <p className="mt-2 text-xs text-[var(--danger)]">{error}</p>
          ) : null}
          {note ? <p className="tt-qo-note">{note}</p> : null}

          <div className="tt-qo-products">
            {filtered.length === 0 ? (
              products.length === 0 ? (
                <CatalogRetry className="tt-qo-empty" />
              ) : (
              <p className="tt-qo-empty">
                {t("shop.qoNoProducts")}
              </p>
              )
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
                        {(() => {
                          const pcsLbl = productPcsPktLabel(p, locale);
                          return pcsLbl ? ` · ${pcsLbl}` : "";
                        })()}
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
                        {(() => {
                          if (!c.product) return "";
                          const pcsLbl = pcsPerPacketLabel(
                            resolvePcsPerPacket(c.product, c.variation),
                            locale
                          );
                          return pcsLbl ? ` · ${pcsLbl}` : "";
                        })()}
                        {c.color ? ` · ${c.color.name[locale]}` : ""}
                        {(() => {
                          if (!(c.rate > 0) || !c.product) return "";
                          const lineTier = lineOrderDiscountTier(schemeBest, {
                            productId: c.product.id,
                            variationId: c.variation?.id,
                          });
                          const rates = lineTier
                            ? lineDiscountedRate(
                                schemeBest!.scheme,
                                lineTier,
                                {
                                  rate: c.rate,
                                  pricingMode: c.product.pricingMode,
                                },
                                c.product
                              )
                            : null;
                          if (
                            rates &&
                            rates.discountedRate < rates.listRate
                          ) {
                            return (
                              <>
                                {" · "}
                                <span className="line-through text-[var(--ink-muted)]">
                                  {formatInr(rates.listRate, locale)}
                                  {rateUnitSuffix(c.product, locale)}
                                </span>
                                {" → "}
                                <span className="text-[var(--ok)]">
                                  {formatInr(rates.discountedRate, locale)}
                                  {rateUnitSuffix(c.product, locale)}
                                </span>
                              </>
                            );
                          }
                          return ` · ${formatInr(c.rate, locale)}${rateUnitSuffix(c.product, locale)}`;
                        })()}
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
          {computed.length > 0 && schemePreview.view ? (
            <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3">
              {schemeDiscount > 0 ? (
                <p className="mb-2 text-sm font-semibold text-[var(--ok)]">
                  {t("schemes.orderDiscountEstimate")}
                  {schemeMath ? ` · ${schemeMath}` : ""}{" "}
                  −{formatInr(schemeDiscount, locale)}
                  <span className="mt-0.5 block text-[11px] font-normal text-[var(--ink-muted)]">
                    {t("schemes.orderDiscountAfterWeight")}
                  </span>
                </p>
              ) : null}
              <OrderDiscountExplain view={schemePreview.view} compact />
            </div>
          ) : null}
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
                <div className="tt-qo-sheet-label-row">
                  <p className="tt-label">{t("common.variation")}</p>
                  {sheetVariations.length > 1 ? (
                    <button
                      type="button"
                      className="tt-qo-sheet-all"
                      onClick={selectAllSheetSizes}
                    >
                      {t("shop.qoSelectAllSizes")}
                    </button>
                  ) : null}
                </div>
                <p className="mb-2 text-xs text-[var(--ink-muted)]">
                  {t("shop.qoSelectSizes")}
                </p>
                <div className="tt-qo-chips">
                  {(sheetVariations.length
                    ? sheetVariations
                    : sheetProduct.variations
                  ).map((v) => {
                    const colorStock = sheetColorId
                      ? getSizeColorStock(sheetProduct, v.id, sheetColorId)
                      : variationStockForColor(sheetProduct, v.id);
                    const active = sheetSelectedSizeIds.includes(v.id);
                    const vRate = resolveRate(sheetProduct, v);
                    return (
                      <button
                        key={v.id}
                        type="button"
                        className={`tt-qo-chip${active ? " active" : ""}${colorStock <= 0 ? " out" : ""}`}
                        aria-pressed={active}
                        disabled={colorStock <= 0 && !active}
                        onClick={() => toggleSheetSize(v.id)}
                      >
                        {variationDisplayLabel(v, locale)}
                        {(() => {
                          const pcsLbl = pcsPerPacketLabel(
                            resolvePcsPerPacket(sheetProduct, v),
                            locale
                          );
                          return pcsLbl ? ` · ${pcsLbl}` : "";
                        })()}
                        {vRate > 0
                          ? ` · ${formatInr(vRate, locale)}${rateUnitSuffix(sheetProduct, locale)}`
                          : ""}
                        {colorStock > 0 ? ` · ${colorStock}` : ""}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {sheetProduct.colors?.length ? (
              <div className="tt-qo-sheet-block">
                <div className="tt-qo-sheet-label-row">
                  <p className="tt-label">{t("common.color")}</p>
                  {sheetColors.length > 1 ? (
                    <button
                      type="button"
                      className="tt-qo-sheet-all"
                      onClick={selectAllSheetColors}
                    >
                      {t("shop.qoSelectAllColors")}
                    </button>
                  ) : null}
                </div>
                <p className="mb-2 text-xs text-[var(--ink-muted)]">
                  {t("shop.qoSelectColors")}
                </p>
                <div className="tt-qo-chips">
                  {(sheetColors.length
                    ? sheetColors
                    : sheetProduct.colors
                  ).map((c) => {
                    const st = sheetFocusSize
                      ? getSizeColorStock(sheetProduct, sheetFocusSize, c.id)
                      : colorTotalStock(sheetProduct, c.id);
                    const anyStock = colorTotalStock(sheetProduct, c.id);
                    const active = sheetColorId === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        className={`tt-qo-chip${active ? " active" : ""}${anyStock <= 0 ? " out" : ""}`}
                        aria-pressed={active}
                        disabled={anyStock <= 0 && !active}
                        onClick={() => pickSheetColor(c.id)}
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

            {sheetLines.length ? (
              <div className="tt-qo-sheet-draft">
                {sheetLines.map((line) => {
                  const key = line.key;
                  return (
                    <div key={key} className="tt-qo-sheet-draft-row">
                      <p className="tt-qo-sheet-draft-size">
                        {variationDisplayLabel(line.variation, locale)}
                        {(() => {
                          const pcsLbl = pcsPerPacketLabel(
                            resolvePcsPerPacket(
                              sheetProduct,
                              line.variation
                            ),
                            locale
                          );
                          return pcsLbl ? ` · ${pcsLbl}` : "";
                        })()}
                        {line.color ? ` · ${line.color.name[locale]}` : ""}
                        <span>
                          {line.max <= 0
                            ? t("shop.qoOutOfStock")
                            : t("shop.qoMax", { n: line.max })}
                        </span>
                      </p>
                      <div className="tt-qo-stepper">
                        <button
                          type="button"
                          aria-label="Decrease"
                          disabled={line.max <= 0 || line.qty <= 0}
                          onClick={() =>
                            setDraftQty(key, Math.max(0, (line.qty || 0) - 1))
                          }
                        >
                          −
                        </button>
                        <NumberField
                          integer
                          className="tt-qo-qty"
                          value={line.max <= 0 ? 0 : line.qty}
                          emptyAs={null}
                          disabled={line.max <= 0}
                          onValueChange={(v) => {
                            if (v === "") return;
                            setDraftQty(key, v);
                          }}
                          onBlur={() => {
                            if (line.max <= 0) {
                              setDraftQty(key, 0);
                              return;
                            }
                            const n = Number(sheetDraft[key]) || 0;
                            setDraftQty(
                              key,
                              Math.min(
                                line.max,
                                Math.max(line.minQty, n || line.minQty)
                              )
                            );
                          }}
                        />
                        <button
                          type="button"
                          aria-label="Increase"
                          disabled={line.max <= 0 || line.qty >= line.max}
                          onClick={() =>
                            setDraftQty(
                              key,
                              Math.min(line.max, (line.qty || 0) + 1)
                            )
                          }
                        >
                          +
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {sheetAddable.length ? (
              <div className="tt-qo-sheet-total">
                <span>
                  {sheetQtySum} {t("shop.bundles")}
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
              disabled={!sheetAddable.length}
              onClick={addFromSheet}
            >
              {sheetAddable.length > 1
                ? `${t("shop.qoAddToOrder")} (${sheetAddable.length})`
                : t("shop.qoAddToOrder")}
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
                  ? `${lineCount} ${locale === "hi" ? "आइटम" : lineCount === 1 ? "item" : "items"} · ${goodsWeight} kg · +${formatInr(shipping, locale)} ${locale === "hi" ? "भाड़ा" : "ship"}${
                      schemeDiscount > 0
                        ? ` · −${formatInr(schemeDiscount, locale)} ${locale === "hi" ? "छूट (अनुमान)" : "off (est.)"}`
                        : ""
                    }`
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
