import type {
  GoodsReceipt,
  OrderLine,
  Product,
  StockMovement,
  UnitOfSale,
  Voucher,
  VoucherLine,
} from "./types";
import {
  isPackCountUnit,
  isSqftUnit,
  resolveGsmPacketWeightKg,
  resolveSqftPack,
  resolveUnitWeightKg,
  roundMoney,
  sqftPacketAmount,
} from "./pricing";

/** Minimal DB slice for stock ops (avoids circular import with store/db). */
type StockDb = {
  products: Product[];
  stockMovements: StockMovement[];
};

export function secondaryPerBundle(
  product: Product,
  variationId?: string
): number {
  const variation = variationId
    ? product.variations.find((v) => v.id === variationId)
    : undefined;
  if (product.unit === "kg") {
    return resolveUnitWeightKg(product, variation) || 0;
  }
  if (product.unit === "sqft") {
    const pcs = Number(variation?.pcsPerPacket ?? product.pcsPerPacket) || 0;
    return pcs > 0 ? pcs : 0;
  }
  return 1;
}

export function deriveSecondaryQty(
  product: Product,
  bundles: number,
  variationId?: string,
  explicit?: number
): number {
  if (explicit != null && explicit > 0) return roundMoney(explicit);
  return roundMoney(bundles * secondaryPerBundle(product, variationId));
}

/** Matrix key for size × color stock. */
export function stockMatrixKey(
  variationId: string,
  colorId?: string
): string {
  return `${variationId}__${colorId || ""}`;
}

/**
 * Ensure stockMatrix exists for every size×color.
 * Migrates legacy variation.stock onto the first color when matrix is empty.
 * Rolls variation.stock / product.stock up from the matrix when colors exist.
 */
export function ensureStockMatrix(product: Product): void {
  if (!product.stockMatrix) product.stockMatrix = {};
  const matrix = product.stockMatrix;

  if (product.variations.length && product.colors.length) {
    for (const v of product.variations) {
      const keys = product.colors.map((c) => stockMatrixKey(v.id, c.id));
      const hasAny = keys.some((k) => matrix[k] != null);
      if (!hasAny) {
        // Preserve old per-size stock on first color
        const first = product.colors[0];
        matrix[stockMatrixKey(v.id, first.id)] = Math.max(0, v.stock || 0);
        for (let i = 1; i < product.colors.length; i++) {
          matrix[stockMatrixKey(v.id, product.colors[i].id)] = 0;
        }
      } else {
        for (const k of keys) {
          if (matrix[k] == null) matrix[k] = 0;
        }
      }
      v.stock = product.colors.reduce(
        (s, c) => s + Math.max(0, matrix[stockMatrixKey(v.id, c.id)] || 0),
        0
      );
      if (v.stockSecondary == null) {
        v.stockSecondary = deriveSecondaryQty(product, v.stock, v.id);
      }
    }
    product.stock = product.variations.reduce((s, v) => s + (v.stock || 0), 0);
    product.stockSecondary = product.variations.reduce(
      (s, v) => s + (v.stockSecondary ?? 0),
      0
    );
  }
}

/** First size×color that actually has sellable stock (matches checkout). */
export function firstInStockSelection(product: Product): {
  variationId: string;
  colorId: string;
} {
  ensureStockMatrix(product);
  const variations = product.variations ?? [];
  const colors = product.colors ?? [];
  for (const v of variations) {
    if (colors.length) {
      for (const c of colors) {
        if (getSizeColorStock(product, v.id, c.id) > 0) {
          return { variationId: v.id, colorId: c.id };
        }
      }
    } else if (getSizeColorStock(product, v.id) > 0) {
      return { variationId: v.id, colorId: "" };
    }
  }
  return {
    variationId: variations[0]?.id ?? "",
    colorId: colors[0]?.id ?? "",
  };
}

/** First color with stock for this size; otherwise the first color. */
export function firstInStockColorId(
  product: Product,
  variationId?: string
): string {
  ensureStockMatrix(product);
  const colors = product.colors ?? [];
  if (!variationId || !colors.length) return colors[0]?.id ?? "";
  const hit = colors.find(
    (c) => getSizeColorStock(product, variationId, c.id) > 0
  );
  return hit?.id ?? colors[0]?.id ?? "";
}

