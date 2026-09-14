import type { AppDatabase } from "@/lib/store/db";
import type { UserProfile } from "@/lib/types";
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
  keptUsers: number;
  removedUsers: number;
  removedOrders: number;
  keptProducts: number;
};

export type PurgeOpsOpts = {
  /** Default false — keep catalog/stock. Set true only for a full catalog reset. */
  clearCatalog?: boolean;
  /** Default true — keep every super_admin, plus keepPhone. */
  keepAllOwners?: boolean;
};

function resetKeptOwner(user: UserProfile): UserProfile {
  return {
    ...user,
    role: "super_admin",
    active: true,
    approved: true,
    walletBalance: 0,
    liftingProgressKg: 0,
    schemeProgress: {},
  };
}

/**
 * Launch wipe: keep owner login(s), catalog items, and product stock fields.
 * Clears orders, other users, wallets, books history, parties, POs/GRNs.
 * Keeps: company settings, chart of accounts, categories, shipping rules.
 */
export function purgeOpsDataKeepCatalog(
  db: AppDatabase,
  keepPhone: string,
  opts?: PurgeOpsOpts
): { db: AppDatabase; result: PurgeOpsResult } {
  const clearCatalog = opts?.clearCatalog === true;
  const keepAllOwners = opts?.keepAllOwners !== false;
  const want = normalizePhone(keepPhone);
  if (want.length !== 10) {
    return {
      db,
      result: {
        ok: false,
        error: "keepPhone must be a 10-digit mobile number",
        keptUsers: 0,
        removedUsers: 0,
        removedOrders: 0,
        keptProducts: 0,
      },
    };
  }

  const confirmed = (db.users ?? []).filter((u) => phonesMatch(u.phone, want));
  if (!confirmed.length) {
    return {
      db,
      result: {
        ok: false,
        error: `No user found with phone ${want}`,
        keptUsers: 0,
        removedUsers: 0,
        removedOrders: 0,
        keptProducts: (db.products ?? []).length,
      },
    };
  }

  const keepIds = new Set<string>();
  const keepUsers: UserProfile[] = [];

  const addKeep = (u: UserProfile) => {
    if (keepIds.has(u.id)) return;
    keepIds.add(u.id);
    keepUsers.push(resetKeptOwner(u));
  };

  const preferred =
    confirmed.find((u) => u.role === "super_admin") ||
    confirmed.find((u) => u.role !== "customer") ||
    confirmed[0];
  addKeep(preferred);

  if (keepAllOwners) {
    for (const u of db.users ?? []) {
      if (u.role === "super_admin") addKeep(u);
    }
  }

  const beforeUsers = (db.users ?? []).length;
  const beforeOrders = (db.orders ?? []).length;
  const products = clearCatalog
    ? []
    : structuredClone(db.products ?? []);

  const purgeAt = new Date().toISOString();
  const removedIds = (db.users ?? [])
    .filter((u) => !keepIds.has(u.id))
    .map((u) => u.id);
  const tombs = mergeTombMaps(
    tombsFromDb(db),
    Object.fromEntries(removedIds.map((id) => [id, purgeAt]))
  );
  for (const id of keepIds) delete tombs[id];
  const tombFields = syncTombFields(tombs);
  const primary = keepUsers[0];

  const next: AppDatabase = {
    ...db,
    users: keepUsers,
    deletedUserIds: tombFields.deletedUserIds,
    deletedUserAt: tombFields.deletedUserAt,
    products,
    orders: [],
    walletTransactions: [],
    walletDeposits: [],
    vouchers: [],
    ledgerEntries: [],
    billAllocations: [],
    // Product.stock / stockMatrix stay on catalog rows. Drop movement
    // history so wiped test orders cannot keep stock reserved.
    stockMovements: [],
    stockBatches: [],
    batchConsumptions: [],
    purchaseOrders: [],
    goodsReceipts: [],
    supplierContracts: [],
    tallyPosts: [],
    statementMatches: [],
    bankRecons: [],
    accessPlaces: [],
    peopleActivity: [],
    hrTerms: [],
    hrShifts: [],
    hrSites: [],
    hrPunches: [],
    hrLeaves: [],
    hrAdvances: [],
    hrPayslips: [],
    stockCounts: [],
    cashCounts: [],
    monthlyAudits: [],
    waInbox: { messages: [], reads: [] },
    schemes: clearCatalog ? [] : db.schemes ?? [],
    parties: [],
    categories: db.categories ?? [],
    shippingRules: db.shippingRules ?? [],
    settings: db.settings
      ? {
          ...db.settings,
          opsPurgeAt: purgeAt,
          whatsappDigest: {},
          tallyLastSyncAt: undefined,
          tallySyncStatus: "idle",
          tallySyncMessage: undefined,
        }
      : db.settings,
    accounts: db.accounts ?? [],
  };

  return {
    db: next,
    result: {
      ok: true,
      keptUserPhone: normalizePhone(primary.phone),
      keptUserId: primary.id,
      keptUsers: keepUsers.length,
      removedUsers: Math.max(0, beforeUsers - keepUsers.length),
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
      keptUsers: (db.users ?? []).length,
      removedUsers: 0,
      removedOrders: beforeOrders,
      keptProducts: (db.products ?? []).length,
      keptUserPhone: undefined,
      keptUserId: undefined,
    },
  };
}
