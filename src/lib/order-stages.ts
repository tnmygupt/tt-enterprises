import type { Order, OrderStatus } from "@/lib/types";

function orderHasLr(order: {
  lrNumber?: string;
  lrFileDataUrl?: string;
}): boolean {
  return Boolean(order.lrNumber?.trim() || order.lrFileDataUrl);
}

/** Main pipeline shown in order stage tracking. */
export const ORDER_STAGE_FLOW: OrderStatus[] = [
  "estimate",
  "confirmed",
  "payment_pending",
  "payment_verified",
  "dispatched",
  "delivered",
];

export type OrderStageKey = OrderStatus | "lr";

export function orderStageIndex(status: OrderStatus): number {
  if (status === "cancelled") return -1;
  return ORDER_STAGE_FLOW.indexOf(status);
}

/** True when moving from → to is allowed for staff status updates. */
export function canTransitionOrderStatus(
  from: OrderStatus,
  to: OrderStatus
): boolean {
  if (from === to) return true;
  if (from === "cancelled") return false;
  if (to === "cancelled") {
    return (
      from === "estimate" ||
      from === "confirmed" ||
      from === "payment_pending"
    );
  }
  if (to === "dispatched" || to === "delivered") {
    if (
      from !== "payment_verified" &&
      from !== "dispatched" &&
      from !== "delivered"
    ) {
      return false;
    }
  }
  const fi = orderStageIndex(from);
  const ti = orderStageIndex(to);
  if (fi < 0 || ti < 0) return false;
  // Forward only (billing may skip confirmed → payment_pending)
  return ti >= fi;
}

/** Drop dispatch/deliver (and other illegal jumps) that the previous row would not allow. */
export function revertIllegalOrderStatus<T extends { id: string; status: OrderStatus }>(
  incoming: T,
  previous: T | undefined
): T {
  if (!previous) {
    if (incoming.status === "dispatched" || incoming.status === "delivered") {
      return { ...incoming, status: "estimate" };
    }
    return incoming;
  }
  if (incoming.status === previous.status) return incoming;
  if (!canTransitionOrderStatus(previous.status, incoming.status)) {
    return { ...incoming, status: previous.status };
  }
  return incoming;
}

export function clampMergedOrders<T extends { id: string; status: OrderStatus }>(
  merged: T[],
  previous: T[] | undefined
): T[] {
  const prev = new Map((previous ?? []).map((o) => [o.id, o]));
  return merged.map((o) => revertIllegalOrderStatus(o, prev.get(o.id)));
}

export function allowedNextOrderStatuses(from: OrderStatus): OrderStatus[] {
  if (from === "cancelled") return ["cancelled"];
  const out: OrderStatus[] = [from];
  for (const s of ORDER_STAGE_FLOW) {
    if (canTransitionOrderStatus(from, s) && s !== from) out.push(s);
  }
  if (canTransitionOrderStatus(from, "cancelled")) out.push("cancelled");
  return out;
}

export type StageView = {
  key: OrderStageKey;
  done: boolean;
  current: boolean;
  labelEn: string;
  labelHi: string;
};

/** Derive stepper state from order status + LR / bill flags. */
export function buildOrderStageViews(order: Order): StageView[] {
  const cancelled = order.status === "cancelled";
  const idx = orderStageIndex(order.status);
  const hasBill =
    order.actualBillAmount != null ||
    !!order.billFileDataUrl ||
    order.packingSlip?.status === "finalized";
  const hasLr = orderHasLr(order);

  const labels: Record<
    OrderStatus,
    { en: string; hi: string }
  > = {
    estimate: { en: "Estimate", hi: "अनुमान" },
    confirmed: { en: "Confirmed", hi: "पुष्टि" },
    payment_pending: { en: "Bill / payment", hi: "बिल / भुगतान" },
    payment_verified: { en: "Payment verified", hi: "भुगतान सत्यापित" },
    dispatched: { en: "Dispatched", hi: "डिस्पैच" },
    delivered: { en: "Delivered", hi: "डिलीवर" },
    cancelled: { en: "Cancelled", hi: "रद्द" },
  };

  const stages: StageView[] = ORDER_STAGE_FLOW.map((key, i) => {
    let done = !cancelled && idx > i;
    let current = !cancelled && idx === i;
    // Treat billed packing-slip as payment_pending progress even if still estimate
    if (
      key === "payment_pending" &&
      hasBill &&
      (order.status === "estimate" || order.status === "confirmed")
    ) {
      done = true;
      current = false;
    }
    if (
      key === "payment_pending" &&
      hasBill &&
      order.status === "payment_pending"
    ) {
      current = true;
      done = false;
    }
    return {
      key,
      done,
      current,
      labelEn: labels[key].en,
      labelHi: labels[key].hi,
    };
  });

  // LR sits between dispatched and delivered (upload LR marks delivered)
  const dispatchIdx = stages.findIndex((s) => s.key === "dispatched");
  const lrDone = hasLr || order.status === "delivered";
  const lrCurrent =
    !cancelled &&
    !hasLr &&
    (order.status === "dispatched" || order.status === "payment_verified");
  stages.splice(dispatchIdx + 1, 0, {
    key: "lr",
    done: lrDone,
    current: lrCurrent,
    labelEn: "LR → delivered",
    labelHi: "LR → डिलीवर",
  });

  if (cancelled) {
    return [
      {
        key: "cancelled",
        done: true,
        current: true,
        labelEn: labels.cancelled.en,
        labelHi: labels.cancelled.hi,
      },
    ];
  }

  return stages;
}

/** Human label for timeline event status strings. */
export function timelineStatusLabel(
  status: string,
  locale: "en" | "hi"
): string {
  const map: Record<string, { en: string; hi: string }> = {
    estimate: { en: "Estimate", hi: "अनुमान" },
    confirmed: { en: "Confirmed", hi: "पुष्टि" },
    payment_pending: { en: "Payment pending", hi: "भुगतान बाकी" },
    payment_verified: { en: "Payment verified", hi: "भुगतान सत्यापित" },
    dispatched: { en: "Dispatched", hi: "डिस्पैच" },
    delivered: { en: "Delivered", hi: "डिलीवर" },
    cancelled: { en: "Cancelled", hi: "रद्द" },
    packing_slip: { en: "Packing slip", hi: "पैकिंग स्लिप" },
    packing_slip_finalized: {
      en: "Packing slip finalized",
      hi: "पैकिंग स्लिप फाइनल",
    },
    billed: { en: "Billed", hi: "बिल" },
    actual_weight: { en: "Actual weight", hi: "असली वजन" },
    payment_uploaded: { en: "Payment uploaded", hi: "भुगतान अपलोड" },
    payment_proof: { en: "Payment proof", hi: "भुगतान प्रमाण" },
    lr_uploaded: { en: "LR uploaded", hi: "LR अपलोड" },
  };
  const hit = map[status];
  if (hit) return locale === "hi" ? hit.hi : hit.en;
  return status.replaceAll("_", " ");
}
