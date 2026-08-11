"use client";

import { Suspense, useCallback, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { AccessPlacesMapLazy } from "@/components/AccessPlacesMapLazy";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { canViewFinancials, checkCapability } from "@/lib/store/db";
import {
  buildTrackingMatrix,
  type TrackingColumnKey,
} from "@/lib/tracking-matrix";
import type { AccessSource, UserRole } from "@/lib/types";

export default function AdminTrackingPage() {
  return (
    <Suspense
      fallback={
        <AdminShell>
          <p className="text-sm text-[var(--ink-muted)]">…</p>
        </AdminShell>
      }
    >
      <AdminTrackingInner />
    </Suspense>
  );
}

function AdminTrackingInner() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session, ready } = useSession();
  const { db } = useDb();
  const search = useSearchParams();
  const [range, setRange] = useAdminDateRange("7d");
  const [q, setQ] = useState("");
  const [hideDelivered, setHideDelivered] = useState(true);
  const [stuckOnly, setStuckOnly] = useState(false);
  const initialCol = search.get("col") as TrackingColumnKey | null;
  const [focusCol, setFocusCol] = useState<TrackingColumnKey | null>(
    initialCol && isColKey(initialCol) ? initialCol : null
  );
  const [accessSource, setAccessSource] = useState<AccessSource | "all">("all");
  const [accessQ, setAccessQ] = useState("");
  const [accessRole, setAccessRole] = useState<UserRole | "all">("all");
  const [focusPin, setFocusPin] = useState<string | null>(null);
  const [mobileCol, setMobileCol] = useState<TrackingColumnKey>("estimate");
  const pipelineRef = useRef<HTMLElement | null>(null);

  /** KPI / chip taps jump the board to one stage instead of just filtering. */
  const focusColumn = useCallback((key: TrackingColumnKey | null) => {
    setFocusCol(key);
    if (key) setMobileCol(key);
    pipelineRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const canTrack =
    !!session &&
    (checkCapability(session, db?.users, "manage_orders") ||
      checkCapability(session, db?.users, "manage_users"));
  const showMoney =
    !!session &&
    (canViewFinancials(session.role) ||
      checkCapability(session, db?.users, "view_financials"));

  const matrix = useMemo(
    () =>
      buildTrackingMatrix(db, range, {
        hideDelivered,
        stuckOnly,
        q,
        col: focusCol,
        accessSource,
        accessQ,
      }),
    [db, range, hideDelivered, stuckOnly, q, focusCol, accessSource, accessQ]
  );

  const placesFiltered = useMemo(() => {
    if (accessRole === "all") return matrix.places;
    const events = matrix.accessEvents.filter((e) => e.role === accessRole);
    const keys = new Set(
      events
        .filter((e) => e.lat != null && e.lng != null)
        .map(
          (e) =>
            `${e.city || e.region || e.country || "Unknown"}|${(e.lat || 0).toFixed(2)}|${(e.lng || 0).toFixed(2)}`
        )
    );
    return matrix.places.filter((p) => keys.has(p.key));
  }, [matrix.places, matrix.accessEvents, accessRole]);

  const backlogChips = useMemo(() => {
    const stages: { key: TrackingColumnKey; count: number }[] = [
      { key: "estimate", count: matrix.metrics.backlog.needConfirm },
      { key: "need_bill", count: matrix.metrics.backlog.needBill },
      { key: "need_verify", count: matrix.metrics.backlog.needVerify },
      { key: "need_lr", count: matrix.metrics.backlog.needLr },
    ];
    return stages.flatMap((stage) => {
      const col = matrix.columns.find((c) => c.key === stage.key);
      if (!col) return [];
      return [
        {
          ...stage,
          label: locale === "hi" ? col.labelHi : col.labelEn,
        },
      ];
    });
  }, [matrix.columns, matrix.metrics.backlog, locale]);

  if (!ready) {
    return (
      <AdminShell>
        <p className="text-sm text-[var(--ink-muted)]">{t("common.loading")}</p>
      </AdminShell>
    );
  }

  if (!canTrack) {
    return (
      <AdminShell>
        <AdminAccessDenied title={t("tracking.accessDenied")} />
      </AdminShell>
    );
  }

  const maxDaily = Math.max(
    1,
    ...matrix.traffic.daily.map((d) => d.visits + d.logins)
  );

  return (
    <AdminShell>
      <div className="space-y-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="tt-display text-3xl text-[var(--brand-deep)] sm:text-4xl">
              {t("tracking.title")}
            </h1>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {t("tracking.hint")}
            </p>
          </div>
          <DateRangeBar value={range} onChange={setRange} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
          <Kpi
            label={t("tracking.kpiBacklog")}
            value={String(
              matrix.metrics.backlog.needConfirm +
                matrix.metrics.backlog.needBill +
                matrix.metrics.backlog.needVerify +
                matrix.metrics.backlog.needLr
            )}
            onClick={() => focusColumn(null)}
          />
          <Kpi
            label={t("tracking.kpiOrders")}
            value={String(matrix.metrics.ordersCreated)}
          />
          {showMoney ? (
            <Kpi
              label={t("tracking.kpiBilled")}
              value={formatInr(matrix.metrics.billedAmount)}
            />
          ) : null}
          <Kpi
            label={t("tracking.kpiVisits")}
            value={String(matrix.traffic.visits)}
          />
          <Kpi
            label={t("tracking.kpiLogins")}
            value={String(matrix.traffic.logins)}
          />
          <Kpi
            label={t("tracking.kpiCities")}
            value={String(matrix.traffic.uniqueCities)}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          {backlogChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() =>
                focusColumn(focusCol === chip.key ? null : chip.key)
              }
              className={`min-h-11 rounded-lg border px-3 py-2 text-xs font-semibold ${
                focusCol === chip.key
                  ? "border-[var(--brand)] bg-[var(--brand-deep)] text-white"
                  : "border-[var(--line)] bg-white text-[var(--ink-muted)] hover:border-[var(--brand)]"
              }`}
            >
              {chip.label} · {chip.count}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            className="tt-input max-w-xs"
            placeholder={t("tracking.searchOrders")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hideDelivered}
              onChange={(e) => setHideDelivered(e.target.checked)}
            />
            {t("tracking.hideDelivered")}
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={stuckOnly}
              onChange={(e) => setStuckOnly(e.target.checked)}
            />
            {t("tracking.stuckOnly")}
          </label>
          {focusCol ? (
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={() => setFocusCol(null)}
            >
              {t("tracking.clearColFocus")}
            </button>
          ) : null}
        </div>

        <div className="flex gap-2 overflow-x-auto lg:hidden">
          {matrix.columns.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`shrink-0 rounded-lg border px-3 py-2 text-xs font-semibold ${
                mobileCol === c.key
                  ? "border-[var(--brand)] bg-[var(--brand-deep)] text-white"
                  : "border-[var(--line)] bg-white"
              }`}
              onClick={() => setMobileCol(c.key)}
            >
              {locale === "hi" ? c.labelHi : c.labelEn} ({c.count})
            </button>
          ))}
        </div>

        <section ref={pipelineRef} className="scroll-mt-20">
          <h2 className="tt-display text-2xl text-[var(--brand-deep)]">
            {t("tracking.pipeline")}
          </h2>
          <div className="mt-4 hidden gap-3 overflow-x-auto pb-2 lg:flex">
            {matrix.columns.map((col) => (
              <div
                key={col.key}
                className={`tt-panel flex w-64 shrink-0 flex-col p-3 ${
                  focusCol && focusCol !== col.key ? "opacity-40" : ""
                }`}
              >
                <button
                  type="button"
                  className="text-left"
                  onClick={() =>
                    setFocusCol((k) => {
                      const next = k === col.key ? null : col.key;
                      if (next) setMobileCol(next);
                      return next;
                    })
                  }
                >
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                    {locale === "hi" ? col.labelHi : col.labelEn}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-[var(--ink)]">
                    {col.count}
                    {showMoney && col.amount > 0 ? (
                      <span className="ml-2 text-xs font-medium text-[var(--ink-muted)]">
                        {formatInr(col.amount)}
                      </span>
                    ) : null}
                  </p>
                </button>
                <ul className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto">
                  {col.cards.length === 0 ? (
                    <li className="text-xs text-[var(--ink-muted)]">
                      {t("tracking.emptyCol")}
                    </li>
                  ) : (
                    col.cards.map((card) => (
                      <li key={card.orderId}>
                        <Link
                          href={card.href}
                          className="block rounded-lg border border-[var(--line)] bg-white p-2 text-left hover:border-[var(--brand)]"
                        >
                          <p className="text-sm font-semibold text-[var(--ink)]">
                            {card.orderNumber}
                          </p>
                          <p className="text-xs text-[var(--ink-muted)]">
                            {card.dealerName}
                          </p>
                          <p className="mt-1 flex flex-wrap gap-2 text-[10px] font-medium uppercase tracking-wide">
                            <span
                              className={
                                card.daysInStage > 5
                                  ? "text-red-600"
                                  : card.daysInStage > 2
                                    ? "text-amber-700"
                                    : "text-[var(--ink-muted)]"
                              }
                            >
                              {Math.floor(card.daysInStage)}d
                            </span>
                            {showMoney ? (
                              <span>{formatInr(card.amount)}</span>
                            ) : null}
                          </p>
                          <p className="mt-1 text-[11px] text-[var(--brand-deep)]">
                            {card.nextAction}
                          </p>
                        </Link>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            ))}
          </div>

          <div className="tt-panel mt-3 p-3 lg:hidden">
            {(() => {
              const col =
                matrix.columns.find((c) => c.key === mobileCol) ||
                matrix.columns[0];
              if (!col) return null;
              return (
                <ul className="space-y-2">
                  {col.cards.map((card) => (
                    <li key={card.orderId}>
                      <Link
                        href={card.href}
                        className="block rounded-lg border border-[var(--line)] p-3"
                      >
                        <p className="font-semibold">{card.orderNumber}</p>
                        <p className="text-sm text-[var(--ink-muted)]">
                          {card.dealerName}
                        </p>
                        <p className="mt-1 text-xs">{card.nextAction}</p>
                      </Link>
                    </li>
                  ))}
                  {!col.cards.length ? (
                    <li className="text-sm text-[var(--ink-muted)]">
                      {t("tracking.emptyCol")}
                    </li>
                  ) : null}
                </ul>
              );
            })()}
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="tt-panel p-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              {t("tracking.aging")}
            </h2>
            <ul className="mt-3 space-y-2">
              {matrix.aging.map((a) => (
                <li
                  key={a.key}
                  className="flex items-center justify-between text-sm"
                >
                  <span>{locale === "hi" ? a.labelHi : a.labelEn}</span>
                  <span className="font-semibold">{a.count}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="tt-panel p-4">
            <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              {t("tracking.topDealers")}
            </h2>
            <ul className="mt-3 space-y-2">
              {matrix.dealers.slice(0, 8).map((d) => (
                <li
                  key={d.userId}
                  className="flex items-center justify-between gap-2 text-sm"
                >
                  <span className="min-w-0 truncate">
                    {d.name}{" "}
                    <span className="text-[var(--ink-muted)]">{d.phone}</span>
                  </span>
                  <span className="shrink-0 font-semibold">
                    {d.orders}
                    {showMoney ? ` · ${formatInr(d.billed)}` : ""}
                  </span>
                </li>
              ))}
              {!matrix.dealers.length ? (
                <li className="text-sm text-[var(--ink-muted)]">
                  {t("tracking.emptyDealers")}
                </li>
              ) : null}
            </ul>
          </section>
        </div>

        <section className="tt-panel p-4">
          <h2 className="tt-display text-2xl text-[var(--brand-deep)]">
            {t("tracking.trafficTitle")}
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {t("tracking.trafficHint")}
          </p>
          <div className="mt-4 flex items-end gap-1 overflow-x-auto pb-2">
            {matrix.traffic.daily.map((d) => {
              const total = d.visits + d.logins;
              const h = Math.max(4, Math.round((total / maxDaily) * 120));
              return (
                <div
                  key={d.date}
                  className="flex w-8 shrink-0 flex-col items-center gap-1"
                  title={`${d.date}: ${d.visits} visits, ${d.logins} logins`}
                >
                  <div
                    className="w-full rounded-t bg-[var(--brand)]"
                    style={{ height: h }}
                  />
                  <span className="text-[9px] text-[var(--ink-muted)]">
                    {d.date.slice(8)}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase text-[var(--ink-muted)]">
                {t("tracking.topPages")}
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                {matrix.traffic.topPaths.map((p) => (
                  <li key={p.path} className="flex justify-between gap-2">
                    <span className="truncate font-mono text-xs">{p.path}</span>
                    <span className="font-semibold">{p.count}</span>
                  </li>
                ))}
                {!matrix.traffic.topPaths.length ? (
                  <li className="text-[var(--ink-muted)]">
                    {t("tracking.emptyTraffic")}
                  </li>
                ) : null}
              </ul>
            </div>
            <div>
              <p className="text-xs font-bold uppercase text-[var(--ink-muted)]">
                {t("tracking.devices")}
              </p>
              <ul className="mt-2 space-y-1 text-sm">
                <li className="flex justify-between">
                  <span>{t("tracking.mobile")}</span>
                  <span className="font-semibold">
                    {matrix.traffic.devices.mobile}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span>{t("tracking.desktop")}</span>
                  <span className="font-semibold">
                    {matrix.traffic.devices.desktop}
                  </span>
                </li>
                <li className="flex justify-between">
                  <span>{t("tracking.unknownDevice")}</span>
                  <span className="font-semibold">
                    {matrix.traffic.devices.unknown}
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div>
            <h2 className="tt-display text-2xl text-[var(--brand-deep)]">
              {t("tracking.placesTitle")}
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {t("tracking.placesHint")}
            </p>
          </div>
          <form
            className="tt-panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4"
            onSubmit={(e) => e.preventDefault()}
          >
            <label className="block text-sm">
              <span className="tt-label">{t("tracking.filterSource")}</span>
              <select
                className="tt-input mt-1"
                value={accessSource}
                onChange={(e) =>
                  setAccessSource(e.target.value as AccessSource | "all")
                }
              >
                <option value="all">{t("tracking.sourceAll")}</option>
                <option value="login">{t("tracking.sourceLogin")}</option>
                <option value="page">{t("tracking.sourcePage")}</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="tt-label">{t("tracking.filterRole")}</span>
              <select
                className="tt-input mt-1"
                value={accessRole}
                onChange={(e) =>
                  setAccessRole(e.target.value as UserRole | "all")
                }
              >
                <option value="all">{t("tracking.roleAll")}</option>
                <option value="customer">{t("tracking.roleDealer")}</option>
                <option value="super_admin">{t("tracking.roleStaff")}</option>
                <option value="sales">{t("tracking.roleSales")}</option>
                <option value="accounts">{t("tracking.roleAccounts")}</option>
                <option value="dispatch">{t("tracking.roleDispatch")}</option>
              </select>
            </label>
            <label className="block text-sm sm:col-span-2">
              <span className="tt-label">{t("tracking.filterSearch")}</span>
              <input
                className="tt-input mt-1"
                value={accessQ}
                onChange={(e) => setAccessQ(e.target.value)}
                placeholder={t("tracking.filterSearchPh")}
              />
            </label>
          </form>

          <AccessPlacesMapLazy pins={placesFiltered} focusKey={focusPin} />

          <div className="tt-panel overflow-x-auto p-0">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="border-b border-[var(--line)] bg-[var(--surface-2)] text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                <tr>
                  <th className="px-3 py-2">{t("tracking.colPlace")}</th>
                  <th className="px-3 py-2">{t("tracking.colCount")}</th>
                  <th className="px-3 py-2">{t("tracking.colLast")}</th>
                  <th className="px-3 py-2">{t("tracking.colWho")}</th>
                </tr>
              </thead>
              <tbody>
                {placesFiltered.map((p) => (
                  <tr
                    key={p.key}
                    className="cursor-pointer border-b border-[var(--line)] hover:bg-[var(--surface-2)]"
                    onClick={() => setFocusPin(p.key)}
                  >
                    <td className="px-3 py-2">
                      {p.city}
                      {p.region ? `, ${p.region}` : ""}
                      {p.country ? ` · ${p.country}` : ""}
                    </td>
                    <td className="px-3 py-2 font-semibold">{p.count}</td>
                    <td className="px-3 py-2 text-xs text-[var(--ink-muted)]">
                      {p.lastAt.slice(0, 16).replace("T", " ")}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {p.sampleName || "—"} · {p.sources.join(", ")}
                    </td>
                  </tr>
                ))}
                {!placesFiltered.length ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center text-[var(--ink-muted)]"
                    >
                      {t("tracking.emptyPlaces")}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </AdminShell>
  );
}

function Kpi({
  label,
  value,
  onClick,
}: {
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold text-[var(--ink)]">{value}</p>
    </>
  );
  if (!onClick) return <div className="tt-panel p-3">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className="tt-panel p-3 text-left transition hover:border-[var(--brand)]"
    >
      {body}
    </button>
  );
}

function isColKey(v: string): v is TrackingColumnKey {
  return (
    v === "estimate" ||
    v === "confirmed" ||
    v === "need_bill" ||
    v === "payment_pending" ||
    v === "need_verify" ||
    v === "payment_verified" ||
    v === "need_lr" ||
    v === "dispatched" ||
    v === "delivered"
  );
}
