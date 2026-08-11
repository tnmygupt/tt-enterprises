import { NextRequest } from "next/server";
import type { AppDatabase } from "@/lib/store/db";
import type { TallyPost } from "@/lib/types";
import {
  cloudGetAppDb,
  cloudPutAppDb,
  createServerSupabase,
} from "@/lib/server/app-db";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";

export function authorizeTallySync(req: NextRequest): boolean {
  const expected = process.env.TALLY_SYNC_KEY;
  if (!expected) {
    if (process.env.NODE_ENV === "production") return false;
    return req.headers.get("x-tally-sync-key") === "tt-enterprises-tally-dev-key";
  }
  return req.headers.get("x-tally-sync-key") === expected;
}

export async function loadCloudDb(): Promise<{
  db: AppDatabase | null;
  updatedAt?: string;
  error?: string;
  status?: number;
}> {
  if (!isSupabaseConfigured()) {
    return { db: null, error: "Supabase not configured", status: 503 };
  }
  const supabase = createServerSupabase();
  if (!supabase) {
    return { db: null, error: "Supabase not configured", status: 503 };
  }
  const { db, updatedAt, error } = await cloudGetAppDb(supabase);
  if (error) return { db: null, error, status: 500 };
  if (!db) return { db: null, error: "No cloud database", status: 404 };
  if (!db.tallyPosts) db.tallyPosts = [];
  return { db, updatedAt };
}

export async function saveCloudDb(
  db: AppDatabase,
  baseUpdatedAt?: string | null
): Promise<{ ok: boolean; conflict?: boolean; error?: string; updatedAt?: string }> {
  const supabase = createServerSupabase();
  if (!supabase) return { ok: false, error: "Supabase not configured" };
  return cloudPutAppDb(supabase, sanitizeDbForCloud(db), baseUpdatedAt);
}

export function filterPosts(
  posts: TallyPost[],
  status?: string | null
): TallyPost[] {
  const list = [...posts].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );
  if (!status || status === "all") return list;
  return list.filter((p) => p.status === status);
}
