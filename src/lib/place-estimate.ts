import type { AppDatabase } from "@/lib/store/db";
import {
  applyOrderEstimateStock,
  assertOrderStockAvailable,
} from "@/lib/inventory";
import { buildPackingSlipFromOrder } from "@/lib/packing-slip";
import {
  buildOrderLine,
  roundMoney,
  roundOffRupees,
} from "@/lib/pricing";
import {
  applyBillDiscounts,
  billDiscountReceiptLabel,
  orderDiscountMathLabel,
  orderDiscountMathQty,
  pickBestOrderDiscount,
} from "@/lib/schemes";
import { calcShippingAmount } from "@/lib/shipping";
import type { CartItem, Order } from "@/lib/types";

export type PlaceEstimateInput = {
  userId: string;
  cart: CartItem[];
  deliveryAddress: string;
  customerNotes?: string;
  checkoutName: string;
  gstOrAadhar?: string;
  phone: string;
  transport?: string;
  walletToUse: number;
  fullTruckRequested: boolean;
  manualDiscountKind?: "percent" | "flat";
  manualDiscountValue?: number;
  /** Customers cannot set manual discounts; staff punch may. */
  allowManualDiscount?: boolean;
  /** Server checkout enforces this; admin punch may order for a pending dealer. */
  enforceDealerApproval?: boolean;
  locale?: "en" | "hi";
  /** Staff punch — dealer sees this as their website order. */
  punchedById?: string;
  punchedByName?: string;
};

