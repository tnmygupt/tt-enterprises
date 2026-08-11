import type {
  Order,
  OrderLine,
  PackingSlip,
  Party,
  Product,
  UserProfile,
  Voucher,
  VoucherLine,
} from "./types";
import {
  buildPackingSlipFromOrder,
  columnKgTotals,
  syncBundlesFromCells,
} from "./packing-slip";
import { companyFromSettings } from "./export-pdf";
import { buildPackingSlipPdfDataUrl } from "./packing-slip-pdf";
import { roundMoney } from "./pricing";

/**
 * A ledger party carries no transport of its own, so borrow the one the
 * dealer gave at checkout via the login the party is linked to. Without this
 * every voucher-built slip prints an empty TRANSPORT box.
 */
function transportForParty(
  party: Party | null | undefined,
  users: UserProfile[] | undefined
): string {
  if (!party?.linkedUserId || !users?.length) return "";
  return users.find((u) => u.id === party.linkedUserId)?.transport?.trim() || "";
}

function stockLines(lines: VoucherLine[]): VoucherLine[] {
  return lines.filter((l) => !l.accountId || !!l.productId);
}

/** Map voucher stock lines → order lines for packing-slip PDF. */
export function voucherLinesToOrderLines(
  lines: VoucherLine[],
  products: Product[]
): OrderLine[] {
  return stockLines(lines).map((l) => {
    const product = l.productId
      ? products.find((p) => p.id === l.productId)
      : undefined;
    const variation = product?.variations.find((v) => v.id === l.variationId);
    const color = product?.colors.find((c) => c.id === l.colorId);
    const qty = Math.max(0, Math.round(Number(l.qty) || 0));
    const kg =
      l.secondaryQty != null && l.secondaryQty > 0
        ? l.secondaryQty
        : qty * (variation?.weightKg ?? product?.baseWeightKg ?? 0);
    return {
      productId: l.productId || "",
      productCode: product?.code || "",
      productName: product?.name || { en: l.itemLabel, hi: l.itemLabel },
      variationId: l.variationId,
      variationLabel: variation?.label,
      size: variation?.size || variation?.label,
      colorId: l.colorId,
      colorName: color?.name,
      unit: l.unit || product?.unit || "kg",
      pricingMode: product?.pricingMode || "bundle",
      rate: l.rate,
      quantity: qty || 1,
      weightKg: kg,
      estimatedWeightKg: kg,
      actualWeightKg: kg,
      lineTotal: l.amount,
    };
  });
}

/**
 * Prefill packing-slip weighment cells from line kg so the PDF matches
 * order packing slips (one cell per ordered bundle).
 */
export function prefillSlipWeighments(
  slip: NonNullable<Order["packingSlip"]>,
  orderLines: OrderLine[]
): NonNullable<Order["packingSlip"]> {
  const next = structuredClone(slip);
  for (let c = 0; c < next.columns.length; c++) {
    const ordered = Math.max(0, next.columns[c].orderedBundles ?? 0);
    const kg = orderLines[c]?.actualWeightKg ?? orderLines[c]?.weightKg ?? 0;
    if (!(kg > 0) || ordered <= 0) continue;
    const per = roundMoney(kg / ordered);
    let remaining = kg;
    for (let r = 0; r < ordered && r < next.rows.length; r++) {
      const isLast = r === ordered - 1;
      const cell = isLast ? roundMoney(remaining) : per;
      next.rows[r].cells[c] = cell;
      remaining = roundMoney(remaining - cell);
    }
    next.bundles[c] = ordered;
  }
  void columnKgTotals(next);
  return next;
}

/** Draft packing slip from sale form lines (item + bundles) before save. */
export function buildDraftSlipFromSaleLines(input: {
  lines: VoucherLine[];
  products: Product[];
  party?: Party | null;
  users?: UserProfile[];
  numberHint?: string;
  previous?: PackingSlip | null;
}): PackingSlip | null {
  const orderLines = voucherLinesToOrderLines(
    input.lines,
    input.products
  ).filter((l) => l.quantity > 0 && (l.productId || l.productName.en));
  if (!orderLines.length) return null;

  const base: Pick<
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
  > = {
    orderNumber: input.numberHint || "DRAFT",
    lines: orderLines,
    checkoutName: input.party?.name || "",
    userName: input.party?.name || "",
    phone: input.party?.phone || "",
    deliveryAddress: input.party?.address || "",
    gstOrAadhar: input.party?.gstin || "",
    transport: transportForParty(input.party, input.users),
    customerNotes: "",
  };
  let slip = buildPackingSlipFromOrder(base);
  slip.status = "draft";

  const prev = input.previous;
  if (prev?.columns?.length) {
    for (let c = 0; c < slip.columns.length; c++) {
      const col = slip.columns[c];
      const matchIdx = prev.columns.findIndex(
        (p) =>
          (p.productId || "") === (col.productId || "") &&
          (p.variationId || "") === (col.variationId || "") &&
          (p.colorId || "") === (col.colorId || "") &&
          (p.orderedBundles ?? 0) === (col.orderedBundles ?? 0)
      );
      if (matchIdx < 0) continue;
      const ordered = col.orderedBundles ?? 0;
      for (let r = 0; r < ordered && r < slip.rows.length; r++) {
        const v = prev.rows[r]?.cells[matchIdx];
        if (v != null) slip.rows[r].cells[c] = v;
      }
    }
    slip = syncBundlesFromCells(slip);
  }
  return slip;
}

