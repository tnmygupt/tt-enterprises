import type { AppDatabase } from "@/lib/store/db";

/** ISO ops-purge marker from settings (empty if never purged). */
export function getOpsPurgeAt(db: AppDatabase | null | undefined): string {
  return (db?.settings?.opsPurgeAt || "").trim();
}

function rowCreatedAt(row: {
  createdAt?: string;
  updatedAt?: string;
}): string {
  return (row.createdAt || row.updatedAt || "").trim();
}

/** Keep rows created at/after the latest order-history / ops purge. */
export function isAfterOpsPurge(
  row: { createdAt?: string; updatedAt?: string },
  purgeAt: string
): boolean {
  if (!purgeAt) return true;
  const t = rowCreatedAt(row);
  return !!t && t >= purgeAt;
}

/**
 * Drop orders (and order-linked money/stock rows) older than opsPurgeAt.
 * Stops stale browsers from resurrecting cleared history even when they
 * carry the same purge timestamp.
 */
export function stripPrePurgeOps(db: AppDatabase): AppDatabase {
  const purgeAt = getOpsPurgeAt(db);
  if (!purgeAt) return db;

  const orders = (db.orders ?? []).filter((o) => isAfterOpsPurge(o, purgeAt));
  const keepOrderIds = new Set(orders.map((o) => o.id));

  return {
    ...db,
    orders,
    walletTransactions: (db.walletTransactions ?? []).filter(
      (t) => !t.orderId || keepOrderIds.has(t.orderId)
    ),
    stockMovements: (db.stockMovements ?? []).filter(
      (m) => !m.orderId || keepOrderIds.has(m.orderId)
    ),
  };
}

export function localOpsPurgeIsNewer(
  local: AppDatabase,
  remote: AppDatabase
): boolean {
  const localAt = getOpsPurgeAt(local);
  if (!localAt) return false;
  const remoteAt = getOpsPurgeAt(remote);
  return !remoteAt || localAt > remoteAt;
}

export function remoteOpsPurgeIsNewer(
  local: AppDatabase,
  remote: AppDatabase
): boolean {
  const remoteAt = getOpsPurgeAt(remote);
  if (!remoteAt) return false;
  const localAt = getOpsPurgeAt(local);
  return !localAt || localAt < remoteAt;
}
