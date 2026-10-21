"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  getCart,
  getSession,
  loadDb,
  replaceDbFromCloud,
  type AppDatabase,
} from "@/lib/store/db";
import {
  getLiveSyncState,
  subscribeLiveSyncState,
  type LiveSyncState,
} from "@/lib/supabase/live";
import type { CartItem, SessionUser } from "@/lib/types";
import { isPackHost } from "@/lib/pack-site";

/* --------------------------- External stores ---------------------------- */
/* Subscribe once to storage/custom-events; snapshots come from lazy getters
   so React only re-renders when the underlying value truly changes.
   This replaces the previous set-in-effect pattern and is the proper way to
   bridge browser storage into React. */

function subscribeToKey(
  events: string[]
): (onChange: () => void) => () => void {
  return (onChange: () => void) => {
    if (typeof window === "undefined") return () => undefined;
    for (const name of events) {
      window.addEventListener(name, onChange);
    }
    window.addEventListener("storage", onChange);
    return () => {
      for (const name of events) window.removeEventListener(name, onChange);
      window.removeEventListener("storage", onChange);
    };
  };
}

/* Cache one snapshot per key so React sees a stable reference until the
   underlying data actually changes; otherwise useSyncExternalStore complains
   about a new object on every read. */
let sessionSnap: SessionUser | null | undefined;
let sessionSnapKey = "";
function readSessionSnap(): SessionUser | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = safeStorageGet("tt_enterprises_session_v1");
    if (raw === sessionSnapKey && sessionSnap !== undefined) return sessionSnap;
    sessionSnapKey = raw;
    sessionSnap = getSession();
    return sessionSnap;
  } catch {
    return null;
  }
}

let cartSnap: CartItem[] = [];
let cartSnapKey = "";
function readCartSnap(): CartItem[] {
  if (typeof window === "undefined") return cartSnap;
  try {
    const raw = safeStorageGet("tt_enterprises_cart_v1");
    if (raw === cartSnapKey) return cartSnap;
    cartSnapKey = raw;
    cartSnap = getCart();
    return cartSnap;
  } catch {
    return cartSnap;
  }
}

let dbSnap: AppDatabase | null = null;
let dbSnapKey = "";
function readDbSnap(): AppDatabase | null {
  if (typeof window === "undefined") return dbSnap;
  try {
    const raw = safeStorageGet("tt_enterprises_db_v12");
    if (raw === dbSnapKey && dbSnap !== null) return dbSnap;
    dbSnapKey = raw;
    dbSnap = loadDb();
    return dbSnap;
  } catch {
    return dbSnap;
  }
}

const subscribeSession = subscribeToKey(["tt-session-updated"]);
const subscribeCart = subscribeToKey(["tt-cart-updated"]);
const subscribeDb = subscribeToKey(["tt-db-updated"]);

/* ------------------------------- Public hooks --------------------------- */

/**
 * `ready` must be `false` on the server AND during hydration, otherwise
 * SiteHeader renders different HTML and React can abandon hydration — which
 * leaves mobile stuck on "Loading…" forever (useEffect never runs).
 * useSyncExternalStore is the reliable client-detection pattern.
 */
function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false
  );
}

