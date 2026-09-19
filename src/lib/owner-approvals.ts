import { roundMoney } from "@/lib/pricing";
import type {
  OwnerApproval,
  OwnerApprovalKind,
  Product,
  ProductVariation,
  Scheme,
  UserProfile,
} from "@/lib/types";

export type SellingRateSnapshot = {
  baseRate: number;
  ratePerSqft?: number;
  variations: { id: string; rate: number; ratePerSqft?: number }[];
};

export type SchemeAssignSnapshot = {
  dealerId: string;
  schemeId: string;
  assigned: boolean;
};

export type OwnerApprovalCollections = {
  products: Product[];
  schemes: Scheme[];
  users: UserProfile[];
  ownerApprovals?: OwnerApproval[];
};

export function ensureOwnerApprovals<T extends { ownerApprovals?: OwnerApproval[] }>(
  db: T
): T {
  if (!Array.isArray(db.ownerApprovals)) db.ownerApprovals = [];
  return db;
}

export function productRatesTargetKey(productId: string): string {
  return `product_rates:${productId}`;
}

export function schemeUpsertTargetKey(schemeId: string): string {
  return `scheme_upsert:${schemeId}`;
}

export function schemeDeleteTargetKey(schemeId: string): string {
  return `scheme_delete:${schemeId}`;
}

export function schemeAssignTargetKey(dealerId: string, schemeId: string): string {
  return `scheme_assign:${dealerId}:${schemeId}`;
}

export function pendingOwnerApprovals(
  list: OwnerApproval[] | undefined
): OwnerApproval[] {
  return (list ?? [])
    .filter((r) => r.status === "pending")
    .sort((a, b) => (b.updatedAt || b.requestedAt).localeCompare(a.updatedAt || a.requestedAt));
}

export function pendingProductRatesApproval(
  list: OwnerApproval[] | undefined,
  productId: string
): OwnerApproval | undefined {
  return pendingOwnerApprovals(list).find(
    (r) => r.kind === "product_rates" && r.productId === productId
  );
}

export function pendingSchemeApproval(
  list: OwnerApproval[] | undefined,
  schemeId: string
): OwnerApproval | undefined {
  return pendingOwnerApprovals(list).find(
    (r) =>
      (r.kind === "scheme_upsert" || r.kind === "scheme_delete") &&
      r.schemeId === schemeId
  );
}

export function extractSellingRates(product: Product): SellingRateSnapshot {
  return {
    baseRate: Number(product.baseRate) || 0,
    ratePerSqft:
      product.ratePerSqft != null ? Number(product.ratePerSqft) || 0 : undefined,
    variations: (product.variations ?? []).map((v) => ({
      id: v.id,
      rate: Number(v.rate) || 0,
      ratePerSqft:
        v.ratePerSqft != null ? Number(v.ratePerSqft) || 0 : undefined,
    })),
  };
}

export function sellingRatesEqual(
  a: SellingRateSnapshot | null | undefined,
  b: SellingRateSnapshot | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (roundMoney(a.baseRate) !== roundMoney(b.baseRate)) return false;
  if (roundMoney(a.ratePerSqft ?? 0) !== roundMoney(b.ratePerSqft ?? 0)) {
    return false;
  }
  if (a.variations.length !== b.variations.length) return false;
  const other = new Map(b.variations.map((v) => [v.id, v] as const));
  for (const v of a.variations) {
    const o = other.get(v.id);
    if (!o) return false;
    if (roundMoney(v.rate) !== roundMoney(o.rate)) return false;
    if (roundMoney(v.ratePerSqft ?? 0) !== roundMoney(o.ratePerSqft ?? 0)) {
      return false;
    }
  }
  return true;
}

function writeVariationRates(
  variation: ProductVariation,
  rate: number,
  ratePerSqft?: number
): void {
  variation.rate = rate;
  if (ratePerSqft != null) variation.ratePerSqft = ratePerSqft;
  else delete variation.ratePerSqft;
}

export function applySellingRatesToProduct(
  product: Product,
  snapshot: SellingRateSnapshot
): Product {
  product.baseRate = snapshot.baseRate;
  if (snapshot.ratePerSqft != null) product.ratePerSqft = snapshot.ratePerSqft;
  else delete product.ratePerSqft;
  const byId = new Map(snapshot.variations.map((v) => [v.id, v] as const));
  for (const v of product.variations ?? []) {
    const proposed = byId.get(v.id);
    if (!proposed) {
      writeVariationRates(v, 0, 0);
      continue;
    }
    writeVariationRates(v, proposed.rate, proposed.ratePerSqft);
  }
  return product;
}

export function zeroSellingRates(product: Product): Product {
  return applySellingRatesToProduct(product, {
    baseRate: 0,
    ratePerSqft: 0,
    variations: (product.variations ?? []).map((v) => ({
      id: v.id,
      rate: 0,
      ratePerSqft: 0,
    })),
  });
}

