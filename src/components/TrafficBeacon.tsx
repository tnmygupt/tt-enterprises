"use client";

import { useEffect, useRef } from "react";
import { useLocale } from "next-intl";
import { usePathname } from "@/i18n/routing";

const SEEN_KEY = "tt_traffic_seen_v1";
/** A path counts again only after this long — every hit rewrites the cloud DB. */
const REPEAT_AFTER_MS = 30 * 60_000;

function alreadyCounted(path: string): boolean {
  try {
    const raw = sessionStorage.getItem(SEEN_KEY);
    const seen = raw ? (JSON.parse(raw) as Record<string, number>) : {};
    const now = Date.now();
    if (seen[path] && now - seen[path] < REPEAT_AFTER_MS) return true;
    seen[path] = now;
    for (const [k, at] of Object.entries(seen)) {
      if (now - at > REPEAT_AFTER_MS) delete seen[k];
    }
    sessionStorage.setItem(SEEN_KEY, JSON.stringify(seen));
    return false;
  } catch {
    return false;
  }
}

/**
 * Fires a lightweight pageview beacon (Jetpack-style traffic) once per path.
 * Never blocks UI; failures are ignored.
 */
export function TrafficBeacon() {
  const pathname = usePathname();
  const locale = useLocale();
  const last = useRef("");

  useEffect(() => {
    if (pathname === "/pack" || pathname.startsWith("/pack/")) return;
    const path = `/${locale}${pathname === "/" ? "" : pathname}`;
    if (!path || path === last.current) return;
    last.current = path;
    if (alreadyCounted(path)) return;

    const tmr = window.setTimeout(() => {
      void fetch("/api/traffic/hit", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, locale }),
        keepalive: true,
      }).catch(() => undefined);
    }, 800);

    return () => window.clearTimeout(tmr);
  }, [pathname, locale]);

  return null;
}
