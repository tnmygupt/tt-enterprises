"use client";

import type { AppDatabase } from "@/lib/store/db";
import {
  getOpsPurgeAt,
  localOpsPurgeIsNewer,
  remoteOpsPurgeIsNewer,
  stripPrePurgeOps,
} from "@/lib/ops-purge";
import {
  applyTombsToUsers,
  clearTombsBeatenByUsers,
  mergeTombMaps,
  syncTombFields,
  tombsFromDb,
} from "@/lib/user-tombs";
import { getPublicDbApiKey, isSupabaseConfigured } from "./config";
import {
  rememberLiveConfig,
  setLiveSyncState,
  shouldPullFromLivePulse,
} from "./live";
import { sanitizeDbForCloud } from "./sanitize";

let apiAvailable: boolean | null = null;
let lastPushJson = "";
let lastCloudUpdatedAt: string | null = null;
let lastScope: "public" | "staff" | "dealer" | "owner" | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPushDb: AppDatabase | null = null;
let silentConflictRetries = 0;
let pushChain: Promise<boolean> = Promise.resolve(true);
const conflictListeners = new Set<(db: AppDatabase) => void>();

async function readLatestLocalDb(fallback: AppDatabase): Promise<AppDatabase> {
  try {
    const { loadDb } = await import("@/lib/store/db");
    return loadDb();
  } catch {
    return fallback;
  }
}

/** Lets the connection banner clear itself once the cloud accepts us again. */
function emitSyncOk(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("tt-sync-ok"));
}

function dbHeaders(json = false): HeadersInit {
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  const key = getPublicDbApiKey();
  if (key) headers["x-tt-db-key"] = key;
  return headers;
}

/** Sync is enabled when the server reports Supabase is configured via /api/db. */
export function supabaseSyncEnabled(): boolean {
  if (typeof window === "undefined") return isSupabaseConfigured();
  return apiAvailable === true;
}

export function lastPullScope(): typeof lastScope {
  return lastScope;
}

/** After login, drop the public-catalog probe stamp and pull the session slice. */
export async function repullForSession(): Promise<AppDatabase | null> {
  lastCloudUpdatedAt = null;
  try {
    const { loadDb } = await import("@/lib/store/db");
    return await pullCloudDatabase(loadDb());
  } catch {
    return null;
  }
}

function parseApiError(text: string): string {
  try {
    return String((JSON.parse(text) as { error?: string }).error || "");
  } catch {
    return "";
  }
}

/** Probe once so Hostinger server-only SUPABASE_* keys still enable sync. */
export async function detectSupabaseSync(): Promise<boolean> {
  if (typeof window === "undefined") return isSupabaseConfigured();
  if (apiAvailable === true) return true;
  try {
    const res = await fetch("/api/db", {
      cache: "no-store",
      credentials: "include",
      headers: dbHeaders(),
    });
    const bodyText = res.ok ? "" : await res.clone().text();
    const errorKind = bodyText ? parseApiError(bodyText) : "";
    if (res.ok || res.status === 204) {
      apiAvailable = true;
    } else if (res.status === 401 || res.status === 403) {
      // Bad public DB key is "Unauthorized". Session/account errors still
      // mean cloud is up — expire the cookie and keep sync on for a public retry.
      if (errorKind === "Unauthorized") {
        apiAvailable = false;
      } else {
        apiAvailable = true;
        emitSessionExpiredFromApi(res.status, bodyText);
      }
    } else {
      apiAvailable = false;
    }
  } catch {
    apiAvailable = false;
  }
  return apiAvailable === true;
}

/** Overlay catalog fields from a public (anonymous) pull without wiping local users/orders. */
export function mergePublicCatalog(
  local: AppDatabase,
  remote: AppDatabase
): AppDatabase {
  // Never copy opsPurgeAt from a public pull — that stamped the purge marker
  // while keeping old local orders, so the next owner push restored history.
  const remoteSettings = remote.settings ?? local.settings;
  const settings = remoteSettings
    ? {
        ...remoteSettings,
        opsPurgeAt: local.settings?.opsPurgeAt,
      }
    : local.settings;

  return {
    ...local,
    products: remote.products?.length ? remote.products : local.products,
    categories: remote.categories?.length ? remote.categories : local.categories,
    schemes: remote.schemes?.length ? remote.schemes : local.schemes,
    shippingRules: remote.shippingRules?.length
      ? remote.shippingRules
      : local.shippingRules,
    settings,
  };
}

