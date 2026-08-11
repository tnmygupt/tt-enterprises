"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";

type BannerState =
  | { kind: "none" }
  | { kind: "offline" }
  | { kind: "sync"; detail: string };

/**
 * Tells the user when the app is running on local data only — either the
 * device is offline or a cloud push failed — instead of silently drifting.
 */
export function ConnectionBanner() {
  const t = useTranslations();
  const [state, setState] = useState<BannerState>({ kind: "none" });
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    const goOffline = () => setState({ kind: "offline" });
    const goOnline = () =>
      setState((s) => (s.kind === "offline" ? { kind: "none" } : s));
    const onSyncError = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setState({ kind: "sync", detail: typeof detail === "string" ? detail : "" });
    };
    const onSyncOk = () =>
      setState((s) => (s.kind === "sync" ? { kind: "none" } : s));

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      goOffline();
    }
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    window.addEventListener("tt-sync-error", onSyncError);
    window.addEventListener("tt-sync-ok", onSyncOk);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("tt-sync-error", onSyncError);
      window.removeEventListener("tt-sync-ok", onSyncOk);
    };
  }, []);

  const retry = useCallback(async () => {
    setRetrying(true);
    try {
      const [{ loadDb }, sync] = await Promise.all([
        import("@/lib/store/db"),
        import("@/lib/supabase/sync"),
      ]);
      const ok = await sync.flushPushCloudDatabase(loadDb());
      if (ok) setState({ kind: "none" });
    } catch {
      /* banner stays up */
    } finally {
      setRetrying(false);
    }
  }, []);

  if (state.kind === "none") return null;

  const offline = state.kind === "offline";
  const message = offline
    ? t("connection.offline")
    : state.detail || t("connection.syncFailed");

  return (
    <div
      role="status"
      className="fixed bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 right-3 z-[55] mx-auto max-w-md rounded-xl border border-[var(--line)] bg-white px-4 py-3 shadow-lg print:hidden"
    >
      <p className="text-sm font-semibold text-[var(--ink)]">
        <span
          aria-hidden
          className={`mr-2 inline-block h-2 w-2 rounded-full ${
            offline ? "bg-[var(--ink-muted)]" : "bg-[var(--danger)]"
          }`}
        />
        {message}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {!offline ? (
          <button
            type="button"
            className="tt-btn tt-btn-outline min-h-10 px-3 py-1 text-xs"
            disabled={retrying}
            onClick={() => void retry()}
          >
            {retrying ? `${t("connection.retry")}…` : t("connection.retry")}
          </button>
        ) : null}
        <button
          type="button"
          className="min-h-10 px-2 text-xs font-semibold text-[var(--ink-muted)]"
          onClick={() => setState({ kind: "none" })}
        >
          {t("connection.dismiss")}
        </button>
      </div>
    </div>
  );
}