/** Bundles available for a specific size × color (or size only if no colors). */
export function getSizeColorStock(
  product: Product,
  variationId?: string,
  colorId?: string
): number {
  ensureStockMatrix(product);
  if (variationId && product.colors.length && colorId) {
    return Math.max(
      0,
      product.stockMatrix?.[stockMatrixKey(variationId, colorId)] ?? 0
    );
  }
  if (variationId) {
    const v = product.variations.find((x) => x.id === variationId);
    return Math.max(0, v?.stock || 0);
  }
  return Math.max(0, product.stock || 0);
}

export function setSizeColorStock(
  product: Product,
  variationId: string,
  colorId: string,
  stock: number
): void {
  ensureStockMatrix(product);
  if (!product.stockMatrix) product.stockMatrix = {};
  product.stockMatrix[stockMatrixKey(variationId, colorId)] = Math.max(
    0,
    stock || 0
  );
  // Rollup
  const v = product.variations.find((x) => x.id === variationId);
  if (v && product.colors.length) {
    v.stock = product.colors.reduce(
      (s, c) =>
        s +
        Math.max(
          0,
          product.stockMatrix?.[stockMatrixKey(variationId, c.id)] || 0
        ),
      0
    );
    v.stockSecondary = deriveSecondaryQty(product, v.stock, v.id);
  }
  product.stock = product.variations.reduce((s, x) => s + (x.stock || 0), 0);
  product.stockSecondary = product.variations.reduce(
    (s, x) => s + (x.stockSecondary ?? 0),
    0
  );
}

function applySigned(
  current: number,
  delta: number,
  strict: boolean,
  label: string
): number {
  const next = (current || 0) + delta;
  if (strict && next < -0.0001) {
    throw new Error(
      `Insufficient stock for ${label} (have ${current || 0}, need ${Math.abs(delta)})`
    );
  }
  return Math.max(0, next);
}