function emitSessionExpiredFromApi(status: number, body: string): void {
  if (typeof window === "undefined") return;
  if (status !== 401 && status !== 403) return;
  let error = "";
  try {
    error = String((JSON.parse(body) as { error?: string }).error || "");
  } catch {
    /* ignore */
  }
  // Missing DB_API_KEY is "Unauthorized" — not a user session problem.
  if (error === "Unauthorized") return;
  window.dispatchEvent(
    new CustomEvent("tt-session-expired", {
      detail: error || "Session invalid",
    })
  );
  window.dispatchEvent(
    new CustomEvent("tt-sync-error", {
      detail: error || "Login required to sync — please log in again",
    })
  );
}

async function pullViaApi(): Promise<{
  db: AppDatabase;
  updatedAt?: string;
  scope?: "public" | "staff" | "dealer" | "owner";
} | null> {
  const res = await fetch("/api/db", {
    cache: "no-store",
    credentials: "include",
    headers: dbHeaders(),
  });
  const pullText = await res.text();
  let pullError = "";
  try {
    pullError = String((JSON.parse(pullText) as { error?: string }).error || "");
  } catch {
    pullError = "";
  }
  if (res.status === 204 || res.status === 404) return null;
  if (res.status === 401 || res.status === 403) {
    emitSessionExpiredFromApi(res.status, pullText);
    // Session/account 401 ≠ cloud off. Retry without cookies for catalog.
    if (pullError !== "Unauthorized") {
      const pub = await fetch("/api/db", {
        cache: "no-store",
        credentials: "omit",
        headers: dbHeaders(),
      });
      if (pub.ok) {
        const pubText = await pub.text();
        try {
          const pubData = JSON.parse(pubText) as {
            db?: AppDatabase;
            updatedAt?: string;
            scope?: "public" | "staff" | "dealer" | "owner";
          };
          if (pubData.db) {
            lastScope = "public";
            return {
              db: pubData.db,
              updatedAt: pubData.updatedAt,
              scope: "public",
            };
          }
        } catch {
          /* fall through to throw */
        }
      }
    }
  }
  if (!res.ok) throw new Error(`pull failed: ${res.status}`);
  if (!pullText.trim()) throw new Error("pull failed: empty body");
  const data = JSON.parse(pullText) as {
    db?: AppDatabase;
    updatedAt?: string;
    scope?: "public" | "staff" | "dealer" | "owner";
  };
  if (!data.db) return null;
  lastScope = data.scope ?? null;
  return { db: data.db, updatedAt: data.updatedAt, scope: data.scope };
}

function emitAppliedDb(db: AppDatabase): void {
  for (const fn of conflictListeners) {
    try {
      fn(db);
    } catch {
      /* ignore */
    }
  }
}

async function warnIfStaffGotPublicCatalog(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { getSession } = await import("@/lib/store/db");
    const session = getSession();
    if (!session || session.role === "customer") return;
    window.dispatchEvent(
      new CustomEvent("tt-sync-error", {
        detail:
          "Admin login cookie missing — log in again to see new dealer signups.",
      })
    );
  } catch {
    /* ignore */
  }
}

function mergeByIdKeepLocalOnly<T extends { id: string }>(
  remoteItems: T[] | undefined,
  localItems: T[] | undefined
): T[] {
  const byId = new Map((remoteItems ?? []).map((x) => [x.id, x] as const));
  for (const item of localItems ?? []) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }
  return [...byId.values()];
}

function mergeByIdPreferNewer<T extends { id: string; updatedAt?: string }>(
  remoteItems: T[] | undefined,
  localItems: T[] | undefined
): T[] {
  const byId = new Map((remoteItems ?? []).map((x) => [x.id, x] as const));
  for (const item of localItems ?? []) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    if (
      item.updatedAt &&
      existing.updatedAt &&
      item.updatedAt > existing.updatedAt
    ) {
      byId.set(item.id, item);
    }
  }
  return [...byId.values()];
}

