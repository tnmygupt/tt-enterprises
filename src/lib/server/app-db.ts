import type { AppDatabase } from "@/lib/store/db";
import {
  isCloudDbConfigured,
  isMysqlConfigured,
  mysqlGetAppDb,
  mysqlGetUpdatedAt,
  mysqlPutAppDb,
} from "@/lib/server/host-sql";

export { isCloudDbConfigured, isMysqlConfigured };

/** @deprecated Use isCloudDbConfigured. */
export function isSupabaseConfigured(): boolean {
  return isCloudDbConfigured();
}

export function createServerSupabase(): null {
  return null;
}

export async function cloudGetAppDbUpdatedAt(): Promise<{
  updatedAt?: string | null;
  error?: string;
}> {
  return mysqlGetUpdatedAt();
}

export async function cloudGetAppDb(): Promise<{
  db: AppDatabase | null;
  updatedAt?: string;
  error?: string;
}> {
  return mysqlGetAppDb();
}

export async function cloudPutAppDb(
  db: AppDatabase,
  baseUpdatedAt?: string | null
): Promise<{
  ok: boolean;
  conflict?: boolean;
  updatedAt?: string;
  error?: string;
}> {
  return mysqlPutAppDb(db, baseUpdatedAt ?? null);
}