function applyQty(
  product: Product,
  variationId: string | undefined,
  colorId: string | undefined,
  bundlesDelta: number,
  secondaryDelta: number,
  opts?: { strict?: boolean }
): void {
  const strict = Boolean(opts?.strict);
  const label =
    product.name?.en || product.code || product.id || "product";
  ensureStockMatrix(product);
  if (variationId && product.colors.length && colorId) {
    const key = stockMatrixKey(variationId, colorId);
    if (!product.stockMatrix) product.stockMatrix = {};
    product.stockMatrix[key] = applySigned(
      product.stockMatrix[key] || 0,
      bundlesDelta,
      strict,
      label
    );
    const v = product.variations.find((x) => x.id === variationId);
    if (v) {
      const prevSecondary = v.stockSecondary ?? 0;
      v.stock = product.colors.reduce(
        (s, c) =>
          s +
          Math.max(
            0,
            product.stockMatrix?.[stockMatrixKey(variationId, c.id)] || 0
          ),
        0
      );
      v.stockSecondary = applySigned(
        prevSecondary,
        secondaryDelta,
        strict,
        `${label} (kg/pcs)`
      );
    }
    product.stock = product.variations.reduce((s, x) => s + (x.stock || 0), 0);
    product.stockSecondary = product.variations.reduce(
      (s, x) => s + (x.stockSecondary ?? 0),
      0
    );
    return;
  }
  // Size×color products without a color on the line: still move matrix stock
  // so inventory screens (which read the matrix) stay in sync.
  if (variationId && product.colors.length && !colorId) {
    if (!product.stockMatrix) product.stockMatrix = {};
    const remaining = bundlesDelta;
    if (remaining < 0) {
      // Deduct greedily across colors for this size
      let need = -remaining;
      for (const c of product.colors) {
        if (need <= 0) break;
        const key = stockMatrixKey(variationId, c.id);
        const have = product.stockMatrix[key] || 0;
        const take = Math.min(have, need);
        product.stockMatrix[key] = have - take;
        need -= take;
      }
      if (strict && need > 0.0001) {
        throw new Error(
          `Insufficient stock for ${label} (short ${need} bundles)`
        );
      }
    } else if (remaining > 0) {
      // Put stock back onto the first color bucket for this size
      const key = stockMatrixKey(variationId, product.colors[0].id);
      product.stockMatrix[key] = (product.stockMatrix[key] || 0) + remaining;
    }
    const v = product.variations.find((x) => x.id === variationId);
    if (v) {
      const prevSecondary = v.stockSecondary ?? 0;
      v.stock = product.colors.reduce(
        (s, c) =>
          s +
          Math.max(
            0,
            product.stockMatrix?.[stockMatrixKey(variationId, c.id)] || 0
          ),
        0
      );
      v.stockSecondary = applySigned(
        prevSecondary,
        secondaryDelta,
        strict,
        `${label} (kg/pcs)`
      );
    }
    product.stock = product.variations.reduce((s, x) => s + (x.stock || 0), 0);
    product.stockSecondary = product.variations.reduce(
      (s, x) => s + (x.stockSecondary ?? 0),
      0
    );
    return;
  }
  if (variationId) {
    const v = product.variations.find((x) => x.id === variationId);
    if (v) {
      v.stock = applySigned(v.stock || 0, bundlesDelta, strict, label);
      v.stockSecondary = applySigned(
        v.stockSecondary ?? 0,
        secondaryDelta,
        strict,
        `${label} (kg/pcs)`
      );
      product.stock = product.variations.reduce((s, x) => s + (x.stock || 0), 0);
      product.stockSecondary = product.variations.reduce(
        (s, x) => s + (x.stockSecondary ?? 0),
        0
      );
      return;
    }
  }
  product.stock = applySigned(
    product.stock || 0,
    bundlesDelta,
    strict,
    label
  );
  product.stockSecondary = applySigned(
    product.stockSecondary ?? 0,
    secondaryDelta,
    strict,
    `${label} (kg/pcs)`
  );
}

/** Ensure stockSecondary is populated from bundles × unit weight/pcs. */
export function ensureStockSecondary(product: Product): void {
  ensureStockMatrix(product);
  if (product.variations.length) {
    for (const v of product.variations) {
      if (v.stockSecondary == null) {
        v.stockSecondary = deriveSecondaryQty(product, v.stock || 0, v.id);
      }
    }
    product.stock = product.variations.reduce((s, x) => s + (x.stock || 0), 0);
    product.stockSecondary = product.variations.reduce(
      (s, x) => s + (x.stockSecondary ?? 0),
      0
    );
  } else if (product.stockSecondary == null) {
    product.stockSecondary = deriveSecondaryQty(product, product.stock || 0);
  }
}

/** Normalize product before save: matrix + secondary stock + rollup. */
export function normalizeProductStock(product: Product): Product {
  const next: Product = {
    ...product,
    variations: product.variations.map((v) => ({ ...v })),
    colors: product.colors.map((c) => ({ ...c })),
    stockMatrix: { ...(product.stockMatrix ?? {}) },
  };
  for (const v of next.variations) {
    if (v.weightKg != null && v.weightKg > 0) continue;
    if (
      isPackCountUnit(next.unit) &&
      resolveGsmPacketWeightKg(next, v) > 0
    ) {
      v.weightKg = 0;
      continue;
    }
    v.weightKg = next.baseWeightKg ?? 0;
  }
  ensureStockMatrix(next);
  if (next.variations.length) {
    for (const v of next.variations) {
      v.stock = Math.max(0, v.stock || 0);
      v.stockSecondary = deriveSecondaryQty(next, v.stock, v.id);
    }
    next.stock = next.variations.reduce((s, x) => s + (x.stock || 0), 0);
    next.stockSecondary = next.variations.reduce(
      (s, x) => s + (x.stockSecondary ?? 0),
      0
    );
  } else {
    next.stock = Math.max(0, next.stock || 0);
    next.stockSecondary = deriveSecondaryQty(
      next,
      next.stock,
      undefined,
      next.stockSecondary
    );
  }
  return next;
}

