/**
 * Hostinger injects SUPABASE_URL + SUPABASE_API_KEY.
 * Prefer SUPABASE_SERVICE_ROLE_KEY on the server so RLS can deny the anon key.
 * Browser sync goes through /api/db only (never direct table writes).
 */
export function getSupabaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    ""
  ).trim();
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

/** True when URL + key are present (server or public). */
export function isSupabaseConfigured(): boolean {
  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  return Boolean(
    url &&
      key &&
      !url.includes("YOUR_") &&
      !key.includes("YOUR_") &&
      url.startsWith("http")
  );
}

/** Browser-safe: Next only inlines NEXT_PUBLIC_* into the client bundle. */
export function isSupabaseBrowserConfigured(): boolean {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  return Boolean(
    url &&
      key &&
      !url.includes("YOUR_") &&
      !key.includes("YOUR_") &&
      url.startsWith("http")
  );
}

export const APP_DB_TABLE = "app_database";
export const APP_DB_ROW_ID = "main";