/** Keep non-rate fields from `product`; overlay live selling rates (or zero if new). */
export function overlayLiveSellingRates(
  product: Product,
  live: Product | null | undefined
): Product {
  if (!live) return zeroSellingRates(product);
  product.baseRate = Number(live.baseRate) || 0;
  if (live.ratePerSqft != null) product.ratePerSqft = Number(live.ratePerSqft) || 0;
  else delete product.ratePerSqft;
  const liveVars = new Map((live.variations ?? []).map((v) => [v.id, v] as const));
  for (const v of product.variations ?? []) {
    const lv = liveVars.get(v.id);
    if (lv) writeVariationRates(v, Number(lv.rate) || 0, lv.ratePerSqft);
    else writeVariationRates(v, 0, 0);
  }
  return product;
}

export function restoreSellingRatesFromCloud(
  incoming: Product[] | undefined,
  cloud: Product[] | undefined
): Product[] {
  const cloudById = new Map((cloud ?? []).map((p) => [p.id, p] as const));
  return (incoming ?? []).map((p) => {
    const next: Product = {
      ...p,
      variations: (p.variations ?? []).map((v) => ({ ...v })),
    };
    return overlayLiveSellingRates(next, cloudById.get(p.id));
  });
}

export function restoreAssignedSchemeIds(
  incoming: UserProfile[] | undefined,
  cloud: UserProfile[] | undefined
): UserProfile[] {
  const cloudById = new Map((cloud ?? []).map((u) => [u.id, u] as const));
  return (incoming ?? []).map((u) => {
    const prev = cloudById.get(u.id);
    return {
      ...u,
      assignedSchemeIds: prev ? [...(prev.assignedSchemeIds ?? [])] : [],
    };
  });
}

function schemeCompareShape(s: Scheme) {
  return {
    name: s.name,
    description: s.description,
    termsAndConditions: s.termsAndConditions,
    progressUnit: s.progressUnit,
    targetWeightKg: s.targetWeightKg,
    rewardType: s.rewardType,
    creditAmount: s.creditAmount,
    discountPerKg: s.discountPerKg,
    discountPercent: s.discountPercent,
    levels: s.levels,
    scopeType: s.scopeType,
    scopeCategory: s.scopeCategory,
    scopeProductIds: s.scopeProductIds,
    appliesToAllDealers: s.appliesToAllDealers,
    active: s.active,
    startDate: s.startDate,
    endDate: s.endDate,
  };
}

export function schemesEffectivelyEqual(
  a: Scheme | null | undefined,
  b: Scheme | null | undefined
): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return JSON.stringify(schemeCompareShape(a)) === JSON.stringify(schemeCompareShape(b));
}

