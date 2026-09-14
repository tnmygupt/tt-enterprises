"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSession } from "@/lib/hooks";
import {
  ensurePushSubscription,
  registerServiceWorker,
} from "@/lib/push-client";
import { loadDb, isStaff } from "@/lib/store/db";

const DISMISS_KEY = "tt_pwa_install_dismissed";

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export function PwaRegister() {
  const t = useTranslations("pwa");
  const locale = useLocale();
  const { session, ready } = useSession();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null
  );
  const [showInstall, setShowInstall] = useState(false);
  const [pushMsg, setPushMsg] = useState("");
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    // Defer SW so the first paint is never blocked (esp. iOS home screen)
    const tmr = window.setTimeout(() => {
      void registerServiceWorker().catch(() => undefined);
    }, 1500);
    return () => window.clearTimeout(tmr);
  }, []);

  useEffect(() => {
    const onBip = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      try {
        if (sessionStorage.getItem(DISMISS_KEY) === "1") return;
      } catch {
        /* ignore */
      }
      setShowInstall(true);
    };
    window.addEventListener("beforeinstallprompt", onBip);

    // iOS has no beforeinstallprompt — show a one-time tip in Safari only
    try {
      const standalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // @ts-expect-error iOS Safari
        window.navigator.standalone === true;
      if (
        isIos() &&
        !standalone &&
        sessionStorage.getItem(DISMISS_KEY) !== "1"
      ) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShowIosHint(true);
      }
    } catch {
      /* ignore */
    }

    return () => window.removeEventListener("beforeinstallprompt", onBip);
  }, []);

  useEffect(() => {
    if (!ready || !session) return;
    const timer = window.setTimeout(() => {
      try {
        const db = loadDb();
        const user = db.users.find((u) => u.id === session.id);
        if (!user) return;
        void ensurePushSubscription(user)
          .then((ok) => {
            if (ok) {
              setPushMsg(t("notificationsOn"));
              window.setTimeout(() => setPushMsg(""), 4000);
            }
          })
          .catch(() => undefined);
      } catch {
        /* never block UI */
      }
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [ready, session, t]);

  if (!showInstall && !pushMsg && !showIosHint) return null;

  return (
    <div className="tt-bottom-toast pointer-events-none flex justify-center print:hidden">
      <div className="pointer-events-auto flex max-w-lg flex-col gap-2">
        {pushMsg ? (
          <p className="rounded-lg bg-[var(--brand)] px-3 py-2 text-center text-sm font-medium text-white shadow-lg">
            {pushMsg}
          </p>
        ) : null}
        {showIosHint && !showInstall ? (
          <div className="rounded-xl border border-[var(--line)] bg-white p-3 shadow-lg">
            <p className="text-sm font-semibold text-[var(--ink)]">
              {t("iosInstallTitle")}
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {t("iosInstallHint")}
            </p>
            <button
              type="button"
              className="tt-btn tt-btn-outline mt-3"
              onClick={() => {
                try {
                  sessionStorage.setItem(DISMISS_KEY, "1");
                } catch {
                  /* ignore */
                }
                setShowIosHint(false);
              }}
            >
              {locale === "hi" ? "ठीक है" : "OK"}
            </button>
          </div>
        ) : null}
        {showInstall && deferred ? (
          <div className="rounded-xl border border-[var(--line)] bg-white p-3 shadow-lg">
            <p className="text-sm font-semibold text-[var(--ink)]">
              {t("installTitle")}
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {session && isStaff(session.role)
                ? t("installHintStaff")
                : t("installHintDealer")}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="tt-btn tt-btn-dark"
                onClick={async () => {
                  await deferred.prompt();
                  setDeferred(null);
                  setShowInstall(false);
                }}
              >
                {t("install")}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                onClick={() => {
                  try {
                    sessionStorage.setItem(DISMISS_KEY, "1");
                  } catch {
                    /* ignore */
                  }
                  setShowInstall(false);
                }}
              >
                {locale === "hi" ? "बाद में" : "Later"}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
}