/** Every ordered bundle cell must have kg > 0. */
export function assertSaleSlipComplete(slip: PackingSlip): void {
  for (let c = 0; c < slip.columns.length; c++) {
    const ordered = Math.max(0, slip.columns[c].orderedBundles ?? 0);
    if (ordered <= 0) continue;
    for (let r = 0; r < ordered; r++) {
      const v = slip.rows[r]?.cells[c];
      if (!(typeof v === "number" && v > 0)) {
        throw new Error(
          `Fill packing slip: ${slip.columns[c].label} — bundle ${r + 1} of ${ordered}`
        );
      }
    }
  }
}

/** Copy column kg totals into voucher line secondaryQty / amount. */
export function applySlipKgToVoucherLines(
  lines: VoucherLine[],
  slip: PackingSlip
): VoucherLine[] {
  const totals = columnKgTotals(slip);
  let stockIdx = 0;
  return lines.map((l) => {
    const isStock = !l.accountId || !!l.productId;
    if (!isStock || !(l.qty > 0)) return l;
    const kg = totals[stockIdx] ?? 0;
    stockIdx += 1;
    if (!(kg > 0)) return l;
    const next = { ...l, secondaryQty: kg, amount: 0 };
    next.amount = roundMoney(kg * (l.rate || 0));
    return next;
  });
}

/** Build a synthetic order so we can reuse the order packing-slip PDF. */
export function buildOrderFromVoucher(input: {
  voucher: Voucher;
  party?: Party | null;
  products: Product[];
  users?: UserProfile[];
  slip?: PackingSlip | null;
}): Order {
  const { voucher, party, products } = input;
  const orderLines = voucherLinesToOrderLines(voucher.lines, products);
  const now = voucher.createdAt || new Date().toISOString();
  const base: Order = {
    id: `vo_${voucher.id}`,
    orderNumber: voucher.number,
    userId: party?.linkedUserId || "",
    userName: party?.name || "Customer",
    userEmail: "",
    status: "payment_pending",
    lines: orderLines,
    subtotal: voucher.subtotal,
    shippingAmount: 0,
    walletUsed: 0,
    estimatedTotal: voucher.total,
    actualBillAmount: voucher.total,
    fullTruckRequested: false,
    deliveryAddress: party?.address || "",
    phone: party?.phone || "",
    gstOrAadhar: party?.gstin || "",
    transport: transportForParty(party, input.users),
    checkoutName: party?.name || "",
    customerNotes: voucher.narration || "",
    timeline: [{ status: "estimate", at: now }],
    createdAt: now,
    updatedAt: now,
  };
  let slip: PackingSlip;
  if (input.slip) {
    slip = {
      ...structuredClone(input.slip),
      status: "finalized",
      date: voucher.date.slice(0, 10),
      slipNo: `PS-${voucher.number}`,
      finalizedAt: now,
    };
  } else {
    slip = buildPackingSlipFromOrder(base);
    slip = prefillSlipWeighments(slip, orderLines);
    slip.status = "finalized";
    slip.date = voucher.date.slice(0, 10);
    slip.finalizedAt = now;
  }
  base.packingSlip = slip;
  return base;
}

/** PDF data URL in the same format as order packing slips. */
export function buildVoucherPackingSlipPdfDataUrl(
  voucher: Voucher,
  db: {
    products: Product[];
    parties: Party[];
    users?: UserProfile[];
    settings?: Parameters<typeof companyFromSettings>[0];
  },
  locale: "en" | "hi" = "en",
  filledSlip?: PackingSlip | null
): string {
  const party = voucher.partyId
    ? db.parties.find((p) => p.id === voucher.partyId)
    : undefined;
  const order = buildOrderFromVoucher({
    voucher,
    party,
    products: db.products,
    users: db.users,
    slip: filledSlip,
  });
  if (!order.lines.length) {
    throw new Error("Add stock items before generating a packing slip");
  }
  return buildPackingSlipPdfDataUrl(
    order,
    locale,
    companyFromSettings(db.settings)
  );
}
