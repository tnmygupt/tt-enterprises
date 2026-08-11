import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { AppDatabase } from "@/lib/store/db";
import {
  APP_DB_ROW_ID,
  APP_DB_TABLE,
  getSupabaseKey,
  getSupabaseServiceKey,
  getSupabaseUrl,
  isSupabaseConfigured,
} from "@/lib/supabase/config";
import { getAppDbGateSecret } from "@/lib/server/session";

export function createServerSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  return createClient(getSupabaseUrl(), getSupabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Prefer service-role direct table access; else gate RPCs (works with anon key). */
export function canUseDirectTable(): boolean {
  return Boolean(getSupabaseServiceKey());
}

export async function cloudGetAppDb(supabase: SupabaseClient): Promise<{
  db: AppDatabase | null;
  updatedAt?: string;
  error?: string;
}> {
  if (canUseDirectTable()) {
    const { data, error } = await supabase
      .from(APP_DB_TABLE)
      .select("db, updated_at")
      .eq("id", APP_DB_ROW_ID)
      .maybeSingle();
    if (error) return { db: null, error: error.message };
    if (!data?.db) return { db: null };
    return {
      db: data.db as AppDatabase,
      updatedAt: (data as { updated_at?: string }).updated_at,
    };
  }

  try {
    const { data, error } = await supabase.rpc("tt_app_db_get", {
      p_secret: getAppDbGateSecret(),
    });
    if (error) return { db: null, error: error.message };
    if (!data) return { db: null };
    const row = data as { db?: AppDatabase; updatedAt?: string };
    if (!row.db) return { db: null };
    return { db: row.db, updatedAt: row.updatedAt };
  } catch (err) {
    return {
      db: null,
      error: err instanceof Error ? err.message : "Gate secret missing",
    };
  }
}

export async function cloudPutAppDb(
  supabase: SupabaseClient,
  db: AppDatabase,
  baseUpdatedAt?: string | null
): Promise<{
  ok: boolean;
  conflict?: boolean;
  updatedAt?: string;
  error?: string;
}> {
  if (canUseDirectTable()) {
    if (baseUpdatedAt) {
      const { data: current } = await supabase
        .from(APP_DB_TABLE)
        .select("updated_at")
        .eq("id", APP_DB_ROW_ID)
        .maybeSingle();
      const remoteAt = (current as { updated_at?: string } | null)?.updated_at;
      if (remoteAt && remoteAt !== baseUpdatedAt) {
        return { ok: false, conflict: true, updatedAt: remoteAt };
      }
    }
    const now = new Date().toISOString();
    const { error } = await supabase.from(APP_DB_TABLE).upsert(
      { id: APP_DB_ROW_ID, updated_at: now, db },
      { onConflict: "id" }
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true, updatedAt: now };
  }

  try {
    const { data, error } = await supabase.rpc("tt_app_db_put", {
      p_secret: getAppDbGateSecret(),
      p_db: db,
      p_base_updated_at: baseUpdatedAt || null,
    });
    if (error) return { ok: false, error: error.message };
    const row = (data || {}) as {
      ok?: boolean;
      conflict?: boolean;
      updatedAt?: string;
    };
    if (row.conflict) {
      return { ok: false, conflict: true, updatedAt: row.updatedAt };
    }
    return { ok: true, updatedAt: row.updatedAt };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Gate secret missing",
    };
  }
}
