import type { Order, OrderLine, PackingSlip } from "./types";
import { isPackCountUnit, roundMoney, roundOffRupees } from "./pricing";

/** Fallback max rows; actual rows = max ordered bundles (see rowCountForOrder). */
export const PACKING_SLIP_ROW_COUNT = 25;

/** Full item label: name · size · color · code */
export function columnLabel(
  line: OrderLine,
  locale: "en" | "hi" = "en"
): string {
  const name = line.productName?.[locale] || line.productName?.en || "";
  const size =
    line.size?.[locale] ||
    line.size?.en ||
    line.variationLabel?.[locale] ||
    line.variationLabel?.en ||
    "";
  const color = line.colorName?.[locale] || line.colorName?.en || "";
  const code = line.productCode || "";
  const parts = [name, size, color, code].filter(Boolean);
  return parts.join(" · ") || name || code || "Item";
}

/** Rows tall enough for every ordered bundle (one weighment cell per bundle). */
export function rowCountForOrder(order: Pick<Order, "lines">): number {
  const maxQty = order.lines.reduce(
    (m, l) => Math.max(m, Math.max(0, Math.round(Number(l.quantity) || 0))),
    0
  );
  return Math.max(1, maxQty);
}

export function emptyRows(cols: number, rowCount: number): PackingSlip["rows"] {
  return Array.from({ length: rowCount }, () => ({
    cells: Array.from({ length: cols }, () => null as number | null),
  }));
}

/** Prefill a draft packing slip from an estimate/order. */
export function buildPackingSlipFromOrder(
  order: Pick<
    Order,
    | "orderNumber"
    | "lines"
    | "checkoutName"
    | "userName"
    | "phone"
    | "deliveryAddress"
    | "gstOrAadhar"
    | "transport"
    | "customerNotes"
  >
): PackingSlip {
  const cols = order.lines.length;
  const rows = rowCountForOrder(order);
  return {
    slipNo: `PS-${order.orderNumber}`,
    status: "draft",
    date: new Date().toISOString().slice(0, 10),
    partyName: order.checkoutName || order.userName,
    partyPhone: order.phone || "",
    partyAddress: order.deliveryAddress || "",
    partyGstin: order.gstOrAadhar || "",
    transport: order.transport || "",
    preparedBy: "",
    checkedBy: "",
    note: order.customerNotes || "",
    columns: order.lines.map((line, lineIndex) => ({
      lineIndex,
      label: columnLabel(line, "en"),
      productId: line.productId,
      variationId: line.variationId,
      colorId: line.colorId,
      rate: line.rate,
      pricingMode: line.pricingMode,
      orderedBundles: Math.max(0, Math.round(Number(line.quantity) || 0)),
    })),
    rows: emptyRows(cols, rows),
    bundles: Array.from({ length: cols }, () => null as number | null),
  };
}

/** Exact weighment totals (no round-up). */
export function columnKgTotalsRaw(slip: PackingSlip): number[] {
  const n = slip.columns.length;
  const totals = Array.from({ length: n }, () => 0);
  for (const row of slip.rows) {
    for (let c = 0; c < n; c++) {
      const v = row.cells[c];
      if (v != null && Number.isFinite(v) && v > 0) totals[c] += v;
    }
  }
  return totals.map((t) => roundMoney(t));
}

/**
 * Column kg used for bill / shipping / finalize (exact 2-decimal weighments).
 * Kg round-up removed — final rupee round-off is applied on bill amount.
 */
export function columnKgTotals(slip: PackingSlip): number[] {
  return columnKgTotalsRaw(slip);
}

export function grandKg(slip: PackingSlip): number {
  return roundMoney(columnKgTotals(slip).reduce((s, n) => s + n, 0));
}

export function grandKgRaw(slip: PackingSlip): number {
  return roundMoney(columnKgTotalsRaw(slip).reduce((s, n) => s + n, 0));
}

/** One bundle per cell that has weight &gt; 0 (auto). */
export function countBundlesFromCells(slip: PackingSlip, colIndex: number): number {
  let count = 0;
  for (const row of slip.rows) {
    const v = row.cells[colIndex];
    if (v != null && Number.isFinite(v) && v > 0) count += 1;
  }
  return count;
}

export function columnBundles(slip: PackingSlip): number[] {
  return slip.columns.map((_, i) => countBundlesFromCells(slip, i));
}

export function grandBundles(slip: PackingSlip): number {
  return columnBundles(slip).reduce((s, n) => s + n, 0);
}

/** Sync slip.bundles from weighment cells (auto). */
export function syncBundlesFromCells(slip: PackingSlip): PackingSlip {
  return {
    ...slip,
    bundles: columnBundles(slip).map((n) => n),
  };
}