function nextOrderNumber(db: Pick<AppDatabase, "orders">): string {
  const highest = (db.orders ?? []).reduce((max, o) => {
    const m = /TT-EST-(\d+)/i.exec(o.orderNumber || "");
    if (!m) return max;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  const seq = String(highest + 1).padStart(5, "0");
  const uniq = crypto.randomUUID().replace(/-/g, "").slice(0, 4).toUpperCase();
  return `TT-EST-${seq}-${uniq}`;
}

function countOrderJhals(
  lines: { productId?: string; quantity?: number; qty?: number; unit?: string }[],
  products: { id: string; unit: string }[]
): number {
  let n = 0;
  for (const l of lines) {
    const unit =
      l.unit || products.find((p) => p.id === l.productId)?.unit || "";
    if (unit !== "jhal") continue;
    n += Number(l.quantity ?? l.qty ?? 0) || 0;
  }
  return n;
}

function shippingWeightExcludingJhal(
  lines: { productId?: string; weightKg?: number; unit?: string }[],
  products: { id: string; unit: string }[]
): number {
  let w = 0;
  for (const l of lines) {
    const unit =
      l.unit || products.find((p) => p.id === l.productId)?.unit || "";
    if (unit === "jhal") continue;
    w += Number(l.weightKg ?? 0) || 0;
  }
  return Math.round(w * 100) / 100;
}

/**
 * Mutates `db` with a new estimate, stock reserve, and optional wallet debit.
 * Same math as the browser checkout path — used by the server place-order API
 * so cloud (not stale localStorage) is the source of truth.
 */
export function placeEstimateOnDatabase(
  db: AppDatabase,
  input: PlaceEstimateInput
): Order {
  const user = db.users.find((u) => u.id === input.userId);
  if (!user) throw new Error("User not found");
  if (
    input.enforceDealerApproval !== false &&
    user.role === "customer" &&
    user.approved !== true
  ) {
    throw new Error("Account pending approval");
  }
  if (user.active === false) {
    throw new Error("Account is inactive");
  }

  const cart = (input.cart ?? []).filter((item) => {
    const product = db.products.find((p) => p.id === item.productId);
    if (!product || product.active === false) return false;
    if (item.variationId) {
      return product.variations.some((v) => v.id === item.variationId);
    }
    return true;
  });
  if (!cart.length) throw new Error("Cart is empty");

  const lines = cart.map((item) => {
    const product = db.products.find((p) => p.id === item.productId);
    if (!product) throw new Error("Product missing");
    const variation = product.variations.find((v) => v.id === item.variationId);
    const color = product.colors.find((c) => c.id === item.colorId);
    return buildOrderLine({
      product,
      variation,
      colorId: color?.id,
      colorName: color?.name,
      quantity: item.quantity,
    });
  });

  if (!db.stockMovements) db.stockMovements = [];
  if (!db.walletTransactions) db.walletTransactions = [];
  if (!db.orders) db.orders = [];

  assertOrderStockAvailable(db, lines);

  const subtotal = roundMoney(lines.reduce((s, l) => s + l.lineTotal, 0));
  const totalWeightKg = shippingWeightExcludingJhal(lines, db.products);
  const jhalQty = countOrderJhals(lines, db.products);
  const shippingAmount = calcShippingAmount({
    settings: db.settings,
    shippingRules: db.shippingRules,
    subtotal,
    totalWeightKg,
    jhalQty,
  });
  const bestDiscount = pickBestOrderDiscount(
    db.schemes,
    user.assignedSchemeIds,
    lines,
    db.products
  );
  const manualKind = input.allowManualDiscount
    ? input.manualDiscountKind
    : undefined;
  const manualValue = input.allowManualDiscount
    ? input.manualDiscountValue
    : undefined;
  const applied = applyBillDiscounts({
    goodsSubtotal: subtotal,
    schemeAmount: bestDiscount?.amount ?? 0,
    manualKind,
    manualValue,
  });
  const schemeDiscount = applied.total;
  const maxWallet = Math.min(
    user.walletBalance,
    Math.max(0, subtotal + shippingAmount - schemeDiscount)
  );
  const walletUsed = roundMoney(
    Math.max(0, Math.min(input.walletToUse, maxWallet))
  );
  const estimatedTotal = roundOffRupees(
    subtotal + shippingAmount - schemeDiscount - walletUsed
  );

  const now = new Date().toISOString();
  const fullTruckOk =
    totalWeightKg >= (db.settings?.fullTruckMinWeightKg || 0) ||
    subtotal >= (db.settings?.fullTruckMinValue || 0);

  const order: Order = {
    id: `ord_${crypto.randomUUID()}`,
    orderNumber: nextOrderNumber(db),
    userId: user.id,
    userName: input.checkoutName.trim() || user.name,
    userEmail: user.email || user.phone,
    status: "estimate",
    lines,
    subtotal,
    shippingAmount,
    walletUsed,
    estimatedTotal,
    schemeDiscount: schemeDiscount > 0 ? schemeDiscount : undefined,
    schemeDiscountId: bestDiscount?.scheme.id,
    schemeDiscountLabel:
      schemeDiscount > 0
        ? billDiscountReceiptLabel(
            bestDiscount,
            applied,
            manualKind,
            manualValue,
            input.locale === "hi" ? "hi" : "en"
          )
        : undefined,
    schemeDiscountMath:
      applied.schemeAmount > 0
        ? orderDiscountMathLabel(
            bestDiscount,
            bestDiscount
              ? orderDiscountMathQty(bestDiscount.scheme, lines, db.products)
              : 0,
            input.locale === "hi" ? "hi" : "en"
          )
        : undefined,
    manualDiscountKind: manualKind,
    manualDiscountValue:
      manualKind && (manualValue || 0) > 0 ? manualValue : undefined,
    estimatedWeightKg: totalWeightKg,
    stockReserved: false,
    fullTruckRequested: !!input.fullTruckRequested && fullTruckOk,
    deliveryAddress: input.deliveryAddress,
    customerNotes: input.customerNotes,
    checkoutName: input.checkoutName.trim(),
    gstOrAadhar: input.gstOrAadhar?.trim(),
    phone: input.phone.trim(),
    transport: input.transport?.trim(),
    packingSlip: undefined,
    source: input.punchedById ? "staff" : "web",
    punchedBy: input.punchedById,
    timeline: [
      {
        status: "estimate",
        at: now,
        note: input.punchedByName
          ? `Estimate created · posted by ${input.punchedByName} (staff)`
          : "Estimate created · stock reserved",
      },
    ],
    createdAt: now,
    updatedAt: now,
  };

  order.packingSlip = buildPackingSlipFromOrder(order);
  order.timeline.push({
    status: "packing_slip",
    at: now,
    note: `Packing slip ${order.packingSlip.slipNo} created (draft)`,
  });

  applyOrderEstimateStock(db, order, user.id, "reserve");
  order.stockReserved = true;

  if (walletUsed > 0) {
    user.walletBalance = roundMoney(user.walletBalance - walletUsed);
    db.walletTransactions.push({
      id: `wt_${crypto.randomUUID()}`,
      userId: user.id,
      type: "debit",
      amount: walletUsed,
      reason: `Used on estimate ${order.orderNumber}`,
      orderId: order.id,
      createdAt: now,
      createdBy: user.id,
    });
  }

  order.schemeApplied = false;
  db.orders.unshift(order);
  return order;
}
