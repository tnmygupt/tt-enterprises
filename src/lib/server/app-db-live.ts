/** Live ping is unused after leaving Supabase Realtime. Clients poll /api/db. */
export async function notifyAppDbLive(_updatedAt: string): Promise<void> {
  /* no-op */
}
