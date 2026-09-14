"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { useSession } from "@/lib/hooks";
import { syncSessionFromServer } from "@/lib/store/db";

/** Old /login route → home auth screen (never a blank page). */
export default function LoginRedirectPage() {
  const t = useTranslations();
  const router = useRouter();
  const { session, ready } = useSession();

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    void (async () => {
      const live = await syncSessionFromServer();
      if (cancelled) return;
      const role = live?.role || session?.role;
      router.replace(live || session ? (role === "customer" ? "/" : "/admin") : "/");
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, session, router]);

  return (
    <section className="tt-section">
      <div className="tt-wrap py-16 text-center text-sm text-[var(--ink-muted)]">
        {t("shop.openingLogin")}
      </div>
    </section>
  );
}
