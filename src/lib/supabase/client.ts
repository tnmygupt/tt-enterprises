import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getSupabaseKey,
  getSupabaseUrl,
  isSupabaseConfigured,
} from "./config";

let browserClient: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (browserClient) return browserClient;
  browserClient = createClient(getSupabaseUrl(), getSupabaseKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  return browserClient;
}