/** Per-line actual kg from column weighment totals (aligned to order.lines). */
export function lineActualWeightsFromSlip(
  slip: PackingSlip,
  lineCount: number
): number[] {
  const totals = columnKgTotals(slip);
  if (slip.columns.length === lineCount) {
    return totals.map((t) => (t > 0 ? t : 0));
  }
  const out = Array.from({ length: lineCount }, () => 0);
  for (let ci = 0; ci < slip.columns.length; ci++) {
    const li = slip.columns[ci].lineIndex;
    if (li >= 0 && li < lineCount) out[li] = totals[ci] || 0;
  }
  return out;
}

/**
 * Weight for kg shipping slab.
 * - jhal: excluded (uses ₹/jhal instead)
 * - pkt/pcs/sqft: always admin pack weight × packs (never slip weighment)
 * - kg/other: slip weighment, else estimate line.weightKg
 */
export function shippingWeightFromSlip(
  order: Pick<Order, "lines">,
  slip: PackingSlip,
  products: { id: string; unit?: string }[]
): number {
  const kgTotals =
    slip.columns.length === order.lines.length
      ? columnKgTotals(slip)
      : lineActualWeightsFromSlip(slip, order.lines.length);
  let w = 0;
  for (let i = 0; i < order.lines.length; i++) {
    const line = order.lines[i];
    const unit =
      line.unit ||
      products.find((p) => p.id === line.productId)?.unit ||
      "";
    if (unit === "jhal") continue;
    if (isPackCountUnit(unit)) {
      const ordered = Math.max(0, Number(line.quantity) || 0);
      const packs = Math.max(
        0,
        columnBundles(slip)[i] || ordered
      );
      const totalPredefined =
        Number(line.estimatedWeightKg) || Number(line.weightKg) || 0;
      if (ordered > 0 && totalPredefined > 0 && packs > 0) {
        w += (totalPredefined / ordered) * packs;
      } else {
        w += totalPredefined;
      }
      continue;
    }
    const fromSlip = kgTotals[i] || 0;
    w += fromSlip > 0 ? fromSlip : Number(line.weightKg) || 0;
  }
  return roundMoney(w);
}

export function slipHasEntries(slip: PackingSlip): boolean {
  return grandKg(slip) > 0 || grandBundles(slip) > 0;
}

export type PackingSlipBillPreview = {
  lineAmounts: number[];
  subtotal: number;
  shippingAmount: number;
  schemeDiscount: number;
  walletUsed: number;
  billAmount: number;
  totalKg: number;
  totalBundles: number;
};

/**
 * Bill from slip weighments.
 * Bundle / kg / jhal = ₹/kg × kg; pkt/pcs/sqft = rate × packs (qty).
 * Shipping: slip.shippingAmount when set, else order.shippingAmount.
 */
export function computeBillFromSlip(
  order: Pick<
    Order,
    "lines" | "shippingAmount" | "walletUsed" | "schemeDiscount"
  >,
  slip: PackingSlip,
  opts?: { shippingAmount?: number; schemeDiscount?: number }
): PackingSlipBillPreview {
  const kgTotals =
    slip.columns.length === order.lines.length
      ? columnKgTotals(slip)
      : lineActualWeightsFromSlip(slip, order.lines.length);
  const bundles = columnBundles(slip);

  const lineAmounts = order.lines.map((line, i) => {
    const col = slip.columns[i];
    const rate = col?.rate ?? line.rate;
    const mode = col?.pricingMode ?? line.pricingMode;
    const kg = kgTotals[i] || 0;
    const b = bundles[i] || 0;
    if (mode === "pcs") {
      return roundMoney(rate * (b > 0 ? b : line.quantity));
    }
    return roundMoney(rate * kg);
  });

  const subtotal = roundMoney(lineAmounts.reduce((s, n) => s + n, 0));
  const shippingAmount = roundMoney(
    opts?.shippingAmount ??
      slip.shippingAmount ??
      order.shippingAmount ??
      0
  );
  const schemeDiscount = roundMoney(
    Math.min(
      Math.max(
        0,
        opts?.schemeDiscount ?? order.schemeDiscount ?? 0
      ),
      subtotal
    )
  );
  const walletUsed = roundMoney(
    Math.min(
      order.walletUsed || 0,
      Math.max(0, subtotal + shippingAmount - schemeDiscount)
    )
  );
  const billAmount = roundOffRupees(
    subtotal + shippingAmount - schemeDiscount - walletUsed
  );

  return {
    lineAmounts,
    subtotal,
    shippingAmount,
    schemeDiscount,
    walletUsed,
    billAmount,
    totalKg: roundMoney(kgTotals.reduce((s, n) => s + n, 0)),
    totalBundles: bundles.reduce((s, n) => s + n, 0),
  };
}