/** Keep local-only users when a conflict reloads cloud (avoids wiping a just-created user). */
export function mergeLocalUsersIntoRemote(
  local: AppDatabase,
  remote: AppDatabase
): AppDatabase {
  const remoteTxIds = new Set(
    (remote.walletTransactions ?? []).map((t) => t.id)
  );
  const pendingWalletUserIds = new Set(
    (local.walletTransactions ?? [])
      .filter((t) => !remoteTxIds.has(t.id))
      .map((t) => t.userId)
  );
  let tombs = mergeTombMaps(tombsFromDb(remote), tombsFromDb(local));
  // Only a NEWER local createdAt (re-create) may clear a tomb.
  tombs = clearTombsBeatenByUsers(tombs, local.users ?? []);
  const tombFields = syncTombFields(tombs);

  const byId = new Map(
    applyTombsToUsers(remote.users ?? [], tombs).map(
      (u) => [u.id, { ...u }] as const
    )
  );
  for (const u of local.users ?? []) {
    if (!applyTombsToUsers([u], tombs).length) {
      continue;
    }
    const remoteU = byId.get(u.id);
    if (!remoteU) {
      // Cloud directory is truth for dealers. Do not pull a deleted login
      // back from this browser, then push it to every other device.
      if (u.role === "customer") continue;
      byId.set(u.id, { ...u });
      continue;
    }
    // Keep local wallet if we still have unsynced wallet txs for this user
    if (pendingWalletUserIds.has(u.id)) {
      byId.set(u.id, { ...remoteU, walletBalance: u.walletBalance });
    }
  }
  const partyById = new Map(
    (remote.parties ?? []).map((p) => [p.id, { ...p }] as const)
  );
  for (const p of local.parties ?? []) {
    if (!partyById.has(p.id)) partyById.set(p.id, { ...p });
  }
  return {
    ...remote,
    users: [...byId.values()],
    deletedUserIds: tombFields.deletedUserIds,
    deletedUserAt: tombFields.deletedUserAt,
    parties: [...partyById.values()],
  };
}

// Re-export purge helpers for callers that imported from sync before.
export { remoteOpsPurgeIsNewer, localOpsPurgeIsNewer } from "@/lib/ops-purge";

/**
 * Cloud poll / 409 must not erase a just-placed order (or its wallet/stock
 * side effects) before the debounced push lands.
 */
function mergePendingCollections(
  local: AppDatabase,
  remote: AppDatabase
): AppDatabase {
  const base = mergeLocalUsersIntoRemote(local, remote);
  const orders = mergeByIdPreferNewer(remote.orders, local.orders);
  const localOnlyOrderIds = new Set(
    (local.orders ?? [])
      .filter((o) => !(remote.orders ?? []).some((r) => r.id === o.id))
      .map((o) => o.id)
  );
  const localOnlyGrnIds = new Set(
    (local.goodsReceipts ?? [])
      .filter((g) => !(remote.goodsReceipts ?? []).some((r) => r.id === g.id))
      .map((g) => g.id)
  );
  const localOnlyStockMovements = (local.stockMovements ?? []).some(
    (m) => !(remote.stockMovements ?? []).some((r) => r.id === m.id)
  );

  // Prefer newer product rows (GRN / sale update updatedAt). If we still have
  // local-only orders or GRNs, keep the full local catalog so stock can't
  // snap back to a stale cloud snapshot mid-push.
  let products = mergeByIdPreferNewer(remote.products, local.products);
  // Dealer/public pulls strip stockMovements to []. Treating those as
  // "local-only movements" kept the undeducted local catalog after an
  // estimate, so the shop still showed old bundle counts.
  const remoteHasMovementLedger = (remote.stockMovements ?? []).length > 0;
  const keepLocalCatalog =
    remoteHasMovementLedger &&
    (localOnlyOrderIds.size > 0 ||
      localOnlyGrnIds.size > 0 ||
      localOnlyStockMovements) &&
    (local.products?.length || 0) > 0;
  if (keepLocalCatalog) {
    products = local.products;
  }
  if (!(products?.length) && (local.products?.length || 0) > 0) {
    products = local.products;
  }

  return stripPrePurgeOps({
    ...base,
    products,
    orders,
    walletTransactions: mergeByIdKeepLocalOnly(
      remote.walletTransactions,
      local.walletTransactions
    ),
    walletDeposits: mergeByIdPreferNewer(
      remote.walletDeposits,
      local.walletDeposits
    ),
    stockMovements: mergeByIdKeepLocalOnly(
      remote.stockMovements,
      local.stockMovements
    ),
    goodsReceipts: mergeByIdKeepLocalOnly(
      remote.goodsReceipts,
      local.goodsReceipts
    ),
    purchaseOrders: mergeByIdKeepLocalOnly(
      remote.purchaseOrders,
      local.purchaseOrders
    ),
    vouchers: mergeByIdKeepLocalOnly(remote.vouchers, local.vouchers),
    ledgerEntries: mergeByIdKeepLocalOnly(
      remote.ledgerEntries,
      local.ledgerEntries
    ),
    stockBatches: mergeByIdKeepLocalOnly(
      remote.stockBatches,
      local.stockBatches
    ),
    // Without this the layer decrements survive the merge but the audit rows
    // that let voidVoucher put the qty back do not.
    batchConsumptions: mergeByIdKeepLocalOnly(
      remote.batchConsumptions,
      local.batchConsumptions
    ),
    billAllocations: mergeByIdKeepLocalOnly(
      remote.billAllocations,
      local.billAllocations
    ),
    accounts: mergeByIdKeepLocalOnly(remote.accounts, local.accounts),
    supplierContracts: mergeByIdKeepLocalOnly(
      remote.supplierContracts,
      local.supplierContracts
    ),
    statementMatches: mergeByIdKeepLocalOnly(
      remote.statementMatches,
      local.statementMatches
    ),
    bankRecons: mergeByIdKeepLocalOnly(
      remote.bankRecons,
      local.bankRecons
    ),
  });
}