export function productStockSummary(product: Product): {
  bundles: number;
  secondary: number;
  fromVariations: boolean;
  fromMatrix: boolean;
} {
  ensureStockMatrix(product);
  if (product.variations.length) {
    return {
      bundles: product.variations.reduce((s, v) => s + (v.stock || 0), 0),
      secondary: product.variations.reduce(
        (s, v) => s + (v.stockSecondary ?? 0),
        0
      ),
      fromVariations: true,
      fromMatrix: product.colors.length > 0,
    };
  }
  return {
    bundles: product.stock || 0,
    secondary: product.stockSecondary ?? 0,
    fromVariations: false,
    fromMatrix: false,
  };
}

/** Apply inventory for sale/purchase/credit_note/debit_note. */
export function applyVoucherStock(
  db: StockDb,
  voucher: Voucher,
  createdBy: string,
  reverse = false
): void {
  const stockTypes = ["sale", "purchase", "credit_note", "debit_note"] as const;
  if (!stockTypes.includes(voucher.type as (typeof stockTypes)[number])) return;

  // credit_note = stock in (return); debit_note = stock out (return to supplier)
  const isIn =
    voucher.type === "purchase" || voucher.type === "credit_note";
  const direction: "in" | "out" = reverse
    ? isIn
      ? "out"
      : "in"
    : isIn
      ? "in"
      : "out";
  const type =
    voucher.type === "credit_note"
      ? reverse
        ? "void_sale"
        : "sale_return"
      : voucher.type === "debit_note"
        ? reverse
          ? "void_purchase"
          : "purchase_return"
        : reverse
          ? isIn
            ? "void_purchase"
            : "void_sale"
          : isIn
            ? "purchase"
            : "sale";

  for (const line of voucher.lines) {
    if (!line.productId || !line.qty) continue;
    const product = db.products.find((p) => p.id === line.productId);
    if (!product) continue;
    ensureStockSecondary(product);
    const bundles = line.qty;
    const secondary = deriveSecondaryQty(
      product,
      bundles,
      line.variationId,
      line.secondaryQty
    );
    const signedBundles = direction === "in" ? bundles : -bundles;
    const signedSecondary = direction === "in" ? secondary : -secondary;
    applyQty(
      product,
      line.variationId,
      line.colorId,
      signedBundles,
      signedSecondary
    );
    product.updatedAt = new Date().toISOString();

    const mov: StockMovement = {
      id: `sm_${crypto.randomUUID()}`,
      date: voucher.date.slice(0, 10),
      type,
      productId: line.productId,
      variationId: line.variationId,
      colorId: line.colorId,
      qty: bundles,
      secondaryQty: secondary,
      unit: line.unit || product.unit,
      direction,
      voucherId: voucher.id,
      orderId: voucher.linkedOrderId,
      note: `${voucher.number} · ${line.itemLabel}`,
      createdAt: new Date().toISOString(),
      createdBy,
    };
    db.stockMovements.unshift(mov);
  }
}