function newApprovalId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `oa_${crypto.randomUUID()}`;
  }
  return `oa_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function pruneConflictingPending(
  list: OwnerApproval[],
  incoming: Pick<OwnerApproval, "kind" | "schemeId">
): OwnerApproval[] {
  if (incoming.kind === "scheme_delete" && incoming.schemeId) {
    return list.filter(
      (r) =>
        !(
          r.status === "pending" &&
          r.schemeId === incoming.schemeId &&
          r.kind === "scheme_upsert"
        )
    );
  }
  if (incoming.kind === "scheme_upsert" && incoming.schemeId) {
    return list.filter(
      (r) =>
        !(
          r.status === "pending" &&
          r.schemeId === incoming.schemeId &&
          r.kind === "scheme_delete"
        )
    );
  }
  return list;
}

/** Replace the last pending row for the same target instead of stacking. */
export function upsertPendingApproval(
  list: OwnerApproval[] | undefined,
  input: {
    kind: OwnerApprovalKind;
    targetKey: string;
    productId?: string;
    schemeId?: string;
    dealerId?: string;
    title: string;
    snapshot: OwnerApproval["snapshot"];
    requestedBy: string;
    requestedByName?: string;
  }
): OwnerApproval[] {
  const now = new Date().toISOString();
  let rows = pruneConflictingPending(list ?? [], input);
  const idx = rows.findIndex(
    (r) => r.status === "pending" && r.targetKey === input.targetKey
  );
  const next: OwnerApproval = {
    id: idx >= 0 ? rows[idx].id : newApprovalId(),
    kind: input.kind,
    status: "pending",
    targetKey: input.targetKey,
    productId: input.productId,
    schemeId: input.schemeId,
    dealerId: input.dealerId,
    title: input.title,
    snapshot: input.snapshot,
    requestedBy: input.requestedBy,
    requestedByName: input.requestedByName,
    requestedAt: idx >= 0 ? rows[idx].requestedAt : now,
    updatedAt: now,
  };
  if (idx >= 0) {
    const copy = [...rows];
    copy[idx] = next;
    return copy;
  }
  return [next, ...rows];
}

export function applyOwnerApproval(
  db: OwnerApprovalCollections,
  approval: OwnerApproval
): void {
  if (approval.kind === "product_rates") {
    const product = (db.products ?? []).find((p) => p.id === approval.productId);
    const proposed = approval.snapshot.proposed as SellingRateSnapshot | undefined;
    if (!product || !proposed) return;
    applySellingRatesToProduct(product, proposed);
    product.updatedAt = new Date().toISOString();
    return;
  }
  if (approval.kind === "scheme_upsert") {
    const proposed = approval.snapshot.proposed as Scheme | undefined;
    if (!proposed?.id) return;
    const idx = (db.schemes ?? []).findIndex((s) => s.id === proposed.id);
    if (idx >= 0) db.schemes[idx] = proposed;
    else db.schemes.unshift(proposed);
    return;
  }
  if (approval.kind === "scheme_delete") {
    const schemeId = approval.schemeId;
    if (!schemeId) return;
    db.schemes = (db.schemes ?? []).filter((s) => s.id !== schemeId);
    for (const user of db.users ?? []) {
      user.assignedSchemeIds = (user.assignedSchemeIds ?? []).filter(
        (id) => id !== schemeId
      );
      if (user.schemeProgress && schemeId in user.schemeProgress) {
        const next = { ...user.schemeProgress };
        delete next[schemeId];
        user.schemeProgress = next;
      }
      if (user.schemeValueProgress && schemeId in user.schemeValueProgress) {
        const next = { ...user.schemeValueProgress };
        delete next[schemeId];
        user.schemeValueProgress = next;
      }
    }
    return;
  }
  if (approval.kind === "scheme_assign") {
    const proposed = approval.snapshot.proposed as SchemeAssignSnapshot | undefined;
    const dealerId = proposed?.dealerId || approval.dealerId;
    const schemeId = proposed?.schemeId || approval.schemeId;
    if (!dealerId || !schemeId) return;
    const user = (db.users ?? []).find((u) => u.id === dealerId);
    if (!user) return;
    const ids = user.assignedSchemeIds ?? [];
    const assigned = proposed?.assigned !== false;
    if (assigned) {
      if (!ids.includes(schemeId)) user.assignedSchemeIds = [...ids, schemeId];
    } else {
      user.assignedSchemeIds = ids.filter((id) => id !== schemeId);
    }
  }
}

/** Apply approvals that just flipped to approved (owner merge safety net). */
export function applyNewlyApprovedOwnerApprovals(
  db: OwnerApprovalCollections,
  incoming: OwnerApproval[] | undefined,
  cloud: OwnerApproval[] | undefined
): void {
  const cloudById = new Map((cloud ?? []).map((r) => [r.id, r] as const));
  const newly = (incoming ?? []).filter((r) => {
    if (r.status !== "approved") return false;
    const prev = cloudById.get(r.id);
    return !prev || prev.status !== "approved";
  });
  newly.sort((a, b) =>
    (a.decidedAt || a.updatedAt).localeCompare(b.decidedAt || b.updatedAt)
  );
  for (const row of newly) applyOwnerApproval(db, row);
}

/**
 * Staff may add/replace pending rows. They cannot approve/reject or drop history.
 * Owner review uses last-write-wins by updatedAt.
 */
export function mergeOwnerApprovalsForStaff(
  incoming: OwnerApproval[] | undefined,
  cloud: OwnerApproval[] | undefined,
  ownerReview: boolean
): OwnerApproval[] {
  if (ownerReview) {
    const byId = new Map((cloud ?? []).map((r) => [r.id, r] as const));
    for (const row of incoming ?? []) {
      if (!row?.id) continue;
      const existing = byId.get(row.id);
      if (!existing) {
        byId.set(row.id, row);
        continue;
      }
      const inAt = row.updatedAt || row.requestedAt || "";
      const cloudAt = existing.updatedAt || existing.requestedAt || "";
      if (!cloudAt || inAt >= cloudAt) byId.set(row.id, row);
    }
    return [...byId.values()];
  }

  const decided = (cloud ?? []).filter((r) => r.status !== "pending");
  const cloudPending = (cloud ?? []).filter((r) => r.status === "pending");
  const incomingPending = (incoming ?? []).filter((r) => r.status === "pending");
  const byKey = new Map(cloudPending.map((r) => [r.targetKey, r] as const));
  for (const row of incomingPending) {
    if (!row.targetKey) continue;
    byKey.set(row.targetKey, {
      ...row,
      status: "pending",
      decidedBy: undefined,
      decidedAt: undefined,
    });
  }
  return [...decided, ...byKey.values()];
}

export function approvalKindLabel(
  kind: OwnerApprovalKind,
  locale: "en" | "hi"
): string {
  if (kind === "product_rates") {
    return locale === "hi" ? "सेलिंग रेट" : "Selling rates";
  }
  if (kind === "scheme_delete") {
    return locale === "hi" ? "स्कीम हटाएँ" : "Delete scheme";
  }
  if (kind === "scheme_assign") {
    return locale === "hi" ? "स्कीम असाइन" : "Assign scheme";
  }
  return locale === "hi" ? "स्कीम" : "Scheme";
}