/**
 * Cloud poll / 409 must not erase a just-placed order (or its wallet/stock
 * side effects) before the debounced push lands.
 */
export function mergeLocalPendingIntoRemote(
  local: AppDatabase,
  remote: AppDatabase
): AppDatabase {
  // After an admin ops purge, trust cloud — stale localStorage must not
  // re-merge deleted users/orders and push them back.
  if (remoteOpsPurgeIsNewer(local, remote)) {
    return stripPrePurgeOps(remote);
  }

  // Local wipe stamp is newer — still keep cloud rows created after that
  // stamp. Replacing orders with local [] was hiding (and re-pushing a wipe of)
  // estimates placed from another device after launch wipe.
  if (localOpsPurgeIsNewer(local, remote)) {
    const stamp = getOpsPurgeAt(local);
    const settings = {
      ...(remote.settings ?? {}),
      ...(local.settings ?? {}),
      opsPurgeAt: stamp,
    };
    const merged = mergePendingCollections(
      { ...local, settings },
      { ...remote, settings }
    );
    return merged;
  }

  return mergePendingCollections(local, remote);
}

/** True when merge added / preferred local rows that cloud did not have. */
export function localPendingDiffers(
  local: AppDatabase,
  merged: AppDatabase,
  remote: AppDatabase
): boolean {
  // Never push a history wipe from localStorage. Launch wipe is server-side
  // (/api/admin/purge-ops). A stale browser with a newer opsPurgeAt and
  // empty orders must not overwrite cloud estimates or tombstone dealers.
  const remoteOrderIds = new Set((remote.orders ?? []).map((o) => o.id));
  if ((local.orders ?? []).some((o) => !remoteOrderIds.has(o.id))) return true;
  const remoteTxIds = new Set((remote.walletTransactions ?? []).map((t) => t.id));
  if ((local.walletTransactions ?? []).some((t) => !remoteTxIds.has(t.id)))
    return true;
  const remoteDepositIds = new Set(
    (remote.walletDeposits ?? []).map((d) => d.id)
  );
  if ((local.walletDeposits ?? []).some((d) => !remoteDepositIds.has(d.id)))
    return true;
  const remoteGrnIds = new Set((remote.goodsReceipts ?? []).map((g) => g.id));
  if ((local.goodsReceipts ?? []).some((g) => !remoteGrnIds.has(g.id)))
    return true;
  const remotePoIds = new Set((remote.purchaseOrders ?? []).map((p) => p.id));
  if ((local.purchaseOrders ?? []).some((p) => !remotePoIds.has(p.id)))
    return true;
  const remoteVoucherIds = new Set((remote.vouchers ?? []).map((v) => v.id));
  if ((local.vouchers ?? []).some((v) => !remoteVoucherIds.has(v.id)))
    return true;
  const remoteMovementIds = new Set(
    (remote.stockMovements ?? []).map((m) => m.id)
  );
  if ((local.stockMovements ?? []).some((m) => !remoteMovementIds.has(m.id)))
    return true;
  const remoteProductById = new Map(
    (remote.products ?? []).map((p) => [p.id, p] as const)
  );
  if (
    (local.products ?? []).some((p) => {
      const r = remoteProductById.get(p.id);
      if (!r) return true;
      return !!(p.updatedAt && (!r.updatedAt || p.updatedAt > r.updatedAt));
    })
  ) {
    return true;
  }
  const remoteUserIds = new Set((remote.users ?? []).map((u) => u.id));
  const remoteTombs = tombsFromDb(remote);
  if (
    (local.users ?? []).some(
      (u) =>
        u.role !== "customer" &&
        !remoteUserIds.has(u.id) &&
        applyTombsToUsers([u], remoteTombs).length
    )
  ) {
    return true;
  }
  // Local has newer/missing tombstones cloud lacks — must push deletes
  const localTombs = tombsFromDb(local);
  for (const [id, at] of Object.entries(localTombs)) {
    if (!remoteTombs[id] || at > remoteTombs[id]) return true;
  }
  void merged;
  return false;
}