function safeStorageGet(key: string): string {
  try {
    if (typeof window === "undefined") return "";
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function useSession() {
  const session = useSyncExternalStore(
    subscribeSession,
    readSessionSnap,
    () => null
  );
  const ready = useIsClient();
  const refresh = useCallback(() => {
    sessionSnapKey = "";
    sessionSnap = undefined;
  }, []);
  return { session, ready, refresh };
}

export function useCart() {
  const cart = useSyncExternalStore(subscribeCart, readCartSnap, () => cartSnap);
  const ready = useIsClient();
  const refresh = useCallback(() => {
    cartSnapKey = "";
    cartSnap = [];
  }, []);
  return { cart, ready, refresh };
}

/** One cloud poll for the whole app — not one per useDb() mount. */
let cloudSyncStarted = false;
let cloudReadyGlobal = false;
const cloudReadyListeners = new Set<() => void>();

function startCloudSyncOnce(): void {
  if (cloudSyncStarted || typeof window === "undefined") return;
  if (isPackHost()) {
    cloudSyncStarted = true;
    cloudReadyGlobal = true;
    return;
  }
  cloudSyncStarted = true;

  // Drop locally-saved estimates the cloud refused (insufficient stock).
  window.addEventListener("tt-orders-rejected", ((ev: Event) => {
    const detail = (ev as CustomEvent<Array<{ id: string }>>).detail;
    if (!detail?.length) return;
    const drop = new Set(detail.map((r) => r.id));
    const db = loadDb();
    const before = db.orders.length;
    db.orders = db.orders.filter((o) => !drop.has(o.id));
    if (db.orders.length !== before) {
      // Local-only write — cloud already rejected these rows.
      replaceDbFromCloud(db);
    }
  }) as EventListener);

  void (async () => {
    try {
      const sb = await import("@/lib/supabase/sync");
      const supabaseOk = await sb.detectSupabaseSync();
      if (supabaseOk) {
        const merged = await sb.ensureCloudSeed(loadDb());
        replaceDbFromCloud(merged);
        if (!(loadDb().products?.length)) {
          const again = await sb.pullCloudDatabase(loadDb());
          if (again?.products?.length) replaceDbFromCloud(again);
        }
        sb.subscribeCloudDatabase((remote) => {
          replaceDbFromCloud(remote);
        }, () => loadDb());
        return;
      }

      const sync = await import("@/lib/firebase/sync");
      if (process.env.NODE_ENV === "production" || !sync.firebaseSyncEnabled()) {
        return;
      }
      const merged = await sync.ensureCloudSeed(loadDb());
      replaceDbFromCloud(merged);
      sync.subscribeCloudDatabase((remote) => {
        replaceDbFromCloud(remote);
      });
    } catch (err) {
      console.warn("[cloud] sync bootstrap failed", err);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("tt-sync-error", {
            detail:
              err instanceof Error
                ? err.message
                : "Could not load the catalog. Check your connection and retry.",
          })
        );
      }
    } finally {
      cloudReadyGlobal = true;
      for (const fn of cloudReadyListeners) {
        try {
          fn();
        } catch {
          /* ignore */
        }
      }
      cloudReadyListeners.clear();
    }
  })();
}

let lastSessionPullKey = "";

export function useDb() {
  const db = useSyncExternalStore(subscribeDb, readDbSnap, () => null);
  const { session, ready } = useSession();
  const [cloudReady, setCloudReady] = useState(cloudReadyGlobal);

  const refresh = useCallback(() => {
    // Invalidate cache but keep last snapshot until re-read so UI does not
    // flash a blank "loading" frame during place-order / open-order navigations.
    dbSnapKey = "";
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("tt-db-updated"));
    }
  }, []);

  useEffect(() => {
    startCloudSyncOnce();
    if (cloudReadyGlobal) {
      // Sync already finished before this component mounted — intentional
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCloudReady(true);
      return;
    }
    const onReady = () => setCloudReady(true);
    cloudReadyListeners.add(onReady);
    return () => {
      cloudReadyListeners.delete(onReady);
    };
  }, []);

  useEffect(() => {
    if (!ready || !cloudReady || !session) return;
    const key = `${session.id}:${session.role}`;
    if (isPackHost()) {
      lastSessionPullKey = key;
      return;
    }
    if (lastSessionPullKey === key) return;
    void (async () => {
      const sb = await import("@/lib/supabase/sync");
      const prevScope = sb.lastPullScope();
      if (
        prevScope === "staff" ||
        prevScope === "owner" ||
        (prevScope === "dealer" && session.role === "customer")
      ) {
        lastSessionPullKey = key;
        return;
      }
      const remote = await sb.repullForSession();
      if (remote) {
        replaceDbFromCloud(remote);
        lastSessionPullKey = key;
      }
    })();
  }, [ready, cloudReady, session]);

  return { db, refresh, cloudReady };
}

/** Realtime badge for the payments desk (and any other staff screen). */
export function useCloudLive(): LiveSyncState {
  return useSyncExternalStore(
    (onChange) => subscribeLiveSyncState(() => onChange()),
    getLiveSyncState,
    () => "off"
  );
}

/** Re-pull catalog after an empty first paint or failed bootstrap. */
export async function retryCloudCatalog(): Promise<boolean> {
  try {
    const sb = await import("@/lib/supabase/sync");
    if (!(sb.supabaseSyncEnabled() || (await sb.detectSupabaseSync()))) {
      return false;
    }
    const remote = await sb.pullCloudDatabase(loadDb());
    if (remote) {
      replaceDbFromCloud(remote);
      return (remote.products?.length ?? 0) > 0;
    }
  } catch (err) {
    console.warn("[cloud] catalog retry failed", err);
  }
  return false;
}

/* ------------------------------- Helpers -------------------------------- */

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
