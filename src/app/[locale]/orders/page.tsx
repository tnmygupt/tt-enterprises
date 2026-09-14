"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";

export default function OrdersPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, cloudReady } = useDb();

  if (!session) {
    return (
      <section className="tt-section">
        <div className="tt-wrap tt-panel max-w-lg p-6">
          <p className="text-[var(--ink-muted)]">{t("common.loginRequired")}</p>
          <Link href="/" className="tt-btn tt-btn-dark mt-4 inline-flex w-full sm:w-auto">
            {t("nav.login")}
          </Link>
        </div>
      </section>
    );
  }

  const orders = [...(db?.orders ?? [])]
    .filter((o) => (session.role === "customer" ? o.userId === session.id : true))
    .sort((a, b) =>
      String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
    );

  return (
    <section className="tt-section">
      <div className="tt-wrap">
        <h1 className="tt-display text-3xl text-[var(--brand-deep)] sm:text-4xl">
          {t("nav.orders")}
        </h1>

        <div className="mt-5 space-y-3">
          {orders.map((o) => (
            <article key={o.id} className="tt-mobile-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-[var(--ink)]">
                    {o.orderNumber}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {new Date(o.createdAt).toLocaleString(
                      locale === "hi" ? "hi-IN" : "en-IN"
                    )}
                  </p>
                </div>
                <span className="tt-status shrink-0">
                  {t(`orderStatus.${o.status}` as "orderStatus.estimate")}
                </span>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3">
                <p className="text-lg font-bold tabular-nums text-[var(--brand-deep)]">
                  {formatInr(o.actualBillAmount ?? o.estimatedTotal, locale)}
                </p>
                <Link
                  href={`/orders/${o.id}`}
                  className="tt-btn tt-btn-dark min-h-11 px-4"
                >
                  {t("common.track")}
                </Link>
              </div>
            </article>
          ))}
          {!cloudReady ? (
            <p className="tt-panel p-6 text-center text-[var(--ink-muted)]">
              {t("common.loading")}
            </p>
          ) : !orders.length ? (
            <div className="tt-panel p-6 text-center">
              <p className="text-[var(--ink-muted)]">
                {t("shop.noOrdersYet")}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                <Link href="/quick-order" className="tt-btn tt-btn-dark">
                  {t("nav.quickOrder")}
                </Link>
                <Link href="/catalog" className="tt-btn tt-btn-outline">
                  {t("nav.catalog")}
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