/** Stock in from GRN (not from purchase bill when linked). */
export function applyGrnStock(
  db: StockDb,
  grn: GoodsReceipt,
  createdBy: string,
  reverse = false
): void {
  if (grn.voided && !reverse) return;
  const direction: "in" | "out" = reverse ? "out" : "in";
  for (const line of grn.lines) {
    const label = line.itemLabel || "item";
    if (!line.productId) {
      throw new Error(
        `Cannot update stock for ${label}: pick a catalog item (product required)`
      );
    }
    const bundles = line.qty > 0 ? line.qty : 0;
    if (!(bundles > 0) && !((line.secondaryQty ?? 0) > 0)) {
      throw new Error(`Cannot update stock for ${label}: quantity required`);
    }
    const product = db.products.find((p) => p.id === line.productId);
    if (!product) {
      throw new Error(`Cannot update stock for ${label}: product not found`);
    }
    if (product.variations.length && !line.variationId) {
      throw new Error(
        `Cannot update stock for ${label}: choose size / variation`
      );
    }
    if (
      product.variations.length &&
      line.variationId &&
      !product.variations.some((v) => v.id === line.variationId)
    ) {
      throw new Error(
        `Cannot update stock for ${label}: size / variation not on this product`
      );
    }
    if (product.colors.length && !line.colorId) {
      throw new Error(`Cannot update stock for ${label}: choose a color`);
    }
    if (
      product.colors.length &&
      line.colorId &&
      !product.colors.some((c) => c.id === line.colorId)
    ) {
      throw new Error(
        `Cannot update stock for ${label}: color not on this product`
      );
    }
    ensureStockSecondary(product);
    const qtyBundles = bundles > 0 ? bundles : 1;
    const secondary = deriveSecondaryQty(
      product,
      qtyBundles,
      line.variationId,
      line.secondaryQty
    );
    const signedBundles = direction === "in" ? qtyBundles : -qtyBundles;
    const signedSecondary = direction === "in" ? secondary : -secondary;
    applyQty(
      product,
      line.variationId,
      line.colorId,
      signedBundles,
      signedSecondary
    );
    product.updatedAt = new Date().toISOString();
    db.stockMovements.unshift({
      id: `sm_${crypto.randomUUID()}`,
      date: grn.date.slice(0, 10),
      type: "grn",
      productId: line.productId,
      variationId: line.variationId,
      colorId: line.colorId,
      qty: qtyBundles,
      secondaryQty: secondary,
      unit: line.unit || product.unit,
      direction,
      note: `${grn.number} · ${line.itemLabel}`,
      createdAt: new Date().toISOString(),
      createdBy,
    });
  }
}

export function inventoryRows(db: StockDb): {
  productId: string;
  variationId?: string;
  colorId?: string;
  code: string;
  name: string;
  sku: string;
  stock: number;
  stockSecondary: number;
  unit: UnitOfSale;
}[] {
  const rows: {
    productId: string;
    variationId?: string;
    colorId?: string;
    code: string;
    name: string;
    sku: string;
    stock: number;
    stockSecondary: number;
    unit: UnitOfSale;
  }[] = [];
  for (const p of db.products.filter((x) => x.active)) {
    ensureStockSecondary(p);
    if (p.variations.length && p.colors.length) {
      for (const v of p.variations) {
        for (const c of p.colors) {
          const stock = getSizeColorStock(p, v.id, c.id);
          const vSecondary =
            v.stockSecondary ?? deriveSecondaryQty(p, v.stock || 0, v.id);
          const stockSecondary =
            (v.stock || 0) > 0
              ? roundMoney((vSecondary * stock) / (v.stock || 1))
              : deriveSecondaryQty(p, stock, v.id);
          rows.push({
            productId: p.id,
            variationId: v.id,
            colorId: c.id,
            code: p.code,
            name: `${p.name.en}${v.size?.en ? ` · ${v.size.en}` : ` · ${v.label.en}`} · ${c.name.en}`,
            sku: `${v.sku || p.code}-${c.name.en.slice(0, 3).toUpperCase()}`,
            stock,
            stockSecondary,
            unit: p.unit,
          });
        }
      }
    } else if (p.variations.length) {
      for (const v of p.variations) {
        rows.push({
          productId: p.id,
          variationId: v.id,
          code: p.code,
          name: `${p.name.en}${v.size?.en ? ` · ${v.size.en}` : ` · ${v.label.en}`}`,
          sku: v.sku || p.code,
          stock: v.stock ?? 0,
          stockSecondary: v.stockSecondary ?? 0,
          unit: p.unit,
        });
      }
    } else {
      rows.push({
        productId: p.id,
        code: p.code,
        name: p.name.en,
        sku: p.code,
        stock: p.stock ?? 0,
        stockSecondary: p.stockSecondary ?? 0,
        unit: p.unit,
      });
    }
  }
  return rows;
}

/** Stable SearchSelect value including color (size×color SKUs). */
export function catalogRowValue(row: {
  productId: string;
  variationId?: string;
  colorId?: string;
}): string {
  return `${row.productId}|${row.variationId ?? ""}|${row.colorId ?? ""}`;
}