/** Rate label for column header (₹/kg or ₹/pc). */
export function columnRateLabel(
  col: Pick<PackingSlip["columns"][number], "rate" | "pricingMode">,
  locale: "en" | "hi" = "en"
): string {
  const unit =
    col.pricingMode === "pcs"
      ? locale === "hi"
        ? "/पीस"
        : "/pc"
      : locale === "hi"
        ? "/किग्रा"
        : "/kg";
  return `₹${roundMoney(col.rate)}${unit}`;
}

/** Parse kg allowing intermediate decimals like "12." while typing. */
export function parseKgInput(raw: string): {
  value: number | null;
  display: string;
} {
  const cleaned = raw.replace(/,/g, ".").replace(/[^\d.]/g, "");
  if (cleaned === "" || cleaned === ".") {
    return { value: null, display: cleaned === "." ? "0." : "" };
  }
  // Only one decimal point
  const parts = cleaned.split(".");
  const normalized =
    parts.length > 2
      ? `${parts[0]}.${parts.slice(1).join("")}`
      : cleaned;
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) {
    return { value: null, display: normalized };
  }
  return { value: n, display: normalized };
}

/** Ensure slip has enough rows for ordered bundles; backfill party/transport. */
export function normalizePackingSlip(
  order: Order,
  slip: PackingSlip
): PackingSlip {
  const needed = rowCountForOrder(order);
  const cols = slip.columns.length || order.lines.length;
  let rows = [...slip.rows];
  while (rows.length < needed) {
    rows.push({
      cells: Array.from({ length: cols }, () => null as number | null),
    });
  }
  // Pad cell arrays if columns grew
  rows = rows.map((r) => ({
    cells: Array.from({ length: cols }, (_, i) => r.cells[i] ?? null),
  }));

  const columns = slip.columns.map((c, i) => {
    const line = order.lines[c.lineIndex] ?? order.lines[i];
    return {
      ...c,
      label: line ? columnLabel(line, "en") : c.label,
      rate: line?.rate ?? c.rate,
      pricingMode: line?.pricingMode ?? c.pricingMode,
      orderedBundles: line
        ? Math.max(0, Math.round(Number(line.quantity) || 0))
        : c.orderedBundles,
    };
  });

  const next: PackingSlip = {
    ...slip,
    partyName: slip.partyName || order.checkoutName || order.userName,
    partyPhone: slip.partyPhone || order.phone || "",
    partyAddress: slip.partyAddress || order.deliveryAddress || "",
    partyGstin: slip.partyGstin || order.gstOrAadhar || "",
    transport: slip.transport || order.transport || "",
    shippingAmount:
      slip.shippingAmount != null
        ? slip.shippingAmount
        : order.shippingAmount,
    shippingManual: !!slip.shippingManual,
    roundUpKg: !!slip.roundUpKg,
    columns,
    rows,
  };
  return syncBundlesFromCells(next);
}

/** Rebuild columns from current order lines (draft only); keeps overlapping weighments when possible. */
export function refreshPackingSlipColumns(
  order: Order,
  previous?: PackingSlip | null
): PackingSlip {
  const next = buildPackingSlipFromOrder(order);
  if (!previous) return next;

  next.date = previous.date || next.date;
  next.partyName = previous.partyName || next.partyName;
  next.partyPhone = previous.partyPhone || next.partyPhone;
  next.partyAddress = previous.partyAddress || next.partyAddress;
  next.partyGstin = previous.partyGstin || next.partyGstin;
  // Order wins here, unlike the fields above: saving a slip draft already
  // pushes its transport onto the order, so anything newer on the order is a
  // deliberate edit. Keeping the slip value would print the old transporter.
  next.transport = next.transport || previous.transport;
  next.shippingAmount = previous.shippingAmount;
  next.shippingManual = previous.shippingManual;
  next.roundUpKg = previous.roundUpKg;
  next.preparedBy = previous.preparedBy ?? "";
  next.checkedBy = previous.checkedBy ?? "";
  next.note = previous.note ?? next.note;
  next.slipNo = previous.slipNo || next.slipNo;

  for (let ni = 0; ni < next.columns.length; ni++) {
    const nc = next.columns[ni];
    const pi = previous.columns.findIndex(
      (pc) =>
        pc.productId === nc.productId &&
        pc.variationId === nc.variationId &&
        pc.colorId === nc.colorId
    );
    if (pi < 0) continue;
    for (let r = 0; r < next.rows.length; r++) {
      const cell = previous.rows[r]?.cells[pi];
      next.rows[r].cells[ni] = cell ?? null;
    }
  }
  return syncBundlesFromCells(next);
}
