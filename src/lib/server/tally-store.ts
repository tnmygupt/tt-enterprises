import type { AppDatabase } from "@/lib/store/db";
import { cloudGetAppDb, cloudPutAppDb, isCloudDbConfigured } from "@/lib/server/app-db";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";

export type TallyStoreResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; status: number };

function cloneDb(db: AppDatabase): AppDatabase {
  return JSON.parse(JSON.stringify(db)) as AppDatabase;
}

/**
 * Load the cloud database, mutate it, and save.
 * One retry on an optimistic-concurrency conflict.
 */
export async function withTallyDb<T>(
  mutate: (db: AppDatabase) => T
): Promise<TallyStoreResult<T>> {
  if (!isCloudDbConfigured()) {
    return { ok: false, error: "Cloud unavailable", status: 503 };
  }

  const attempt = async (): Promise<
    TallyStoreResult<T> | { conflict: true }
  > => {
    const got = await cloudGetAppDb();
    if (got.error || !got.db) {
      return { ok: false, error: got.error || "Cloud empty", status: 500 };
    }
    const db = cloneDb(got.db);
    if (!db.tallyPosts) db.tallyPosts = [];
    if (!db.products) db.products = [];
    if (!db.orders) db.orders = [];
    let value: T;
    try {
      value = mutate(db);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Failed",
        status: 400,
      };
    }
    const put = await cloudPutAppDb(
      sanitizeDbForCloud(db),
      got.updatedAt ?? null
    );
    if (put.conflict) return { conflict: true };
    if (!put.ok) {
      return { ok: false, error: put.error || "Save failed", status: 500 };
    }
    return { ok: true, value };
  };

  const first = await attempt();
  if ("conflict" in first) {
    const second = await attempt();
    if ("conflict" in second) {
      return { ok: false, error: "Conflict", status: 409 };
    }
    return second;
  }
  return first;
}