export function parseCatalogRowValue(val: string): {
  productId: string;
  variationId?: string;
  colorId?: string;
} {
  const [productId = "", variationId = "", colorId = ""] = val.split("|");
  return {
    productId,
    variationId: variationId || undefined,
    colorId: colorId || undefined,
  };
}

/** True if the product has any sellable bundle stock. */
export function productHasSellableStock(product: Product): boolean {
  ensureStockSecondary(product);
  if (product.variations.length && product.colors.length) {
    return product.variations.some((v) =>
      product.colors.some((c) => getSizeColorStock(product, v.id, c.id) > 0)
    );
  }
  if (product.variations.length) {
    return product.variations.some((v) => (v.stock ?? 0) > 0);
  }
  return (product.stock ?? 0) > 0;
}

/**
 * Throw if free-form sale voucher lines exceed available size×color stock
 * (qty = bundles).
 */
export function assertSaleVoucherStockAvailable(
  db: StockDb,
  lines: {
    productId?: string;
    variationId?: string;
    colorId?: string;
    qty: number;
    itemLabel?: string;
  }[]
): void {
  const need = new Map<
    string,
    {
      productId: string;
      variationId?: string;
      colorId?: string;
      qty: number;
      label: string;
    }
  >();
  for (const line of lines) {
    if (!line.productId || !(line.qty > 0)) continue;
    const key = `${line.productId}:${line.variationId ?? ""}:${line.colorId ?? ""}`;
    const prev = need.get(key);
    const label = line.itemLabel || line.productId;
    if (prev) prev.qty += line.qty;
    else
      need.set(key, {
        productId: line.productId,
        variationId: line.variationId,
        colorId: line.colorId,
        qty: line.qty,
        label,
      });
  }
  for (const req of need.values()) {
    const product = db.products.find((p) => p.id === req.productId);
    if (!product) throw new Error(`Product missing: ${req.label}`);
    const avail = availableBundles(product, req.variationId, req.colorId);
    if (req.qty > avail) {
      throw new Error(
        `Out of stock: ${req.label} — need ${req.qty} bundles, available ${avail}`
      );
    }
  }
}

/** Available bundles for a product/variation/color. */
export function availableBundles(
  product: Product,
  variationId?: string,
  colorId?: string
): number {
  return getSizeColorStock(product, variationId, colorId);
}

/** Throw if any order line exceeds available size×color stock. */
export function assertOrderStockAvailable(
  db: StockDb,
  lines: Pick<
    OrderLine,
    | "productId"
    | "variationId"
    | "colorId"
    | "quantity"
    | "productName"
    | "size"
    | "colorName"
  >[]
): void {
  const need = new Map<
    string,
    {
      productId: string;
      variationId?: string;
      colorId?: string;
      qty: number;
      label: string;
    }
  >();
  for (const line of lines) {
    const key = `${line.productId}:${line.variationId ?? ""}:${line.colorId ?? ""}`;
    const prev = need.get(key);
    const label = [
      line.productName.en,
      line.size?.en,
      line.colorName?.en,
    ]
      .filter(Boolean)
      .join(" · ");
    if (prev) prev.qty += line.quantity;
    else
      need.set(key, {
        productId: line.productId,
        variationId: line.variationId,
        colorId: line.colorId,
        qty: line.quantity,
        label,
      });
  }
  for (const req of need.values()) {
    const product = db.products.find((p) => p.id === req.productId);
    if (!product) throw new Error(`Product missing: ${req.label}`);
    const avail = availableBundles(
      product,
      req.variationId,
      req.colorId
    );
    if (req.qty > avail) {
      throw new Error(
        `Insufficient stock for ${req.label}: need ${req.qty}, available ${avail}`
      );
    }
  }
}

/**
 * Reduce stock when estimate is placed (direction out),
 * or restore when cancelled (direction in).
 */
