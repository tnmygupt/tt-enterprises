import type { AppDatabase } from "@/lib/store/db";
import { getAdminQueues } from "@/lib/admin-queues";
import {
  daysBetween,
  eachDayInclusive,
  inRange,
  type DateRange,
} from "@/lib/date-range";
import type { Order, OrderStatus } from "@/lib/types";

export type FunnelStep = {
  status: OrderStatus | "payment_pending";
  labelEn: string;
  labelHi: string;
  count: number;
  amount: number;
};

export type DealerRankRow = {
  userId: string;
  name: string;
  phone: string;
  orders: number;
  billed: number;
  weightKg: number;
};

export type DailyRow = {
  date: string;
  orders: number;
  billed: number;
};

export type AgingBucket = {
  key: string;
  labelEn: string;
  labelHi: string;
  count: number;
};

export type OwnerMetrics = {
  ordersCreated: number;
  billedAmount: number;
  verifiedPaymentAmount: number;
  walletDepositsVerified: number;
  dealersWithOrders: number;
  avgOrderValue: number;
  backlog: {
    needConfirm: number;
    needBill: number;
    needVerify: number;
    needLr: number;
  };
  funnel: FunnelStep[];
  aging: AgingBucket[];
  dealers: DealerRankRow[];
  daily: DailyRow[];
};

function orderAmount(o: Order): number {
  return Number(o.actualBillAmount ?? o.estimatedTotal ?? 0) || 0;
}

function orderWeight(o: Order): number {
  return Number(o.actualWeightKg ?? o.estimatedWeightKg ?? 0) || 0;
}

const FUNNEL_STATUSES: {
  status: OrderStatus;
  labelEn: string;
  labelHi: string;
}[] = [
  { status: "estimate", labelEn: "Estimate", labelHi: "अनुमान" },
  { status: "confirmed", labelEn: "Confirmed", labelHi: "पुष्टि" },
  { status: "payment_pending", labelEn: "Payment pending", labelHi: "पेमेंट बाकी" },
  { status: "payment_verified", labelEn: "Payment verified", labelHi: "पेमेंट जाँचा" },
  { status: "dispatched", labelEn: "Dispatched", labelHi: "डिस्पैच" },
  { status: "delivered", labelEn: "Delivered", labelHi: "डिलीवर" },
  { status: "cancelled", labelEn: "Cancelled", labelHi: "रद्द" },
];

export function computeOwnerMetrics(
  db: AppDatabase | null | undefined,
  range: DateRange
): OwnerMetrics {
  const queues = getAdminQueues(db);
  const ordersInRange = (db?.orders ?? []).filter((o) =>
    inRange(o.createdAt, range.from, range.to)
  );

  const billedOrders = ordersInRange.filter(
    (o) =>
      o.actualBillAmount != null ||
      o.status === "payment_verified" ||
      o.status === "dispatched" ||
      o.status === "delivered"
  );
  const billedAmount = billedOrders.reduce((s, o) => s + orderAmount(o), 0);

  const verifiedPaymentAmount = ordersInRange
    .filter(
      (o) =>
        o.paymentProof?.verified ||
        o.status === "payment_verified" ||
        o.status === "dispatched" ||
        o.status === "delivered"
    )
    .reduce((s, o) => s + orderAmount(o), 0);

  const walletDepositsVerified = (db?.walletDeposits ?? [])
    .filter(
      (d) =>
        d.status === "verified" && inRange(d.verifiedAt || d.updatedAt, range.from, range.to)
    )
    .reduce((s, d) => s + (Number(d.amount) || 0), 0);

  const dealerIds = new Set(ordersInRange.map((o) => o.userId));
  const ordersCreated = ordersInRange.length;
  const avgOrderValue =
    ordersCreated > 0
      ? ordersInRange.reduce((s, o) => s + orderAmount(o), 0) / ordersCreated
      : 0;

  const funnel: FunnelStep[] = FUNNEL_STATUSES.map((step) => {
    const list = ordersInRange.filter((o) => o.status === step.status);
    return {
      status: step.status,
      labelEn: step.labelEn,
      labelHi: step.labelHi,
      count: list.length,
      amount: list.reduce((s, o) => s + orderAmount(o), 0),
    };
  });

  const now = Date.now();
  const openProofs = (db?.orders ?? []).filter(
    (o) =>
      o.paymentProof &&
      !o.paymentProof.verified &&
      o.status !== "cancelled"
  );
  const proofsOver2 = openProofs.filter(
    (o) => daysBetween(o.paymentProof!.uploadedAt || o.updatedAt, now) > 2
  ).length;
  const proofsOver5 = openProofs.filter(
    (o) => daysBetween(o.paymentProof!.uploadedAt || o.updatedAt, now) > 5
  ).length;
  const billAging = queues.needBill.filter(
    (o) => daysBetween(o.createdAt, now) > 2
  ).length;
  const lrAging = queues.needLr.filter(
    (o) => daysBetween(o.updatedAt || o.createdAt, now) > 2
  ).length;

  const aging: AgingBucket[] = [
    {
      key: "proof_2d",
      labelEn: "Payment proofs > 2 days",
      labelHi: "पेमेंट प्रूफ > 2 दिन",
      count: proofsOver2,
    },
    {
      key: "proof_5d",
      labelEn: "Payment proofs > 5 days",
      labelHi: "पेमेंट प्रूफ > 5 दिन",
      count: proofsOver5,
    },
    {
      key: "bill_2d",
      labelEn: "Bill pending > 2 days",
      labelHi: "बिल बाकी > 2 दिन",
      count: billAging,
    },
    {
      key: "lr_2d",
      labelEn: "LR pending > 2 days",
      labelHi: "LR बाकी > 2 दिन",
      count: lrAging,
    },
  ];

  const byDealer = new Map<string, DealerRankRow>();
  for (const o of ordersInRange) {
    if (o.status === "cancelled") continue;
    const cur = byDealer.get(o.userId) ?? {
      userId: o.userId,
      name: o.userName,
      phone: o.phone || "",
      orders: 0,
      billed: 0,
      weightKg: 0,
    };
    cur.orders += 1;
    cur.billed += orderAmount(o);
    cur.weightKg += orderWeight(o);
    byDealer.set(o.userId, cur);
  }
  const dealers = [...byDealer.values()].sort((a, b) => b.billed - a.billed);

  const dayMap = new Map<string, DailyRow>();
  for (const d of eachDayInclusive(range.from, range.to)) {
    dayMap.set(d, { date: d, orders: 0, billed: 0 });
  }
  for (const o of ordersInRange) {
    const day = o.createdAt.slice(0, 10);
    const row = dayMap.get(day);
    if (!row) continue;
    row.orders += 1;
    row.billed += orderAmount(o);
  }
  // Cap daily table to last 31 days of the range for readability
  const dailyAll = [...dayMap.values()];
  const daily =
    dailyAll.length > 31 ? dailyAll.slice(dailyAll.length - 31) : dailyAll;

  return {
    ordersCreated,
    billedAmount,
    verifiedPaymentAmount,
    walletDepositsVerified,
    dealersWithOrders: dealerIds.size,
    avgOrderValue,
    backlog: {
      needConfirm: queues.counts.need_confirm,
      needBill: queues.counts.need_bill,
      needVerify: queues.counts.need_verify_payment,
      needLr: queues.counts.need_lr,
    },
    funnel,
    aging,
    dealers: dealers.slice(0, 20),
    daily,
  };
}
