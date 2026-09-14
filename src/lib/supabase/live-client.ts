"use client";

import { setLiveSyncState, type LiveSyncState } from "./live";

/** Supabase Realtime removed — staff screens poll /api/db instead. */
export function startAppDbLive(_opts?: {
  onPulse?: (updatedAt: string | null) => void;
  onState?: (state: LiveSyncState) => void;
}): () => void {
  setLiveSyncState("off");
  _opts?.onState?.("off");
  return () => undefined;
}
