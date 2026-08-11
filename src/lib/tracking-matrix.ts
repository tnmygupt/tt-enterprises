import type { AppDatabase } from "@/lib/store/db";
import { getAdminQueues, orderNextAction } from "@/lib/admin-queues";
import {
  computeOwnerMetrics,
  type AgingBucket,
  type DealerRankRow,
  type OwnerMetrics,
} from "@/lib/owner-metrics";
import {
  daysBetween,
  eachDayInclusive,
  inRange,
  type DateRange,
} from "@/lib/date-range";
import { orderHasLr } from "@/lib/store/db";
import type {
  AccessPlace,
  AccessSource,
  Order,
  UserRole,
} from "@/lib/types";

export type TrackingColumnKey =
  | "estimate"
  | "confirmed"
  | "need_bill"
  | "payment_pending"
  | "need_verify"
  | "payment_verified"
  | "need_lr"
  | "dispatched"
  | "delivered";

export type TrackingCard = {
  orderId: string;
  orderNumber: string;
  dealerName: string;
  dealerPhone: string;
  amount: number;
  weightKg: number;
  daysInStage: number;
  nextAction: string;
  status: Order["status"];
  href: string;
};

export type TrackingColumn = {
  key: TrackingColumnKey;
  labelEn: string;
  labelHi: string;
  count: number;
  amount: number;
  cards: TrackingCard[];
};

export type TrafficDaily = { date: string; visits: number; logins: number };

export type TrafficTopPath = { path: string; count: number };

export type PlacePin = {
  key: string;
  city: string;
  region?: string;
  country?: string;
  lat: number;
  lng: number;
  count: number;
  lastAt: string;
  sampleName?: string;
  sources: AccessSource[];
};

export type TrackingMatrix = {
  columns: TrackingColumn[];
  metrics: OwnerMetrics;
  aging: AgingBucket[];
  dealers: DealerRankRow[];
  traffic: {
    visits: number;
    logins: number;
    uniqueCities: number;
    topPage: string | null;
    daily: TrafficDaily[];
    topPaths: TrafficTopPath[];
    devices: { mobile: number; desktop: number; unknown: number };
  };
  places: PlacePin[];
  accessEvents: AccessPlace[];
};

const COLUMN_DEFS: {
  key: TrackingColumnKey;
  labelEn: string;
  labelHi: string;
}[] = [
  { key: "estimate", labelEn: "Estimate", labelHi: "अनुमान" },
  { key: "confirmed", labelEn: "Confirmed", labelHi: "पुष्टि" },
  { key: "need_bill", labelEn: "Need bill", labelHi: "बिल बाकी" },
  { key: "payment_pending", labelEn: "Pay pending", labelHi: "पेमेंट बाकी" },
  { key: "need_verify", labelEn: "Verify pay", labelHi: "पेमेंट जाँच" },
  {
    key: "payment_verified",
    labelEn: "Pay verified",
    labelHi: "पेमेंट OK",
  },
  { key: "need_lr", labelEn: "Need LR", labelHi: "LR बाकी" },
  { key: "dispatched", labelEn: "Dispatched", labelHi: "डिस्पैच" },
  { key: "delivered", labelEn: "Delivered", labelHi: "डिलीवर" },
];

function orderAmount(o: Order): number {
  return Number(o.actualBillAmount ?? o.estimatedTotal ?? 0) || 0;
}

function orderWeight(o: Order): number {
  return Number(o.actualWeightKg ?? o.estimatedWeightKg ?? 0) || 0;
}

function dealerOf(db: AppDatabase | null | undefined, userId: string) {
  const u = (db?.users ?? []).find((x) => x.id === userId);
  return {
    name: u?.name || u?.company || "Dealer",
    phone: u?.phone || "",
  };
}

function stageAnchor(o: Order): string {
  if (o.paymentProof && !o.paymentProof.verified) {
    return o.paymentProof.uploadedAt || o.updatedAt || o.createdAt;
  }
  return o.updatedAt || o.createdAt;
}

function columnForOrder(o: Order): TrackingColumnKey | null {
  if (o.status === "cancelled") return null;
  if (o.status === "delivered") return "delivered";
  if (o.status === "dispatched" && !orderHasLr(o)) return "need_lr";
  if (o.status === "dispatched") return "dispatched";
  if (o.status === "payment_verified") return "payment_verified";
  if (o.paymentProof && !o.paymentProof.verified) return "need_verify";
  if (o.status === "payment_pending") return "payment_pending";
  if (
    (o.status === "estimate" || o.status === "confirmed") &&
    o.actualBillAmount == null
  ) {
    // Prefer need_bill over raw estimate/confirmed when bill missing
    if (o.status === "confirmed") return "need_bill";
    return "estimate";
  }
  if (o.status === "confirmed") return "confirmed";
  if (o.status === "estimate") return "estimate";
  return null;
}

function toCard(
  db: AppDatabase | null | undefined,
  o: Order,
  now: number
): TrackingCard {
  const dealer = dealerOf(db, o.userId);
  return {
    orderId: o.id,
    orderNumber: o.orderNumber || o.id.slice(0, 8),
    dealerName: dealer.name,
    dealerPhone: dealer.phone,
    amount: orderAmount(o),
    weightKg: orderWeight(o),
    daysInStage: daysBetween(stageAnchor(o), now),
    nextAction: orderNextAction(o),
    status: o.status,
    href: `/admin/orders?q=${encodeURIComponent(o.orderNumber || o.id)}`,
  };
}

