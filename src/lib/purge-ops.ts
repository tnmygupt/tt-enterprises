import type { AppDatabase } from "@/lib/store/db";
import { normalizePhone, phonesMatch } from "@/lib/phone";
import {
  mergeTombMaps,
  syncTombFields,
  tombsFromDb,
} from "@/lib/user-tombs";

export type PurgeOpsResult = {
  ok: boolean;
  error?: string;
  keptUserPhone?: string;
  keptUserId?: string;
  removedUsers: number;
  removedOrders: number;
  keptProducts: number;
};

/**
 * Launch wipe: keep only keepPhone as owner.
 * Clears orders, other users, wallets, books history, catalog products/schemes,
 * POs/GRNs/contracts, and customer parties.
 * Keeps: company settings, chart of accounts, categories, shipping rules.
 */
export function purgeOpsDataKeepCatalog(
  db: AppDatabase,
  keepPhone: string,
  opts?: { clearCatalog?: boolean }
): { db: AppDatabase; result: PurgeOpsResult } {
  const clearCatalog = opts?.clearCatalog !== false;
  const want = normalizePhone(keepPhone);
  if (want.length !== 10) {
    return {
      db,
      result: {
        ok: false,
        error: "keepPhone must be a 10-digit mobile number",
        removedUsers: 0,
        removedOrders: 0,
        keptProducts: 0,
      },
    };
  }

  const kept = (db.users ?? []).filter((u) => phonesMatch(u.phone, want));
  if (!kept.length) {
    return {
      db,
      result: {
        ok: false,
        error: `No user found with phone ${want}`,
        removedUsers: 0,
        removedOrders: 0,
        keptProducts: (db.products ?? []).length,
      },
    };
  }

  const preferred =
    kept.find((u) => u.role === "super_admin") ||
    kept.find((u) => u.role !== "customer") ||
    kept[0];
  const keepUser = {
    ...preferred,
    role: "super_admin" as const,
    active: true,
    approved: true,
    walletBalance: 0,
  };

  const beforeUsers = (db.users ?? []).length;
  const beforeOrders = (db.orders ?? []).length;
  const products = clearCatalog
    ? []
    : structuredClone(db.products ?? []);

  const purgeAt = new Date().toISOString();
  const removedIds = (db.users ?? [])
    .filter((u) => u.id !== keepUser.id)
    .map((u) => u.id);
  const tombs = mergeTombMaps(
    tombsFromDb(db),
    Object.fromEntries(removedIds.map((id) => [id, purgeAt]))
  );
  // Never tombstone the kept owner
  delete tombs[keepUser.id];
  const tombFields = syncTombFields(tombs);

  const next: AppDatabase = {
    ...db,
    users: [keepUser],
    deletedUserIds: tombFields.deletedUserIds,
    deletedUserAt: tombFields.deletedUserAt,
    products,
    orders: [],
    walletTransactions: [],
    walletDeposits: [],
    vouchers: [],
    ledgerEntries: [],
    billAllocations: [],
    stockMovements: [],
    stockBatches: [],
    batchConsumptions: [],
    purchaseOrders: [],
    goodsReceipts: [],
    supplierContracts: [],
    tallyPosts: [],
    statementMatches: [],
    schemes: clearCatalog ? [] : db.schemes ?? [],
    parties: [],
    categories: db.categories ?? [],
    shippingRules: db.shippingRules ?? [],
    settings: db.settings
      ? { ...db.settings, opsPurgeAt: purgeAt }
      : db.settings,
    accounts: db.accounts ?? [],
  };

  return {
    db: next,
    result: {
      ok: true,
      keptUserPhone: normalizePhone(keepUser.phone),
      keptUserId: keepUser.id,
      removedUsers: Math.max(0, beforeUsers - 1),
      removedOrders: beforeOrders,
      keptProducts: products.length,
    },
  };
}

/**
 * Clear order history only — keeps all users, products, and current stock qty.
 * Bumps opsPurgeAt so stale browsers cannot re-push deleted orders.
 */
export function clearOrderHistoryKeepUsers(db: AppDatabase): {
  db: AppDatabase;
  result: PurgeOpsResult;
} {
  const beforeOrders = (db.orders ?? []).length;
  const purgeAt = new Date().toISOString();
  const next: AppDatabase = {
    ...db,
    orders: [],
    // Drop order-linked money/stock history; keep product qty as-is
    walletTransactions: (db.walletTransactions ?? []).filter((t) => !t.orderId),
    stockMovements: (db.stockMovements ?? []).filter((m) => !m.orderId),
    tallyPosts: [],
    billAllocations: [],
    settings: db.settings
      ? { ...db.settings, opsPurgeAt: purgeAt }
      : db.settings,
  };
  return {
    db: next,
    result: {
      ok: true,
      removedUsers: 0,
      removedOrders: beforeOrders,
      keptProducts: (db.products ?? []).length,
      keptUserPhone: undefined,
      keptUserId: undefined,
    },
  };
}
