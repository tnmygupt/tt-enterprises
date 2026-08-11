"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminShell } from "@/components/AdminShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { getAdminQueues, orderNextAction } from "@/lib/admin-queues";
import { inRange } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { checkCapability } from "@/lib/store/db";
import type { Capability, Order } from "@/lib/types";

export default function AdminDashboardPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { db } = useDb();
  const { session } = useSession();
  const [range, setRange] = useAdminDateRange("today");
  const can = (cap: Capability) =>
    !!session && checkCapability(session, db?.users, cap);
  const queues = getAdminQueues(db);

  const periodOrders = useMemo(() => {
    return [...(db?.orders ?? [])]
      .filter((o) => inRange(o.createdAt, range.from, range.to))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [db, range.from, range.to]);

  const stats = [
    ...(can("manage_accounts")
      ? [
          {
            label: locale === "hi" ? "स्टॉक" : "Stock",
            value: db?.products.reduce((s, p) => s + (p.stock || 0), 0) ?? 0,
            href: "/admin/accounts/inventory",
          },
        ]
      : []),
    ...(can("manage_products")
      ? [
          {
            label: locale === "hi" ? "उत्पाद" : "Products",
            value: db?.products.length ?? 0,
            href: "/admin/products",
          },
        ]
      : []),
    ...(can("manage_orders")
      ? [
          {
            label:
              locale === "hi" ? "ऑर्डर (अवधि)" : "Orders (period)",
            value: periodOrders.length,
            href: "/admin/orders",
          },
        ]
      : []),
    ...(can("manage_users")
      ? [
          {
            label: locale === "hi" ? "डीलर" : "Dealers",
            value: db?.users.filter((u) => u.role === "customer").length ?? 0,
            href: "/admin/users",
          },
        ]
      : []),
  ];

  const workQueues: {
    key: string;
    title: string;
    desc: string;
    items: Order[];
    href: string;
  }[] = [
    {
      key: "need_confirm",
      title: locale === "hi" ? "नए अनुमान" : "New estimates",
      desc:
        locale === "hi"
          ? "पुष्टि या बिल अपलोड करें"
          : "Confirm or set final kg",
      items: queues.needConfirm,
      href: "/admin/orders?filter=estimate",
    },
    {
      key: "need_bill",
      title: locale === "hi" ? "बिल बाकी" : "Bill pending",
      desc:
        locale === "hi"
          ? "असली kg डालें — बिल अपने आप"
          : "Enter final kg — bill auto-calculates",
      items: queues.needBill,
      href: "/admin/orders?filter=need_bill",
    },
    {
      key: "need_verify",
      title: locale === "hi" ? "पेमेंट जाँच" : "Verify payment",
      desc:
        locale === "hi"
          ? "डीलर ने प्रूफ भेजा है"
          : "Dealer uploaded payment proof",
      items: queues.needVerifyPayment,
      href: "/admin/orders?filter=need_verify",
    },
    {
      key: "need_lr",
      title: locale === "hi" ? "LR बाकी" : "Pending LR",
      desc:
        locale === "hi"
          ? "डिस्पैच हो चुका — LR अपलोड बाकी"
          : "Dispatched — LR upload still pending",
      items: queues.needLr,
      href: "/admin/orders?filter=need_lr",
    },
    {
      key: "full_truck",
      title: locale === "hi" ? "फुल ट्रक" : "Full truck",
      desc:
        locale === "hi"
          ? "फुल ट्रक अनुरोध — प्राथमिकता दें"
          : "Full-truck requested — prioritize",
      items: queues.fullTruck,
      href: "/admin/orders?filter=full_truck",
    },
  ];

  return (
    <AdminShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">
            {t("admin.dashboard")}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {locale === "hi"
              ? "डेस्क — ऑर्डर कतार, स्टॉक, कैटलॉग"
              : "Desk — order queues, stock, catalog"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can("manage_accounts") ? (
            <Link
              href="/admin/accounts/inventory"
              className="tt-btn tt-btn-dark"
            >
              {t("admin.stock")}
            </Link>
          ) : null}
          {can("manage_orders") ? (
            <Link href="/admin/orders" className="tt-btn tt-btn-outline">
              {t("admin.orders")}
            </Link>
          ) : null}
          {can("manage_products") ? (
            <Link href="/admin/products" className="tt-btn tt-btn-outline">
              {t("admin.products")}
            </Link>
          ) : null}
        </div>
      </div>

      <DateRangeBar value={range} onChange={setRange} className="mt-4" />

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <Link
            key={s.label}
            href={s.href}
            className="tt-panel block p-4 transition hover:border-[var(--brand)]"
          >
            <p className="text-sm text-[var(--ink-muted)]">{s.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{s.value}</p>
          </Link>
        ))}
      </div>

      {can("manage_orders") ? (
        <>
          <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {locale === "hi" ? "कार्य कतार" : "Work queues"}
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {locale === "hi"
              ? "खुले काम — तारीख फ़िल्टर नहीं"
              : "Open work — not limited by date range"}
          </p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {workQueues.map((q) => (
              <Link
                key={q.key}
                href={q.href}
                className="tt-panel block p-4 transition hover:border-[var(--brand)]"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-[var(--ink)]">{q.title}</h3>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">
                      {q.desc}
                    </p>
                  </div>
                  <span className="rounded-lg bg-[var(--brand-soft)] px-2.5 py-1 text-sm font-bold text-[var(--brand-deep)]">
                    {q.items.length}
                  </span>
                </div>
                {q.items.slice(0, 3).map((o) => (
                  <div
                    key={o.id}
                    className="mt-3 flex items-center justify-between border-t border-[var(--line)] pt-2 text-sm"
                  >
                    <span className="font-mono text-xs text-[var(--brand-deep)]">
                      {o.orderNumber}
                    </span>
                    <span className="truncate text-[var(--ink-muted)]">
                      {o.userName}
                    </span>
                  </div>
                ))}
                {q.items.length > 0 ? (
                  <p className="mt-3 text-xs font-bold text-[var(--brand)]">
                    {locale === "hi"
                      ? `सूची खोलें (${q.items.length}) →`
                      : `Open list (${q.items.length}) →`}
                  </p>
                ) : null}
              </Link>
            ))}
          </div>

          {queues.fullTruck.length > 0 ? (
            <div className="tt-panel mt-5 border-[var(--brand)] p-4">
              <h3 className="font-semibold">
                {locale === "hi" ? "फुल ट्रक अनुरोध" : "Full truck requests"} (
                {queues.fullTruck.length})
              </h3>
              <ul className="mt-2 space-y-1 text-sm">
                {queues.fullTruck.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/orders/${o.id}`}
                      className="text-[var(--brand)]"
                    >
                      {o.orderNumber}
                    </Link>{" "}
                    — {o.userName}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {locale === "hi" ? "अवधि के ऑर्डर" : "Orders in period"}
            <span className="ml-2 font-normal normal-case text-[var(--ink-muted)]">
              ({periodOrders.length})
            </span>
          </h2>
          <div className="tt-panel mt-3 overflow-x-auto">
            <table className="tt-table min-w-[720px]">
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Customer</th>
                  <th>{t("common.status")}</th>
                  <th>{locale === "hi" ? "अगला कदम" : "Next action"}</th>
                  <th>{t("common.total")}</th>
                </tr>
              </thead>
              <tbody>
                {periodOrders.slice(0, 8).map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link
                        href={`/orders/${o.id}`}
                        className="font-mono text-sm text-[var(--brand)]"
                      >
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td>{o.userName}</td>
                    <td>
                      <span className="tt-status">
                        {t(`orderStatus.${o.status}` as "orderStatus.estimate")}
                      </span>
                    </td>
                    <td className="text-sm text-[var(--ink-muted)]">
                      {orderNextAction(o)}
                    </td>
                    <td className="tabular-nums">
                      {formatInr(o.actualBillAmount ?? o.estimatedTotal, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!periodOrders.length ? (
              <p className="p-5 text-sm text-[var(--ink-muted)]">
                {t("common.empty")}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      {can("manage_tally") ? (
        <div className="tt-panel mt-5 p-4 text-sm text-[var(--ink-muted)]">
          <p>
            <strong className="text-[var(--ink)]">Tally:</strong>{" "}
            {db?.settings.tallySyncStatus ?? "idle"} —{" "}
            {db?.settings.tallySyncMessage}
          </p>
          {db?.settings.tallyLastSyncAt ? (
            <p className="mt-1">
              Last sync:{" "}
              {new Date(db.settings.tallyLastSyncAt).toLocaleString()}
            </p>
          ) : null}
          <Link
            href="/admin/tally"
            className="mt-2 inline-block text-[var(--brand)]"
          >
            {t("admin.tally")} →
          </Link>
        </div>
      ) : null}
    </AdminShell>
  );
}