export function filterAccessPlaces(
  places: AccessPlace[],
  opts: {
    range: DateRange;
    source?: AccessSource | "all";
    q?: string;
    role?: UserRole | "all";
  }
): AccessPlace[] {
  const q = (opts.q || "").trim().toLowerCase();
  return places.filter((p) => {
    if (!inRange(p.at, opts.range.from, opts.range.to)) return false;
    if (opts.source && opts.source !== "all" && p.source !== opts.source) {
      return false;
    }
    if (opts.role && opts.role !== "all" && p.role !== opts.role) return false;
    if (q) {
      const hay = `${p.name || ""} ${p.phone || ""} ${p.city || ""} ${p.region || ""} ${p.path || ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function buildPlacePins(places: AccessPlace[]): PlacePin[] {
  const map = new Map<string, PlacePin>();
  for (const p of places) {
    if (p.lat == null || p.lng == null) continue;
    const city = p.city || p.region || p.country || "Unknown";
    const key = `${city}|${p.lat.toFixed(2)}|${p.lng.toFixed(2)}`;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, {
        key,
        city,
        region: p.region,
        country: p.country,
        lat: p.lat,
        lng: p.lng,
        count: 1,
        lastAt: p.at,
        sampleName: p.name,
        sources: [p.source],
      });
    } else {
      cur.count += 1;
      if (p.at > cur.lastAt) {
        cur.lastAt = p.at;
        cur.sampleName = p.name || cur.sampleName;
      }
      if (!cur.sources.includes(p.source)) cur.sources.push(p.source);
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

function buildTraffic(
  places: AccessPlace[],
  range: DateRange
): TrackingMatrix["traffic"] {
  const inPeriod = places.filter((p) =>
    inRange(p.at, range.from, range.to)
  );
  const visits = inPeriod.filter((p) => p.source === "page").length;
  const logins = inPeriod.filter((p) => p.source === "login").length;
  const cities = new Set(
    inPeriod
      .map((p) => p.city || p.region || "")
      .filter(Boolean)
  );

  const pathCounts = new Map<string, number>();
  for (const p of inPeriod) {
    if (p.source !== "page" || !p.path) continue;
    pathCounts.set(p.path, (pathCounts.get(p.path) || 0) + 1);
  }
  const topPaths = [...pathCounts.entries()]
    .map(([path, count]) => ({ path, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const devices = { mobile: 0, desktop: 0, unknown: 0 };
  for (const p of inPeriod) {
    const d = p.device || "unknown";
    devices[d] += 1;
  }

  const byDay = new Map<string, TrafficDaily>();
  for (const d of eachDayInclusive(range.from, range.to)) {
    byDay.set(d, { date: d, visits: 0, logins: 0 });
  }
  for (const p of inPeriod) {
    const day = p.at.slice(0, 10);
    const row = byDay.get(day);
    if (!row) continue;
    if (p.source === "page") row.visits += 1;
    else row.logins += 1;
  }

  return {
    visits,
    logins,
    uniqueCities: cities.size,
    topPage: topPaths[0]?.path ?? null,
    daily: [...byDay.values()],
    topPaths,
    devices,
  };
}

export function buildTrackingMatrix(
  db: AppDatabase | null | undefined,
  range: DateRange,
  opts?: {
    hideDelivered?: boolean;
    stuckOnly?: boolean;
    q?: string;
    col?: TrackingColumnKey | null;
    accessSource?: AccessSource | "all";
    accessQ?: string;
  }
): TrackingMatrix {
  const metrics = computeOwnerMetrics(db, range);
  const queues = getAdminQueues(db);
  const now = Date.now();
  const q = (opts?.q || "").trim().toLowerCase();

  // Seed columns with queue-aware membership for open work + status buckets
  const buckets = new Map<TrackingColumnKey, Order[]>();
  for (const def of COLUMN_DEFS) buckets.set(def.key, []);

  const openOrders = (db?.orders ?? []).filter((o) => o.status !== "cancelled");
  for (const o of openOrders) {
    const col = columnForOrder(o);
    if (!col) continue;
    if (opts?.hideDelivered && col === "delivered") continue;
    // Delivered only in selected period; open pipeline always visible
    if (col === "delivered" && !inRange(o.updatedAt || o.createdAt, range.from, range.to)) {
      continue;
    }
    buckets.get(col)?.push(o);
  }

  // Ensure queue lists surface even if status mapping differs
  for (const o of queues.needBill) {
    if (!buckets.get("need_bill")?.some((x) => x.id === o.id)) {
      if (o.status === "confirmed" || o.actualBillAmount == null) {
        /* already classified */
      }
    }
  }

  const columns: TrackingColumn[] = COLUMN_DEFS.filter((def) =>
    opts?.hideDelivered ? def.key !== "delivered" : true
  ).map((def) => {
    let list = buckets.get(def.key) ?? [];
    if (opts?.stuckOnly) {
      list = list.filter((o) => daysBetween(stageAnchor(o), now) > 2);
    }
    if (q) {
      list = list.filter((o) => {
        const d = dealerOf(db, o.userId);
        const hay = `${o.orderNumber} ${d.name} ${d.phone}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (opts?.col && opts.col !== def.key) {
      /* keep all columns but UI may focus */
    }
    const cards = list
      .map((o) => toCard(db, o, now))
      .sort((a, b) => b.daysInStage - a.daysInStage);
    return {
      key: def.key,
      labelEn: def.labelEn,
      labelHi: def.labelHi,
      count: cards.length,
      amount: cards.reduce((s, c) => s + c.amount, 0),
      cards,
    };
  });

  const accessEvents = filterAccessPlaces(db?.accessPlaces ?? [], {
    range,
    source: opts?.accessSource ?? "all",
    q: opts?.accessQ,
  });

  return {
    columns,
    metrics,
    aging: metrics.aging,
    dealers: metrics.dealers,
    traffic: buildTraffic(db?.accessPlaces ?? [], range),
    places: buildPlacePins(accessEvents),
    accessEvents,
  };
}
