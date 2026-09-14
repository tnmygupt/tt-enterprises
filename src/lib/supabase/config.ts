/**
 * Shared books live on Hostinger MySQL. Browser sync goes through /api/db.
 * NEXT_PUBLIC_CLOUD_DB=1 tells the client bundle cloud is on (MYSQL_* is server-only).
 */
export function isMysqlConfigured(): boolean {
  return Boolean(
    (process.env.MYSQL_HOST || "").trim() &&
      (process.env.MYSQL_USER || "").trim() &&
      (process.env.MYSQL_PASSWORD || "").trim() &&
      (process.env.MYSQL_DATABASE || "").trim()
  );
}

export function isCloudDbConfigured(): boolean {
  if (isMysqlConfigured()) return true;
  return (process.env.NEXT_PUBLIC_CLOUD_DB || "").trim() === "1";
}

export function getSupabaseUrl(): string {
  return "";
}

/** Anon / publishable key — used only if no service role (legacy). */
export function getSupabaseAnonKey(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    ""
  ).trim();
}

/** Service role bypasses RLS — required for locked-down app_database. */
export function getSupabaseServiceKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    ""
  ).trim();
}

/**
 * Server key for /api/db and Storage uploads.
 * Prefers service role; falls back to Hostinger SUPABASE_API_KEY / anon.
 */
export function getSupabaseKey(): string {
  return (
    getSupabaseServiceKey() ||
    process.env.SUPABASE_API_KEY ||
    getSupabaseAnonKey() ||
    ""
  ).trim();
}

/** Shared secret for browser → /api/db. Set DB_API_KEY + NEXT_PUBLIC_DB_API_KEY. */
export function getDbApiKey(): string {
  return (
    process.env.DB_API_KEY ||
    process.env.NEXT_PUBLIC_DB_API_KEY ||
    ""
  ).trim();
}

export function getPublicDbApiKey(): string {
  return (process.env.NEXT_PUBLIC_DB_API_KEY || "").trim();
}

/** True when Hostinger MySQL is set (server) or NEXT_PUBLIC_CLOUD_DB=1 (browser). */
export function isSupabaseConfigured(): boolean {
  return isCloudDbConfigured();
}

/** Browser-safe: Next only inlines NEXT_PUBLIC_* into the client bundle. */
export function isSupabaseBrowserConfigured(): boolean {
  return (process.env.NEXT_PUBLIC_CLOUD_DB || "").trim() === "1";
}

export const APP_DB_TABLE = "app_database";
export const APP_DB_ROW_ID = "main";
