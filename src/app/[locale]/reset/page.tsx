"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";

/**
 * One-tap recovery for phones stuck on a blank PWA / cached shell.
 * Clears service workers + Cache Storage, then opens a fresh /en.
 */
export default function ResetAppPage() {
  const locale = useLocale();
  const [status, setStatus] = useState("Repairing app…");

  useEffect(() => {
    let cancelled = false;
    (async () => {
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
      if (cancelled) return;
      setStatus("Done — opening store…");
      window.setTimeout(() => {
        window.location.replace(`/${locale}?repaired=1`);
      }, 400);
    })();
    return () => {
      cancelled = true;
    };
  }, [locale]);

  return (
    <section className="tt-section">
      <div className="tt-wrap mx-auto max-w-md py-16 text-center">
        <h1 className="tt-display text-3xl text-[var(--brand-deep)]">
          Repairing TT App
        </h1>
        <p className="mt-3 text-sm text-[var(--ink-muted)]">{status}</p>
        <p className="mt-6 text-xs text-[var(--ink-muted)]">
          If nothing happens, open{" "}
          <a className="text-[var(--brand)] underline" href={`/${locale}`}>
            app.ttenterprises.shop/{locale}
          </a>{" "}
          in Chrome/Safari (not the old home-screen icon).
        </p>
      </div>
    </section>
  );
}