export function applyOrderEstimateStock(
  db: StockDb,
  order: {
    id: string;
    orderNumber: string;
    lines: OrderLine[];
  },
  createdBy: string,
  mode: "reserve" | "release"
): void {
  const direction: "in" | "out" = mode === "reserve" ? "out" : "in";
  const type = mode === "reserve" ? "estimate_reserve" : "estimate_release";
  const noteVerb = mode === "reserve" ? "Reserved for estimate" : "Released on cancel";
  const strict = mode === "reserve";

  // Snapshot affected products so a mid-order failure can roll back cleanly.
  const touched = new Map<
    string,
    {
      stock: number;
      stockSecondary?: number;
      stockMatrix?: Record<string, number>;
      variations: Array<{
        id: string;
        stock: number;
        stockSecondary?: number;
      }>;
    }
  >();
  const movementIds: string[] = [];

  const snapshotProduct = (product: Product) => {
    if (touched.has(product.id)) return;
    touched.set(product.id, {
      stock: product.stock || 0,
      stockSecondary: product.stockSecondary,
      stockMatrix: product.stockMatrix
        ? { ...product.stockMatrix }
        : undefined,
      variations: product.variations.map((v) => ({
        id: v.id,
        stock: v.stock || 0,
        stockSecondary: v.stockSecondary,
      })),
    });
  };

  const rollback = () => {
    for (const [id, snap] of touched) {
      const product = db.products.find((p) => p.id === id);
      if (!product) continue;
      product.stock = snap.stock;
      product.stockSecondary = snap.stockSecondary;
      product.stockMatrix = snap.stockMatrix
        ? { ...snap.stockMatrix }
        : product.stockMatrix;
      for (const vs of snap.variations) {
        const v = product.variations.find((x) => x.id === vs.id);
        if (!v) continue;
        v.stock = vs.stock;
        v.stockSecondary = vs.stockSecondary;
      }
    }
    if (movementIds.length) {
      const drop = new Set(movementIds);
      db.stockMovements = db.stockMovements.filter((m) => !drop.has(m.id));
    }
  };

  try {
    for (const line of order.lines) {
      if (!line.productId || !line.quantity) continue;
      const product = db.products.find((p) => p.id === line.productId);
      if (!product) {
        throw new Error(
          `Cannot ${mode} stock — product missing for ${line.productName?.en || line.productId}`
        );
      }
      snapshotProduct(product);
      ensureStockSecondary(product);
      const bundles = line.quantity;
      const secondary = deriveSecondaryQty(
        product,
        bundles,
        line.variationId,
        line.unit === "kg" ? line.weightKg : undefined
      );
      const signedBundles = direction === "in" ? bundles : -bundles;
      const signedSecondary = direction === "in" ? secondary : -secondary;
      applyQty(
        product,
        line.variationId,
        line.colorId,
        signedBundles,
        signedSecondary,
        { strict }
      );
      product.updatedAt = new Date().toISOString();

      const movId = `sm_${crypto.randomUUID()}`;
      movementIds.push(movId);
      db.stockMovements.unshift({
        id: movId,
        date: new Date().toISOString().slice(0, 10),
        type,
        productId: line.productId,
        variationId: line.variationId,
        colorId: line.colorId,
        qty: bundles,
        secondaryQty: secondary,
        unit: line.unit || product.unit,
        direction,
        orderId: order.id,
        note: `${noteVerb} ${order.orderNumber} · ${line.productName.en}${
          line.size?.en ? ` · ${line.size.en}` : ""
        }${line.colorName?.en ? ` · ${line.colorName.en}` : ""}`,
        createdAt: new Date().toISOString(),
        createdBy,
      });
    }
  } catch (err) {
    rollback();
    throw err;
  }
}

/**
 * Secondary (kg / pcs) a single order line currently holds against stock —
 * mirrors exactly what applyOrderEstimateStock reserved for it.
 */
export function orderLineSecondaryQty(db: StockDb, line: OrderLine): number {
  if (!line.productId || !line.quantity) return 0;
  const product = db.products.find((p) => p.id === line.productId);
  if (!product) return 0;
  return deriveSecondaryQty(
    product,
    line.quantity,
    line.variationId,
    line.unit === "kg" ? line.weightKg : undefined
  );
}

