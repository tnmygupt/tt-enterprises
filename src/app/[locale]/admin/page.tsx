"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AccountsHotkeys } from "@/components/AccountsHotkeys";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { TableWrap } from "@/components/admin/TableWrap";
import { AdminShell } from "@/components/AdminShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import {
  computeCommandDesk,
  salesDeltaPct,
  type MonthlyPair,
  type ReorderMix,
} from "@/lib/admin-command-desk";
import {
  getAdminQueues,
  orderNextActionHref,
  orderNextActionLabelKey,
} from "@/lib/admin-queues";
import { inRange } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { checkCapability, isSalesDeskStaff } from "@/lib/store/db";
import type { Capability, Order } from "@/lib/types";

const MIX_COLORS = {
  critical: "#c43131",
  soon: "#c47a12",
  watch: "#0b7ea4",
  healthy: "#0f8a5f",
};

function compactInr(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1e7) return `${sign}${(a / 1e7).toFixed(1)} Cr`;
  if (a >= 1e5) return `${sign}${(a / 1e5).toFixed(1)} L`;
  if (a >= 1000) return `${sign}${(a / 1000).toFixed(0)}k`;
  return String(Math.round(n));
}

function MixDonut({ mix }: { mix: ReorderMix }) {
  const t = useTranslations("admin");
  const total = mix.critical + mix.soon + mix.watch + mix.healthy || 1;
  const slices = [
    { key: "critical" as const, label: t("deskMixCritical"), value: mix.critical, color: MIX_COLORS.critical },
    { key: "soon" as const, label: t("deskMixSoon"), value: mix.soon, color: MIX_COLORS.soon },
    { key: "watch" as const, label: t("deskMixWatch"), value: mix.watch, color: MIX_COLORS.watch },
    { key: "healthy" as const, label: t("deskMixHealthy"), value: mix.healthy, color: MIX_COLORS.healthy },
  ];
  let acc = 0;
  const stops = slices.map((s) => {
    const from = acc;
    acc += (s.value / total) * 100;
    return `${s.color} ${from}% ${acc}%`;
  });
  const need = mix.critical + mix.soon;
  return (
    <div>
      <div className="relative mx-auto h-44 w-44">
        <div
          className="h-full w-full rounded-full"
          style={{ background: `conic-gradient(${stops.join(", ")})` }}
        />
        <div className="absolute inset-6 flex flex-col items-center justify-center rounded-full bg-white">
          <p className="text-2xl font-semibold tabular-nums text-[var(--ink)]">{need}</p>
          <p className="text-[11px] text-[var(--ink-muted)]">{t("deskNeedReorder")}</p>
        </div>
      </div>
      <ul className="mt-3 space-y-1.5 text-sm">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-[var(--ink-muted)]">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
            <span className="tabular-nums text-[var(--ink)]">
              {s.value} · {Math.round((s.value / total) * 100)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MonthBars({
  rows,
  showPurchase,
}: {
  rows: MonthlyPair[];
  showPurchase: boolean;
}) {
  const t = useTranslations("admin");
  const max = Math.max(...rows.flatMap((r) => [r.sales, showPurchase ? r.purchase : 0]), 1);
  if (!rows.some((r) => r.sales || r.purchase)) {
    return <p className="py-16 text-center text-sm text-[var(--ink-muted)]">{t("deskNoChart")}</p>;
  }
  return (
    <div className="flex h-56 items-end gap-1 sm:gap-1.5">
      {rows.map((r) => (
        <div key={r.month} className="flex min-w-0 flex-1 flex-col items-center gap-1">
          <div className="flex h-48 w-full items-end justify-center gap-px">
            <div
              className="w-1/2 min-w-[4px] rounded-t bg-[var(--brand)]"
              style={{ height: `${Math.max(2, (r.sales / max) * 100)}%` }}
              title={`${r.month} sales ${compactInr(r.sales)}`}
            />
            {showPurchase ? (
              <div
                className="w-1/2 min-w-[4px] rounded-t bg-[var(--ok)]"
                style={{ height: `${Math.max(2, (r.purchase / max) * 100)}%` }}
                title={`${r.month} purchase ${compactInr(r.purchase)}`}
              />
            ) : null}
          </div>
          <span className="text-[10px] text-[var(--ink-muted)]">{r.month.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminDashboardPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { db } = useDb();
  const { session } = useSession();
  const [range, setRange] = useAdminDateRange("today");
  const can = (cap: Capability) =>
    !!session && checkCapability(session, db, cap);
  const queues = getAdminQueues(db);
  const books = can("manage_accounts");
  const owner = can("view_financials");
  const stockCap = can("manage_accounts") || can("manage_reorder");
  const salesDesk = isSalesDeskStaff(session, db);

  const desk = useMemo(
    () => (db ? computeCommandDesk(db) : null),
    [db]
  );

  const periodOrders = useMemo(() => {
    return [...(db?.orders ?? [])]
      .filter((o) => inRange(o.createdAt, range.from, range.to))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [db, range.from, range.to]);

  const yoy = desk ? salesDeltaPct(desk.salesMtd, desk.salesMtdLastYear) : null;

  const workQueues: {
    key: string;
    title: string;
    desc: string;
    items: Order[];
    href: string;
  }[] = [
    {
      key: "need_confirm",
      title: t("admin.queueEstimates"),
      desc: t("admin.queueEstimatesDesc"),
      items: queues.needConfirm,
      href: "/admin/orders?filter=estimate",
    },
    {
      key: "need_bill",
      title: t("admin.queueNeedBill"),
      desc: t("admin.queueNeedBillDesc"),
      items: queues.needBill,
      href: "/admin/orders?filter=need_bill",
    },
    {
      key: "need_verify",
      title: t("admin.queueVerifyPay"),
      desc: t("admin.queueVerifyPayDesc"),
      items: queues.needVerifyPayment,
      href: "/admin/orders?filter=need_verify",
    },
    {
      key: "need_lr",
      title: t("admin.queueNeedLr"),
      desc: t("admin.queueNeedLrDesc"),
      items: queues.needLr,
      href: "/admin/orders?filter=need_lr",
    },
  ];

  const hrGateway = [
    {
      href: "/admin/hr",
      label:
        session?.role === "super_admin" ? t("admin.hrDesk") : t("admin.hrMyDesk"),
      term: "HR",
    },
    { href: "/admin/hr/punch", label: t("admin.hrPunch"), term: "GPS" },
  ];

  const gateway = (
    salesDesk
      ? [
          { href: "/admin/orders/new", label: t("admin.deskSale"), term: "F8" },
          ...hrGateway,
        ]
      : [
          can("manage_orders")
            ? { href: "/admin/orders/new", label: t("admin.deskSale"), term: "F8" }
            : null,
          books
            ? { href: "/admin/accounts/vouchers?new=receipt", label: t("admin.deskReceipt"), term: "F6" }
            : null,
          books && owner
            ? { href: "/admin/accounts/vouchers?new=payment", label: t("admin.deskPayment"), term: "F5" }
            : null,
          books
            ? { href: "/admin/accounts/goods-received", label: t("admin.deskGoodsIn"), term: "F9" }
            : null,
          books
            ? { href: "/admin/accounts/brs", label: t("admin.deskBrs"), term: "Alt+B" }
            : null,
          books
            ? { href: "/admin/accounts/payments", label: t("admin.deskUpi"), term: "UPI" }
            : null,
          ...hrGateway,
        ]
  ).filter(Boolean) as { href: string; label: string; term: string }[];

  return (
    <AdminShell wide>
      {books ? <AccountsHotkeys /> : null}
      <AdminPageHeader
        title={t("admin.dashboard")}
        hint={salesDesk ? t("admin.salesDeskHint") : t("admin.deskHint")}
        actions={
          <>
            {stockCap ? (
              <Link href="/admin/accounts/inventory" className="tt-btn tt-btn-dark">
                {t("admin.stock")}
              </Link>
            ) : null}
            {can("manage_orders") ? (
              <Link href="/admin/orders" className="tt-btn tt-btn-outline">
                {t("admin.orders")}
              </Link>
            ) : null}
            {books ? (
              <Link href="/admin/accounts" className="tt-btn tt-btn-outline">
                {t("admin.accountsBook")}
              </Link>
            ) : null}
          </>
        }
      />

      {gateway.length ? (
        <section className="mt-5">
          <h2 className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {t("admin.deskGateway")}
          </h2>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {gateway.map((g) => (
              <Link
                key={g.href + g.term}
                href={g.href}
                className="tt-panel flex flex-col px-3 py-3 transition hover:border-[var(--brand)]"
              >
                <span className="font-mono text-[11px] text-[var(--ink-muted)]">{g.term}</span>
                <span className="mt-1 text-sm font-semibold text-[var(--ink)]">{g.label}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {desk && books && desk.seasonOn ? (
        <p className="mt-4 rounded-xl border border-[var(--brand)]/30 bg-[var(--brand-soft)] px-4 py-2 text-sm text-[var(--brand-deep)]">
          {t("admin.deskSeasonOn")} ×{desk.seasonMultiplier}
        </p>
      ) : null}

      {desk && (books || stockCap) ? (
        <section className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {books ? (
            <div className="tt-panel p-4">
              <p className="text-sm text-[var(--ink-muted)]">{t("admin.deskSalesMtd")}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {formatInr(desk.salesMtd, locale)}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {t("admin.deskSalesFy")} {desk.fyLabel}: {formatInr(desk.salesFy, locale)}
              </p>
              {yoy != null ? (
                <p className={`mt-1 text-xs font-medium ${yoy >= 0 ? "text-[var(--ok)]" : "text-[var(--danger)]"}`}>
                  {yoy >= 0 ? "+" : ""}
                  {yoy.toFixed(0)}% {t("admin.deskVsLastYear")}
                </p>
              ) : null}
            </div>
          ) : null}
          {books ? (
            <Link href="/admin/accounts/receivables" className="tt-panel block p-4 transition hover:border-[var(--brand)]">
              <p className="text-sm text-[var(--ink-muted)]">{t("admin.deskReceivables")}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {formatInr(desk.receivables, locale)}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {formatInr(desk.overdueReceivables, locale)} {t("admin.deskOverdue")}
              </p>
            </Link>
          ) : null}
          {books ? (
            <Link href="/admin/accounts/cash-bank" className="tt-panel block p-4 transition hover:border-[var(--brand)]">
              <p className="text-sm text-[var(--ink-muted)]">{t("admin.deskCashBank")}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {formatInr(desk.cash + desk.bank, locale)}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {formatInr(desk.cash, locale)} / {formatInr(desk.bank, locale)}
              </p>
            </Link>
          ) : null}
          {stockCap ? (
            <Link
              href={owner ? "/admin/accounts/reports/stock-valuation" : "/admin/accounts/inventory"}
              className="tt-panel block p-4 transition hover:border-[var(--brand)]"
            >
              <p className="text-sm text-[var(--ink-muted)]">
                {owner ? t("admin.deskStockValue") : t("admin.stock")}
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {owner ? formatInr(desk.stockValue, locale) : desk.skuCount}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {desk.skuCount} {t("admin.deskSkus")} · {desk.mix.critical + desk.mix.soon}{" "}
                {t("admin.deskNeedReorder")}
              </p>
            </Link>
          ) : null}
        </section>
      ) : null}

      {desk && books ? (
        <div className="tt-panel mt-4 flex flex-wrap items-center justify-between gap-4 p-4">
          <div>
            <p className="text-sm font-semibold text-[var(--ink)]">{t("admin.deskOutlook")}</p>
            <p className="mt-1 max-w-xl text-xs text-[var(--ink-muted)]">
              {desk.outlookMethod === "last30_season"
                ? t("admin.deskOutlookSeason")
                : t("admin.deskOutlookLast30")}
            </p>
          </div>
          <p className="text-2xl font-semibold tabular-nums">{formatInr(desk.outlookNextMonth, locale)}</p>
        </div>
      ) : null}

      {desk && (books || stockCap) ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {desk.staleEstimates > 0 && can("manage_orders") ? (
            <Link href="/admin/orders?filter=estimate" className="tt-chip">
              {t("admin.deskStaleEstimates")} <strong>{desk.staleEstimates}</strong>
            </Link>
          ) : null}
          {desk.draftPos > 0 && stockCap ? (
            <Link href="/admin/accounts/purchases?tab=orders" className="tt-chip">
              {t("admin.deskDraftPos")} <strong>{desk.draftPos}</strong>
            </Link>
          ) : null}
          {desk.unpricedGrns > 0 && books ? (
            <Link
              href={owner ? "/admin/accounts/needs-pricing" : "/admin/accounts/goods-received"}
              className="tt-chip"
            >
              {t("admin.deskUnpriced")} <strong>{desk.unpricedGrns}</strong>
            </Link>
          ) : null}
        </div>
      ) : null}

      {desk && (books || stockCap) ? (
        <section className="mt-5 grid gap-3 xl:grid-cols-3">
          {books ? (
          <div className="tt-panel p-4 xl:col-span-2">
            <div className="mb-3 flex items-center justify-between gap-2">
              <h2 className="font-semibold text-[var(--ink)]">{t("admin.deskSalesPurchase")}</h2>
              <span className="text-xs text-[var(--ink-muted)]">{t("admin.deskMonthlyHint")}</span>
            </div>
            <MonthBars rows={desk.monthly} showPurchase={owner} />
            {owner ? (
              <p className="mt-2 text-[11px] text-[var(--ink-muted)]">
                <span className="mr-3 inline-block h-2 w-2 rounded-sm bg-[var(--brand)]" />
                {t("admin.deskSales")}
                <span className="ml-4 mr-3 inline-block h-2 w-2 rounded-sm bg-[var(--ok)]" />
                {t("admin.deskPurchase")}
              </p>
            ) : null}
          </div>
          ) : null}
          {stockCap ? (
            <div className="tt-panel p-4">
              <h2 className="font-semibold text-[var(--ink)]">{t("admin.deskReorderMix")}</h2>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">{t("admin.deskReorderMixHint")}</p>
              <div className="mt-3">
                <MixDonut mix={desk.mix} />
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {desk && stockCap ? (
        <section className="mt-3 grid gap-3 xl:grid-cols-2">
          {books ? (
            <div className="tt-panel p-4">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="font-semibold text-[var(--ink)]">{t("admin.deskTopCats")}</h2>
                <Link href="/admin/accounts/reports/sales-analysis" className="text-xs font-medium text-[var(--brand)]">
                  {t("admin.accountsBook")} →
                </Link>
              </div>
              <ul className="space-y-3">
                {desk.topCategories.map((c, i) => {
                  const catTotal = desk.topCategories.reduce((s, x) => s + x.sales, 0) || 1;
                  return (
                    <li key={c.key} className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--surface-2)] text-xs font-bold text-[var(--ink-muted)]">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.label}</span>
                      <span className="text-right">
                        <span className="block text-sm font-semibold tabular-nums">
                          {formatInr(c.sales, locale)}
                        </span>
                        <span className="text-[11px] text-[var(--ink-muted)]">
                          {Math.round((c.sales / catTotal) * 100)}%
                        </span>
                      </span>
                    </li>
                  );
                })}
                {!desk.topCategories.length ? (
                  <p className="text-sm text-[var(--ink-muted)]">{t("common.empty")}</p>
                ) : null}
              </ul>
            </div>
          ) : null}
          <div className="tt-panel overflow-hidden p-0">
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <h2 className="font-semibold text-[var(--ink)]">{t("admin.deskReorderQueue")}</h2>
              <Link href="/admin/accounts/reports/stock-alerts" className="text-xs font-medium text-[var(--brand)]">
                {t("admin.stockAlerts")} →
              </Link>
            </div>
            <TableWrap>
              <table className="tt-table min-w-[420px]">
                <thead>
                  <tr>
                    <th>{t("admin.colItem")}</th>
                    <th>{t("admin.colOnHand")}</th>
                    <th>{t("admin.colSuggest")}</th>
                  </tr>
                </thead>
                <tbody>
                  {desk.reorders.map((r) => (
                    <tr key={r.label}>
                      <td>
                        {r.label}
                        {r.stockout ? (
                          <span className="ml-2 text-[11px] font-bold text-[var(--danger)]">
                            {t("admin.deskMixCritical")}
                          </span>
                        ) : null}
                      </td>
                      <td className="tabular-nums">{r.stock}</td>
                      <td className="tabular-nums font-semibold">{r.suggestedQty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!desk.reorders.length ? (
                <EmptyState message={t("common.empty")} />
              ) : null}
            </TableWrap>
          </div>
        </section>
      ) : null}

      {desk && books && desk.collections.length ? (
        <section className="tt-panel mt-3 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-[var(--ink)]">{t("admin.deskCollections")}</h2>
            <Link href="/admin/accounts/receivables" className="text-xs font-medium text-[var(--brand)]">
              Alt+R
            </Link>
          </div>
          <ul className="space-y-2">
            {desk.collections.map((p) => (
              <li key={p.partyId} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate">{p.name}</span>
                <span className="tabular-nums text-[var(--danger)]">
                  {formatInr(p.overdue, locale)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {salesDesk ? null : (
        <p className="mt-5 text-xs text-[var(--ink-muted)]">{t("admin.deskBooksHint")}</p>
      )}
      <DateRangeBar value={range} onChange={setRange} className="mt-2" />

      {can("manage_orders") ? (
        <>
          <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {t("admin.deskWorkQueues")}
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">{t("admin.deskWorkHint")}</p>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {workQueues.map((q) => (
              <div key={q.key} className="tt-panel flex flex-col p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-[var(--ink)]">{q.title}</h3>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">{q.desc}</p>
                  </div>
                  <span className="rounded-lg bg-[var(--brand-soft)] px-2.5 py-1 text-sm font-bold text-[var(--brand-deep)]">
                    {q.items.length}
                  </span>
                </div>
                {q.items.slice(0, 3).map((o) => (
                  <Link
                    key={o.id}
                    href={orderNextActionHref(o)}
                    className="mt-3 flex items-center justify-between border-t border-[var(--line)] pt-2 text-sm hover:text-[var(--brand-deep)]"
                  >
                    <span className="font-mono text-xs text-[var(--brand-deep)]">{o.orderNumber}</span>
                    <span className="truncate text-[var(--ink-muted)]">{o.userName}</span>
                  </Link>
                ))}
                <Link href={q.href} className="tt-btn tt-btn-dark mt-4 min-h-11 w-full sm:w-auto">
                  {t("admin.queueOpen")}
                </Link>
              </div>
            ))}
          </div>

          {queues.fullTruck.length > 0 ? (
            <div className="tt-panel mt-5 border-[var(--brand)] p-4">
              <h3 className="font-semibold">
                {t("admin.fullTruckRequests")} (
                {queues.fullTruck.length})
              </h3>
              <ul className="mt-2 space-y-1 text-sm">
                {queues.fullTruck.map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="text-[var(--brand)]">
                      {o.orderNumber}
                    </Link>{" "}
                    — {o.userName}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {t("admin.deskPeriodOrders")}
            <span className="ml-2 font-normal normal-case">({periodOrders.length})</span>
          </h2>
          <TableWrap className="tt-panel mt-3">
            <table className="tt-table min-w-[720px]">
              <thead>
                <tr>
                  <th>{t("admin.colOrder")}</th>
                  <th>{t("admin.colCustomer")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("admin.colNext")}</th>
                  <th>{t("common.total")}</th>
                </tr>
              </thead>
              <tbody>
                {periodOrders.slice(0, 8).map((o) => (
                  <tr key={o.id}>
                    <td>
                      <Link href={`/orders/${o.id}`} className="font-mono text-sm text-[var(--brand)]">
                        {o.orderNumber}
                      </Link>
                    </td>
                    <td>{o.userName}</td>
                    <td>
                      <span className="tt-status">
                        {t(`orderStatus.${o.status}` as "orderStatus.estimate")}
                      </span>
                    </td>
                    <td>
                      <Link
                        href={orderNextActionHref(o)}
                        className="text-sm font-semibold text-[var(--brand-deep)]"
                      >
                        {t(`admin.${orderNextActionLabelKey(o)}` as "admin.nextActionOpen")}
                      </Link>
                    </td>
                    <td className="tabular-nums">
                      {formatInr(o.actualBillAmount ?? o.estimatedTotal, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!periodOrders.length ? (
              <EmptyState message={t("common.empty")} />
            ) : null}
          </TableWrap>
        </>
      ) : null}
    </AdminShell>
  );
}