async function pushViaApi(
  db: AppDatabase,
  opts?: { isConflictRetry?: boolean }
): Promise<boolean> {
  const res = await fetch("/api/db", {
    method: "PUT",
    credentials: "include",
    headers: dbHeaders(true),
    body: JSON.stringify({
      db: sanitizeDbForCloud(db),
      baseUpdatedAt: lastCloudUpdatedAt,
    }),
  });
  if (res.status === 401 || res.status === 403) {
    let reason = "Login required to sync — please log in again";
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) reason = data.error;
    } catch {
      /* ignore */
    }
    console.warn("[supabase] push unauthorized:", reason);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tt-sync-error", { detail: reason })
      );
    }
    return false;
  }
  if (res.status === 409) {
    let conflictUpdatedAt: string | null = null;
    try {
      const conflictBody = (await res.json()) as { updatedAt?: string };
      if (conflictBody.updatedAt) {
        conflictUpdatedAt = conflictBody.updatedAt;
        lastCloudUpdatedAt = conflictBody.updatedAt;
      }
    } catch {
      /* ignore */
    }
    console.warn("[supabase] push conflict — reloading cloud and retrying");
    try {
      const remote = await pullViaApi();
      if (remote) {
        if (remote.updatedAt) lastCloudUpdatedAt = remote.updatedAt;
        else if (conflictUpdatedAt) lastCloudUpdatedAt = conflictUpdatedAt;
        const localNow = await readLatestLocalDb(db);
        const base =
          remote.scope === "public"
            ? mergePublicCatalog(localNow, remote.db)
            : remote.db;
        const applyDb =
          remote.scope === "public"
            ? base
            : mergeLocalPendingIntoRemote(localNow, base);
        const json = JSON.stringify(sanitizeDbForCloud(applyDb));
        const hadLocalPending =
          remote.scope !== "public" &&
          localPendingDiffers(localNow, applyDb, base);
        const needsPush =
          remote.scope !== "public" &&
          !remoteOpsPurgeIsNewer(localNow, base) &&
          hadLocalPending;
        if (!needsPush) lastPushJson = json;
        for (const fn of conflictListeners) {
          try {
            fn(applyDb);
          } catch {
            /* ignore */
          }
        }
        if (needsPush && !opts?.isConflictRetry && silentConflictRetries < 2) {
          silentConflictRetries += 1;
          const ok = await pushViaApi(applyDb, { isConflictRetry: true });
          if (ok) {
            silentConflictRetries = 0;
            lastPushJson = JSON.stringify(sanitizeDbForCloud(applyDb));
            return true;
          }
        }
        if (!needsPush) {
          silentConflictRetries = 0;
          return true;
        }
      }
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tt-sync-error", {
          detail:
            "Sync conflict — another device saved first. Reloaded cloud data; retry your change if it was lost.",
        })
      );
    }
    return false;
  }
  if (!res.ok) {
    let reason = `Sync failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) reason = data.error;
    } catch {
      /* ignore */
    }
    console.warn("[supabase] push failed:", reason);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tt-sync-error", { detail: reason })
      );
    }
    return false;
  }
  try {
    const data = (await res.json()) as {
      updatedAt?: string;
      rejectedOrders?: Array<{
        id: string;
        orderNumber: string;
        reason: string;
      }>;
    };
    if (data.updatedAt) lastCloudUpdatedAt = data.updatedAt;
    silentConflictRetries = 0;
    if (data.rejectedOrders?.length && typeof window !== "undefined") {
      const labels = data.rejectedOrders
        .map((r) => r.orderNumber || r.id)
        .join(", ");
      window.dispatchEvent(
        new CustomEvent("tt-sync-error", {
          detail: `Stock no longer available — order(s) not saved: ${labels}. Update quantities and try again.`,
        })
      );
      window.dispatchEvent(
        new CustomEvent("tt-orders-rejected", {
          detail: data.rejectedOrders,
        })
      );
    }
    // Server merge keeps cloud-only signups; pull so this tab sees them.
    try {
      const remote = await pullViaApi();
      if (remote?.db) {
        if (remote.scope === "public") {
          await warnIfStaffGotPublicCatalog();
        } else {
          if (remote.updatedAt) lastCloudUpdatedAt = remote.updatedAt;
          const localNow = await readLatestLocalDb(db);
          const applyDb = mergeLocalPendingIntoRemote(localNow, remote.db);
          lastPushJson = JSON.stringify(sanitizeDbForCloud(applyDb));
          emitAppliedDb(applyDb);
        }
      }
    } catch {
      /* push already succeeded */
    }
  } catch {
    /* ignore */
  }
  emitSyncOk();
  return true;
}

export async function pullCloudDatabase(
  localHint?: AppDatabase | null
): Promise<AppDatabase | null> {
  if (!supabaseSyncEnabled()) return null;
  try {
    const remote = await pullViaApi();
    if (!remote) return null;
    if (remote.updatedAt) lastCloudUpdatedAt = remote.updatedAt;
    if (remote.scope === "public" && localHint) {
      return mergePublicCatalog(localHint, remote.db);
    }
    if (localHint && remote.scope !== "public") {
      return mergeLocalPendingIntoRemote(localHint, remote.db);
    }
    return remote.db;
  } catch (err) {
    console.warn("[supabase] api pull failed", err);
    return null;
  }
}

/** True while a debounced or in-flight push still needs to land. */
export function isCloudPushPending(): boolean {
  return pushTimer != null || queuedPushDb != null;
}

function canPushNow(): boolean {
  return lastScope === "staff" || lastScope === "owner" || lastScope === "dealer";
}

export function schedulePushCloudDatabase(db: AppDatabase): void {
  if (!supabaseSyncEnabled()) return;
  // Public catalog pulls have no write cookie. Pushing them 401s as
  // "Unauthorized" on Hostinger builds that lack NEXT_PUBLIC_DB_API_KEY.
  if (!canPushNow()) return;
  queuedPushDb = db;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    // Push latest local snapshot at flush time (not a stale closure)
    void (async () => {
      const latest = await readLatestLocalDb(queuedPushDb ?? db);
      queuedPushDb = null;
      await pushCloudDatabase(latest);
    })();
  }, 600);
}

/** Cancel debounce and push immediately (call after place-order). */
export async function flushPushCloudDatabase(
  db: AppDatabase
): Promise<boolean> {
  if (!supabaseSyncEnabled()) return false;
  if (!canPushNow()) return false;
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  queuedPushDb = null;
  const latest = await readLatestLocalDb(db);
  return pushCloudDatabase(latest);
}

export async function pushCloudDatabase(db: AppDatabase): Promise<boolean> {
  if (!supabaseSyncEnabled()) return false;
  // Serialize pushes so tabs/actions don't stampede optimistic locks
  const run = async (): Promise<boolean> => {
    const latest = await readLatestLocalDb(db);
    const cleaned = sanitizeDbForCloud(latest);
    const json = JSON.stringify(cleaned);
    if (json === lastPushJson) return true;
    const lastPushJsonBefore = lastPushJson;
    try {
      const ok = await pushViaApi(cleaned);
      if (!ok) return false;
      if (lastPushJson === lastPushJsonBefore) {
        lastPushJson = json;
      }
      return true;
    } catch (err) {
      console.warn("[supabase] push failed", err);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("tt-sync-error", {
            detail: err instanceof Error ? err.message : "Sync push failed",
          })
        );
      }
      return false;
    }
  };
  const next = pushChain.then(run, run);
  pushChain = next.then(
    () => true,
    () => false
  );
  return next;
}

export async function ensureCloudSeed(localDb: AppDatabase): Promise<AppDatabase> {
  if (!supabaseSyncEnabled()) return localDb;
  let recovering = false;
  try {
    recovering = sessionStorage.getItem("tt_db_corrupt_recovery") === "1";
  } catch {
    /* ignore */
  }
  const remote = await pullViaApi();
  if (remote) {
    if (remote.updatedAt) lastCloudUpdatedAt = remote.updatedAt;
    if (recovering) {
      try {
        sessionStorage.removeItem("tt_db_corrupt_recovery");
      } catch {
        /* ignore */
      }
      // Trust cloud entirely after a corrupt local wipe — never push empty seed.
      return remote.scope === "public"
        ? mergePublicCatalog(localDb, remote.db)
        : remote.db;
    }
    if (remote.scope === "public") {
      return mergePublicCatalog(localDb, remote.db);
    }
    const merged = mergeLocalPendingIntoRemote(localDb, remote.db);
    if (
      !remoteOpsPurgeIsNewer(localDb, remote.db) &&
      localPendingDiffers(localDb, merged, remote.db)
    ) {
      void pushCloudDatabase(merged);
    }
    return merged;
  }
  if (recovering) {
    // Offline during recovery — keep empty in-memory until a pull succeeds.
    return localDb;
  }
  // Only seed empty cloud when logged in (cookie present) — anonymous must not bootstrap
  await pushCloudDatabase(localDb);
  return localDb;
}

async function probeUpdatedAt(): Promise<string | null | undefined> {
  const res = await fetch("/api/db?probe=1", {
    cache: "no-store",
    credentials: "include",
    headers: dbHeaders(),
  });
  if (!res.ok) return undefined;
  const data = (await res.json()) as {
    updatedAt?: string | null;
    live?: { url?: string; key?: string };
  };
  rememberLiveConfig(data.live);
  return data.updatedAt ?? null;
}

/**
 * Shared DB via /api/db. Staff desks also listen for a Realtime ping
 * (no jsonb SELECT) so a dealer proof shows without waiting for the poll.
 * Poll remains the fallback when the tab is hidden or the socket drops.
 */
export function subscribeCloudDatabase(
  onChange: (db: AppDatabase) => void,
  getLocal?: () => AppDatabase | null
): (() => void) | null {
  if (!supabaseSyncEnabled()) return null;

  let cancelled = false;
  let timer: number | null = null;
  let unchangedStreak = 0;
  let busy = false;
  let pulseQueued = false;
  let liveOn = false;
  let stopLive: (() => void) | null = null;
  let liveAttachStarted = false;
  const FAST_MS = 4000;
  const SLOW_MS = 20_000;
  const LIVE_FALLBACK_MS = 45_000;

  const onConflict = (db: AppDatabase) => {
    if (!cancelled) onChange(db);
  };
  conflictListeners.add(onConflict);

  const intervalMs = () => {
    if (liveOn) return LIVE_FALLBACK_MS;
    return unchangedStreak >= 3 ? SLOW_MS : FAST_MS;
  };

  const scheduleNext = () => {
    if (cancelled) return;
    if (timer != null) window.clearTimeout(timer);
    if (document.visibilityState === "hidden") return;
    timer = window.setTimeout(() => {
      void tick();
    }, intervalMs());
  };

  let tick: () => Promise<void> = async () => undefined;

  const requestTick = () => {
    if (cancelled) return;
    unchangedStreak = 0;
    if (busy) {
      pulseQueued = true;
      return;
    }
    void tick();
  };

  const staffWantsLive = async (): Promise<boolean> => {
    if (lastScope === "staff" || lastScope === "owner") return true;
    try {
      const { getSession } = await import("@/lib/store/db");
      const session = getSession();
      return !!session && session.role !== "customer";
    } catch {
      return false;
    }
  };

  const attachLive = () => {
    if (cancelled || liveAttachStarted) return;
    liveAttachStarted = true;
    void (async () => {
      if (!(await staffWantsLive())) {
        liveAttachStarted = false;
        return;
      }
      const { startAppDbLive } = await import("./live-client");
      if (cancelled) {
        liveAttachStarted = false;
        return;
      }
      const stop = await startAppDbLive({
        onPulse: (incomingAt) => {
          if (isCloudPushPending()) return;
          if (!shouldPullFromLivePulse(lastCloudUpdatedAt, incomingAt)) return;
          requestTick();
        },
        onState: (state) => {
          liveOn = state === "on";
          if (state === "on") {
            unchangedStreak = 0;
            if (timer != null) {
              window.clearTimeout(timer);
              timer = null;
            }
            scheduleNext();
          }
        },
      });
      if (!stop) {
        liveAttachStarted = false;
        return;
      }
      stopLive = stop;
      if (cancelled) {
        stopLive();
        stopLive = null;
      }
    })();
  };

  tick = async () => {
    if (cancelled || busy) return;
    if (document.visibilityState === "hidden") return;
    busy = true;
    try {
      // Don't pull over a just-saved local write before the push debounce lands
      // (that was wiping GRN stock / vouchers back to the stale cloud snapshot).
      if (isCloudPushPending()) return;

      if (lastCloudUpdatedAt) {
        const probed = await probeUpdatedAt();
        if (cancelled) return;
        if (probed !== undefined && probed === lastCloudUpdatedAt) {
          unchangedStreak += 1;
          return;
        }
      }

      const remote = await pullViaApi();
      if (cancelled || !remote) return;
      if (remote.updatedAt) lastCloudUpdatedAt = remote.updatedAt;
      const local = getLocal?.() ?? null;
      if (remote.scope === "public") {
        await warnIfStaffGotPublicCatalog();
      }
      let applyDb =
        remote.scope === "public" && local
          ? mergePublicCatalog(local, remote.db)
          : remote.db;
      let needsPush = false;
      if (local && remote.scope !== "public") {
        const merged = mergeLocalPendingIntoRemote(local, applyDb);
        needsPush =
          !remoteOpsPurgeIsNewer(local, applyDb) &&
          localPendingDiffers(local, merged, applyDb);
        applyDb = merged;
      }
      // Only stringify when we actually pulled — probe path skips this.
      const json = JSON.stringify(sanitizeDbForCloud(applyDb));
      if (json === lastPushJson) {
        unchangedStreak += 1;
        return;
      }
      unchangedStreak = 0;
      // Don't mark synced if we still have local-only rows to push
      if (!needsPush) lastPushJson = json;
      onChange(applyDb);
      if (needsPush) void pushCloudDatabase(applyDb);
    } catch {
      /* ignore transient errors */
    } finally {
      busy = false;
      attachLive();
      if (pulseQueued) {
        pulseQueued = false;
        void tick();
      } else {
        scheduleNext();
      }
    }
  };

  const onVisibility = () => {
    if (cancelled) return;
    if (document.visibilityState === "visible") {
      unchangedStreak = 0;
      void tick();
      attachLive();
    } else if (timer != null) {
      window.clearTimeout(timer);
      timer = null;
    }
  };

  const onLocalWrite = () => {
    unchangedStreak = 0;
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("tt-db-updated", onLocalWrite);
  window.addEventListener("tt-session-updated", attachLive);

  attachLive();
  void tick();
  return () => {
    cancelled = true;
    conflictListeners.delete(onConflict);
    if (timer != null) window.clearTimeout(timer);
    stopLive?.();
    stopLive = null;
    setLiveSyncState("off");
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("tt-db-updated", onLocalWrite);
    window.removeEventListener("tt-session-updated", attachLive);
  };
}
