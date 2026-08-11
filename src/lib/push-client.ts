"use client";

import { upsertUser, loadDb } from "@/lib/store/db";
import type { UserProfile } from "@/lib/types";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    // Drop stale workers/caches that can leave home-screen apps on a blank shell
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs.map(async (reg) => {
        try {
          const url = reg.active?.scriptURL || reg.installing?.scriptURL || "";
          if (url && !url.includes("/sw.js")) {
            await reg.unregister();
          }
        } catch {
          /* ignore */
        }
      })
    );
    if ("caches" in window) {
      try {
        const keys = await caches.keys();
        await Promise.all(
          keys
            .filter((k) => k.startsWith("tt-") || k.includes("workbox"))
            .map((k) => caches.delete(k))
        );
      } catch {
        /* ignore */
      }
    }
    const reg = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
      updateViaCache: "none",
    });
    void reg.update().catch(() => undefined);
    return reg;
  } catch (err) {
    console.warn("[pwa] SW register failed", err);
    return null;
  }
}

/** Full wipe used by /reset recovery page and emergency banners. */
export async function resetPwaClient(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* ignore */
  }
  try {
    if ("caches" in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* ignore */
  }
}

export async function ensurePushSubscription(
  user: UserProfile
): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!("Notification" in window) || !("PushManager" in window)) return false;
  // iOS only supports Web Push in installed home-screen PWAs (16.4+)
  const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if (isIos) {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // @ts-expect-error iOS
      navigator.standalone === true;
    if (!standalone) return false;
  }

  const reg = await registerServiceWorker();
  if (!reg) return false;

  let permission = Notification.permission;
  if (permission === "default") {
    permission = await Notification.requestPermission();
  }
  if (permission !== "granted") return false;

  const vapidRes = await fetch("/api/push/vapid-public", {
    credentials: "include",
  });
  const vapid = (await vapidRes.json()) as {
    configured?: boolean;
    publicKey?: string | null;
  };
  if (!vapid.configured || !vapid.publicKey) return false;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(
        vapid.publicKey
      ) as BufferSource,
    });
  }

  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;

  const pushSub = {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
    },
  };

  const db = loadDb();
  const live = db.users.find((u) => u.id === user.id) || user;
  const others = (live.pushSubscriptions ?? []).filter(
    (s) => s.endpoint !== pushSub.endpoint
  );
  upsertUser({
    ...live,
    pushSubscriptions: [pushSub, ...others].slice(0, 5),
  });

  try {
    await fetch("/api/push/subscribe", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subscription: pushSub }),
    });
  } catch {
    /* local upsert still helps once synced */
  }
  return true;
}

export async function notifyStaffPush(input: {
  title: string;
  body: string;
  url?: string;
}): Promise<void> {
  try {
    await fetch("/api/push/notify-staff", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    /* best-effort */
  }
}

export async function notifyUserPush(input: {
  userId: string;
  title: string;
  body: string;
  url?: string;
}): Promise<void> {
  try {
    await fetch("/api/push/notify-user", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  } catch {
    /* best-effort */
  }
}
