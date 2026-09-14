"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { isSessionAuthMessage } from "@/lib/sync-errors";

type BannerState =
  | { kind: "none" }
  | { kind: "offline" }
  | { kind: "sync"; detail: string }
  | { kind: "session"; detail: string };

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
      const text = typeof detail === "string" ? detail : "";
      if (isSessionAuthMessage(text)) {
        setState({ kind: "session", detail: text });
        return;
      }
      setState({ kind: "sync", detail: text });
    };
    const onSessionExpired = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      setState({
        kind: "session",
        detail: typeof detail === "string" ? detail : "",
      });
    };
    const onSyncOk = () =>
      setState((s) => (s.kind === "sync" || s.kind === "session" ? { kind: "none" } : s));

    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      goOffline();
    }
    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);
    window.addEventListener("tt-sync-error", onSyncError);
    window.addEventListener("tt-session-expired", onSessionExpired);
    window.addEventListener("tt-sync-ok", onSyncOk);
    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
      window.removeEventListener("tt-sync-error", onSyncError);
      window.removeEventListener("tt-session-expired", onSessionExpired);
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
  const sessionExpired = state.kind === "session";
  const message = offline
    ? t("connection.offline")
    : sessionExpired
      ? t("connection.sessionExpired")
      : /unauthorized/i.test(state.detail)
        ? t("connection.syncFailed")
        : state.detail || t("connection.syncFailed");

  return (
    <div
      role="status"
      className="tt-bottom-toast mx-auto max-w-md rounded-xl border border-[var(--line)] bg-white px-4 py-3 shadow-lg print:hidden"
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
        {sessionExpired ? (
          <Link
            href="/"
            className="tt-btn tt-btn-dark min-h-10 px-3 py-1 text-xs"
            onClick={() => {
              void import("@/lib/store/db").then((m) => m.logout());
              setState({ kind: "none" });
            }}
          >
            {t("connection.logInAgain")}
          </Link>
        ) : !offline ? (
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
