/**
 * Live payments desk: staff browsers listen for a tiny "books changed"
 * ping, then pull through /api/db. Never expose the jsonb books row.
 */

export const APP_DB_LIVE_TOPIC = "tt-app-db";
export const APP_DB_LIVE_EVENT = "changed";

export type LiveSyncState = "off" | "connecting" | "on";

export type RealtimePublicConfig = {
  url: string;
  key: string;
};

export type LivePulsePayload = {
  updatedAt?: string | null;
};

let liveState: LiveSyncState = "off";
const liveListeners = new Set<(state: LiveSyncState) => void>();
let cachedProbeLive: RealtimePublicConfig | null = null;

export function getLiveSyncState(): LiveSyncState {
  return liveState;
}

export function setLiveSyncState(state: LiveSyncState): void {
  if (liveState === state) return;
  liveState = state;
  for (const fn of liveListeners) {
    try {
      fn(state);
    } catch {
      /* ignore */
    }
  }
}

export function subscribeLiveSyncState(
  fn: (state: LiveSyncState) => void
): () => void {
  liveListeners.add(fn);
  return () => {
    liveListeners.delete(fn);
  };
}

/** Decode JWT payload without verifying — used only to refuse service_role. */
export function decodeJwtPayload(token: string): { role?: string } | null {
  const part = token.split(".")[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const json =
      typeof atob === "function"
        ? atob(b64 + pad)
        : Buffer.from(b64 + pad, "base64").toString("utf8");
    return JSON.parse(json) as { role?: string };
  } catch {
    return null;
  }
}

/** Anon / publishable keys are safe to send to the browser. Service role is not. */
export function isSafeRealtimeBrowserKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed || trimmed.includes("YOUR_")) return false;
  if (trimmed.startsWith("sb_secret_")) return false;
  if (trimmed.startsWith("sb_publishable_")) return true;
  const payload = decodeJwtPayload(trimmed);
  if (!payload?.role) return false;
  if (payload.role === "service_role") return false;
  return payload.role === "anon" || payload.role === "authenticated";
}

export function realtimeBroadcastUrl(
  baseUrl: string,
  topic = APP_DB_LIVE_TOPIC,
  event = APP_DB_LIVE_EVENT
): string {
  const root = baseUrl.trim().replace(/\/$/, "");
  return `${root}/realtime/v1/api/broadcast/${encodeURIComponent(topic)}/events/${encodeURIComponent(event)}`;
}

export function livePulseUpdatedAt(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { payload?: LivePulsePayload; updatedAt?: string };
  const at = body.payload?.updatedAt ?? body.updatedAt;
  return typeof at === "string" && at ? at : null;
}

/** Pull unless this tab already applied the same cloud stamp. */
export function shouldPullFromLivePulse(
  lastCloudUpdatedAt: string | null,
  incomingUpdatedAt: string | null
): boolean {
  if (!incomingUpdatedAt) return true;
  if (!lastCloudUpdatedAt) return true;
  return incomingUpdatedAt !== lastCloudUpdatedAt;
}

export function rememberLiveConfig(
  live: { url?: string; key?: string } | null | undefined
): RealtimePublicConfig | null {
  const url = live?.url?.trim() ?? "";
  const key = live?.key?.trim() ?? "";
  if (!url.startsWith("http") || url.includes("YOUR_")) return cachedProbeLive;
  if (!isSafeRealtimeBrowserKey(key)) return cachedProbeLive;
  cachedProbeLive = { url, key };
  return cachedProbeLive;
}

export function cachedLiveConfig(): RealtimePublicConfig | null {
  return cachedProbeLive;
}

/**
 * Keys that may ship to the browser. Never returns a service-role secret,
 * even if Hostinger stored it as SUPABASE_API_KEY.
 */
export function getRealtimePublicConfig(): RealtimePublicConfig | null {
  return null;
}

export function resolveLiveConfig(): RealtimePublicConfig | null {
  return getRealtimePublicConfig() || cachedProbeLive;
}

export function resetLiveConfigForTests(): void {
  cachedProbeLive = null;
  liveState = "off";
}