/**
 * Stock is reserved from the estimate weight, but the real weight only lands
 * at the packing slip / final bill. Without this the reservation keeps holding
 * the estimate forever — heavier actuals oversell, lighter ones strand stock.
 *
 * Pass the per-line secondary captured *before* the weights were overwritten.
 * Bundles never change here, so only the secondary side moves.
 */
export function rebalanceOrderReservation(
  db: StockDb,
  order: {
    id: string;
    orderNumber: string;
    lines: OrderLine[];
  },
  reservedSecondary: number[],
  createdBy: string
): void {
  order.lines.forEach((line, i) => {
    if (!line.productId || !line.quantity) return;
    const product = db.products.find((p) => p.id === line.productId);
    if (!product) return;
    const before = reservedSecondary[i] ?? 0;
    const after = orderLineSecondaryQty(db, line);
    const delta = roundMoney(after - before);
    if (Math.abs(delta) < 0.001) return;

    ensureStockSecondary(product);
    applyQty(product, line.variationId, line.colorId, 0, -delta);
    product.updatedAt = new Date().toISOString();

    db.stockMovements.unshift({
      id: `sm_${crypto.randomUUID()}`,
      date: new Date().toISOString().slice(0, 10),
      type: delta > 0 ? "estimate_reserve" : "estimate_release",
      productId: line.productId,
      variationId: line.variationId,
      colorId: line.colorId,
      qty: 0,
      secondaryQty: roundMoney(Math.abs(delta)),
      unit: line.unit || product.unit,
      direction: delta > 0 ? "out" : "in",
      orderId: order.id,
      note: `Actual weight ${order.orderNumber} · ${line.productName.en}${
        line.size?.en ? ` · ${line.size.en}` : ""
      }${line.colorName?.en ? ` · ${line.colorName.en}` : ""}`,
      createdAt: new Date().toISOString(),
      createdBy,
    });
  });
}

export function linesFromOrderProducts(
  lines: {
    productId: string;
    productName: { en: string };
    size?: { en: string };
    colorName?: { en: string };
    variationId?: string;
    colorId?: string;
    quantity: number;
    weightKg: number;
    rate: number;
    lineTotal: number;
    unit: UnitOfSale;
  }[]
): VoucherLine[] {
  return lines.map((l) => ({
    id: `vl_${crypto.randomUUID()}`,
    itemLabel: `${l.productName.en}${l.size?.en ? ` · ${l.size.en}` : ""}${
      l.colorName?.en ? ` · ${l.colorName.en}` : ""
    }`,
    qty: l.quantity,
    secondaryQty: l.unit === "kg" ? l.weightKg : l.quantity,
    unit: l.unit,
    rate: l.rate,
    amount: l.lineTotal,
    taxPercent: 0,
    productId: l.productId,
    variationId: l.variationId,
    colorId: l.colorId,
  }));
}

/** Amount from rate × kg/pcs (secondary), fallback to bundles. Sqft = packets × ₹/sqft math. */
export function voucherLineAmount(
  line: Pick<
    VoucherLine,
    "qty" | "secondaryQty" | "rate" | "unit" | "variationId"
  >,
  product?: Product | null
): number {
  const unit = line.unit || product?.unit;
  if (isSqftUnit(unit) && product) {
    const spec = resolveSqftPack(
      product,
      line.variationId
        ? product.variations.find((v) => v.id === line.variationId)
        : undefined
    );
    if (spec.lengthFt > 0 && spec.widthFt > 0 && spec.pcsPerPacket > 0) {
      return sqftPacketAmount({
        packets: line.qty,
        ratePerSqft: line.rate,
        lengthFt: spec.lengthFt,
        widthFt: spec.widthFt,
        pcsPerPacket: spec.pcsPerPacket,
      });
    }
  }
  const measure =
    line.secondaryQty != null && line.secondaryQty > 0
      ? line.secondaryQty
      : line.qty;
  return roundMoney(measure * line.rate);
}
