"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { companyFromSettings } from "@/lib/export-pdf";
import { useDb, useSession } from "@/lib/hooks";
import { monthInIst, monthRange, shiftMonth } from "@/lib/month-date";
import { buildOwnerCockpit } from "@/lib/owner-cockpit";
import {
  exportOwnerMonthReportExcel,
  exportOwnerMonthReportPdf,
} from "@/lib/owner-month-export";
import { buildOwnerMonthReport } from "@/lib/owner-month-report";
import { formatInr } from "@/lib/pricing";
import { checkCapability } from "@/lib/store/db";

const SECTIONS = [
  { id: "overview", en: "Overview", hi: "सार" },
  { id: "money", en: "Money", hi: "पैसा" },
  { id: "items", en: "Items", hi: "आइटम" },
  { id: "people", en: "People", hi: "लोग" },
  { id: "audit", en: "Audit", hi: "ऑडिट" },
] as const;

function money(n: number, locale: "en" | "hi"): string {
  return formatInr(n, locale);
}

function deltaLabel(n: number, locale: "en" | "hi"): string {
  const sign = n > 0 ? "+" : "";
  return `${sign}${money(n, locale)}`;
}

export default function OwnerCockpitPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const hi = locale === "hi";
  const { session } = useSession();
  const { db } = useDb();
  const [month, setMonth] = useState(() => monthInIst());
  const [range, setRange] = useAdminDateRange("mtd");

  const cockpit = useMemo(
    () =>
      db
        ? buildOwnerCockpit(db, { month, asOf: range.to, range })
        : null,
    [db, month, range]
  );
  const report = useMemo(
    () => (db ? buildOwnerMonthReport(db, month) : null),
    [db, month]
  );

  if (!session || !checkCapability(session, db, "view_financials")) {
    return (
      <AdminShell>
        <AdminAccessDenied title={t("owner.ownerOnly")} />
      </AdminShell>
    );
  }

  const desk = cockpit?.desk;
  const metrics = cockpit?.metrics;
  const audit = cockpit?.audit;
  const salesBars =
    desk?.monthly.map((m) => ({ label: m.month.slice(5), value: m.sales })) ?? [];
  const purchaseBars =
    desk?.monthly.map((m) => ({
      label: m.month.slice(5),
      value: m.purchase,
    })) ?? [];
  const dailyLine =
    metrics?.daily.map((d) => ({
      label: d.date.slice(8),
      value: d.billed,
    })) ?? [];
  const categoryBars =
    desk?.topCategories.map((c) => ({ label: c.label, value: c.sales })) ?? [];

  const applyMonth = (next: string) => {
    setMonth(next);
    const bounds = monthRange(next);
    setRange({ preset: "custom", from: bounds.from, to: bounds.to });
  };

  return (
    <AdminShell wide>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">
            {hi ? "ओनर कॉकपिट" : "Owner cockpit"}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {hi
              ? "पैसा, आइटम, लोग और मासिक ऑडिट — एक जगह"
              : "Money, items, people and the monthly audit — one place"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-[var(--ink-muted)]">
            {hi ? "माह" : "Month"}
            <input
              className="tt-input ml-2"
              type="month"
              value={month}
              onChange={(e) => applyMonth(e.target.value || month)}
            />
          </label>
          <button
            type="button"
            className="tt-btn tt-btn-outline"
            onClick={() => applyMonth(shiftMonth(month, -1))}
          >
            ←
          </button>
          <button
            type="button"
            className="tt-btn tt-btn-outline"
            onClick={() => applyMonth(shiftMonth(month, 1))}
          >
            →
          </button>
          <button
            type="button"
            className="tt-btn tt-btn-dark"
            disabled={!report || !db}
            onClick={() => {
              if (!report || !db) return;
              void exportOwnerMonthReportPdf({
                report,
                settings: db.settings,
                company: companyFromSettings(db.settings),
              });
            }}
          >
            {hi ? "माह PDF" : "Month PDF"}
          </button>
          <button
            type="button"
            className="tt-btn tt-btn-outline"
            disabled={!report || !db}
            onClick={() => {
              if (!report || !db) return;
              void exportOwnerMonthReportExcel({
                report,
                settings: db.settings,
              });
            }}
          >
            Excel
          </button>
          <Link
            href={`/admin/owner/monthly-audit?month=${month}`}
            className="tt-btn tt-btn-outline"
          >
            {hi ? "ऑडिट पेज" : "Audit page"}
          </Link>
        </div>
      </div>

      <DateRangeBar value={range} onChange={setRange} className="mt-4" />

      <nav
        className="sticky top-0 z-10 mt-4 flex flex-wrap gap-2 border-b border-[var(--line)] bg-[var(--surface)] py-2 print:hidden"
        aria-label={hi ? "कॉकपिट खंड" : "Cockpit sections"}
      >
        {SECTIONS.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="tt-btn tt-btn-outline text-xs"
          >
            {hi ? s.hi : s.en}
          </a>
        ))}
      </nav>

      {audit && !audit.stamp ? (
        <div
          className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950"
          role="status"
        >
          <p className="font-semibold">
            {hi ? `मासिक ऑडिट ${month} अधूरा` : `Monthly audit ${month} is open`}
          </p>
          <p className="mt-1">
            {audit.ready.ready
              ? hi
                ? "स्टैम्प लगाने के लिए तैयार।"
                : "Ready to stamp."
              : audit.ready.reasons.join(", ")}
          </p>
          <Link
            href={`/admin/owner/monthly-audit?month=${month}`}
            className="mt-2 inline-block font-semibold underline"
          >
            {hi ? "ऑडिट खोलें →" : "Open audit →"}
          </Link>
        </div>
      ) : null}

      <section id="overview" className="scroll-mt-16">
        <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
          {hi ? "सार" : "Overview"}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(
            [
              {
                label: hi ? "नकद" : "Cash",
                value: money(desk?.cash ?? 0, locale),
                href: "/admin/accounts/cash-bank",
              },
              {
                label: hi ? "बैंक" : "Bank",
                value: money(desk?.bank ?? 0, locale),
                href: "/admin/accounts/cash-bank",
              },
              {
                label: hi ? "बिक्री (MTD)" : "Sales MTD",
                value: money(desk?.salesMtd ?? 0, locale),
                href: "/admin/accounts/reports/sales-analysis",
              },
              {
                label: hi ? "खरीद (MTD)" : "Purchase MTD",
                value: money(desk?.purchaseMtd ?? 0, locale),
                href: "/admin/accounts/reports/purchase-analysis",
              },
              {
                label: hi ? "लेना (AR)" : "Receivables",
                value: money(desk?.receivables ?? 0, locale),
                href: "/admin/accounts/receivables",
              },
              {
                label: hi ? "देना (AP)" : "Payables",
                value: money(desk?.payables ?? 0, locale),
                href: "/admin/accounts/payables",
              },
              {
                label: hi ? "स्टॉक वैल्यू" : "Stock value",
                value: money(desk?.stockValue ?? 0, locale),
                href: "/admin/accounts/reports/stock-valuation",
              },
              {
                label: hi ? "नेट P/L" : "Net P/L",
                value: money(report?.pl.net ?? 0, locale),
                href: "/admin/accounts/reports/pl",
              },
            ] as const
          ).map((k) => (
            <Link
              key={k.label}
              href={k.href}
              className="tt-panel block p-4 transition hover:border-[var(--brand)]"
            >
              <p className="text-sm text-[var(--ink-muted)]">{k.label}</p>
              <p className="mt-2 text-xl font-semibold tabular-nums">{k.value}</p>
            </Link>
          ))}
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {(
            [
              {
                label: hi ? "पुष्टि" : "Confirm",
                n: metrics?.backlog.needConfirm ?? 0,
                href: "/admin/orders?filter=estimate",
              },
              {
                label: hi ? "बिल" : "Bill",
                n: metrics?.backlog.needBill ?? 0,
                href: "/admin/orders?filter=need_bill",
              },
              {
                label: hi ? "पेमेंट" : "Payment",
                n: metrics?.backlog.needVerify ?? 0,
                href: "/admin/orders?filter=need_verify",
              },
              {
                label: hi ? "रीऑर्डर" : "Reorder",
                n: cockpit?.queues.counts.need_reorder ?? 0,
                href: "/admin/accounts/reports/stock-alerts",
              },
            ] as const
          ).map((b) => (
            <Link
              key={b.href}
              href={b.href}
              className="tt-panel block p-4 transition hover:border-[var(--brand)]"
            >
              <p className="text-sm text-[var(--ink-muted)]">{b.label}</p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">{b.n}</p>
            </Link>
          ))}
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="tt-panel p-4">
            <h3 className="text-sm font-semibold">
              {hi ? "12 माह बिक्री" : "12-month sales"}
            </h3>
            <BarChart data={salesBars} maxBars={12} className="mt-2" />
          </div>
          <div className="tt-panel p-4">
            <h3 className="text-sm font-semibold">
              {hi ? "12 माह खरीद" : "12-month purchases"}
            </h3>
            <BarChart data={purchaseBars} maxBars={12} className="mt-2" />
          </div>
          <div className="tt-panel p-4">
            <h3 className="text-sm font-semibold">
              {hi ? "दैनिक बिल्ड" : "Daily billed"}
            </h3>
            <LineChart data={dailyLine} className="mt-2" />
          </div>
          <div className="tt-panel p-4">
            <h3 className="text-sm font-semibold">
              {hi ? "कैटेगरी मिक्स" : "Category mix"}
            </h3>
            <BarChart data={categoryBars} maxBars={8} className="mt-2" />
          </div>
        </div>
      </section>

      <section id="money" className="scroll-mt-16">
        <h2 className="mt-10 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
          {hi ? "पैसा" : "Money"}
        </h2>
        <div className="tt-panel mt-3 overflow-x-auto">
          <table className="tt-table min-w-[720px]">
            <thead>
              <tr>
                <th />
                <th>{month}</th>
                <th>{report?.priorMonth}</th>
                <th>{hi ? "अंतर" : "Var"}</th>
                <th>{report?.yearAgoMonth}</th>
                <th>YoY</th>
              </tr>
            </thead>
            <tbody>
              {(
                [
                  ["Income", report?.pl.income, report?.plPrior.income, report?.vsPrior.income, report?.plYearAgo.income, report?.vsYearAgo.incomePct],
                  ["Expense", report?.pl.expense, report?.plPrior.expense, report?.vsPrior.expense, report?.plYearAgo.expense, report?.vsYearAgo.expensePct],
                  ["Net", report?.pl.net, report?.plPrior.net, report?.vsPrior.net, report?.plYearAgo.net, report?.vsYearAgo.netPct],
                ] as const
              ).map((row) => (
                <tr key={row[0]}>
                  <td className="font-medium">{row[0]}</td>
                  <td className="tabular-nums">{money(row[1] ?? 0, locale)}</td>
                  <td className="tabular-nums">{money(row[2] ?? 0, locale)}</td>
                  <td className="tabular-nums">{deltaLabel(row[3] ?? 0, locale)}</td>
                  <td className="tabular-nums">{money(row[4] ?? 0, locale)}</td>
                  <td className="tabular-nums">
                    {row[5] == null ? "—" : `${row[5].toFixed(1)}%`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="tt-panel p-4">
            <h3 className="text-sm font-semibold">
              {hi ? "कैश फ्लो" : "Cash flow"}
            </h3>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {hi ? "खुला" : "Open"} {money(report?.cashFlow.opening ?? 0, locale)} →{" "}
              {hi ? "बंद" : "close"} {money(report?.cashFlow.closing ?? 0, locale)}
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              {(
                [
                  report?.cashFlow.operating,
                  report?.cashFlow.investing,
                  report?.cashFlow.financing,
                ] as const
              ).map((sec) =>
                sec ? (
                  <li key={sec.label} className="flex justify-between gap-4">
                    <span>{sec.label}</span>
                    <span className="tabular-nums">{money(sec.total, locale)}</span>
                  </li>
                ) : null
              )}
            </ul>
            <Link
              href="/admin/accounts/reports/cash-flow"
              className="mt-3 inline-block text-sm font-semibold text-[var(--brand)]"
            >
              {hi ? "पूरी रिपोर्ट →" : "Full report →"}
            </Link>
          </div>
          <div className="tt-panel p-4">
            <h3 className="text-sm font-semibold">
              {hi ? "AR / AP एजिंग" : "AR / AP aging"}
            </h3>
            <p className="mt-2 text-sm">
              AR {money(report?.receivables.total ?? 0, locale)} ·{" "}
              {hi ? "ओवरड्यू" : "overdue"}{" "}
              {money(report?.receivables.overdueTotal ?? 0, locale)}
            </p>
            <p className="mt-1 text-sm">
              AP {money(report?.payables.total ?? 0, locale)} ·{" "}
              {hi ? "ओवरड्यू" : "overdue"}{" "}
              {money(report?.payables.overdueTotal ?? 0, locale)}
            </p>
            <div className="mt-3 flex gap-2">
              <Link href="/admin/accounts/receivables" className="tt-btn tt-btn-outline text-xs">
                AR
              </Link>
              <Link href="/admin/accounts/payables" className="tt-btn tt-btn-outline text-xs">
                AP
              </Link>
              <Link href="/admin/accounts/reports/balance-sheet" className="tt-btn tt-btn-outline text-xs">
                {hi ? "बैलेंस शीट" : "Balance sheet"}
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section id="items" className="scroll-mt-16">
        <h2 className="mt-10 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
          {hi ? "आइटम" : "Items"}
        </h2>
        <div className="tt-panel mt-3 overflow-x-auto">
          <table className="tt-table min-w-[860px]">
            <thead>
              <tr>
                <th>{hi ? "आइटम" : "Item"}</th>
                <th>{hi ? "ओपन" : "Open"}</th>
                <th>In</th>
                <th>Out</th>
                <th>{hi ? "क्लोज" : "Close"}</th>
                <th>₹</th>
              </tr>
            </thead>
            <tbody>
              {(report?.topMovers ?? []).map((r) => (
                <tr key={r.key}>
                  <td className="font-medium">{r.label}</td>
                  <td className="tabular-nums">{r.opening}</td>
                  <td className="tabular-nums">{r.inbound}</td>
                  <td className="tabular-nums">{r.outbound}</td>
                  <td className="tabular-nums">{r.closing}</td>
                  <td className="tabular-nums">{money(r.value, locale)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!report?.topMovers.length ? (
            <p className="p-5 text-sm text-[var(--ink-muted)]">{t("common.empty")}</p>
          ) : null}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="tt-panel p-4">
            <h3 className="text-sm font-semibold">
              {hi ? "ग्रॉस प्रॉफिट (कैटेगरी)" : "Gross profit by category"}
            </h3>
            <ul className="mt-3 space-y-1 text-sm">
              {(report?.grossProfit.byCategory ?? []).map((c) => (
                <li key={c.key} className="flex justify-between gap-4">
                  <span>{c.label}</span>
                  <span className="tabular-nums">{money(c.profit || 0, locale)}</span>
                </li>
              ))}
            </ul>
            <Link
              href="/admin/accounts/reports/profit-analysis"
              className="mt-3 inline-block text-sm font-semibold text-[var(--brand)]"
            >
              {hi ? "आइटम P/L →" : "Item P/L →"}
            </Link>
          </div>
          <div className="tt-panel p-4">
            <h3 className="text-sm font-semibold">
              {hi ? "स्लो / डेड स्टॉक" : "Slow / dead stock"}
            </h3>
            <p className="mt-2 text-sm">
              Slow {report?.slowStock.length ?? 0} · Dead{" "}
              {report?.deadStock.length ?? 0}
            </p>
            <ul className="mt-2 max-h-40 space-y-1 overflow-auto text-sm">
              {(report?.deadStock ?? []).slice(0, 8).map((d) => (
                <li key={d.label}>
                  {d.label}
                  {d.daysSinceOut != null ? ` · ${d.daysSinceOut}d` : ""}
                </li>
              ))}
            </ul>
            <Link
              href="/admin/accounts/reports/stock-alerts"
              className="mt-3 inline-block text-sm font-semibold text-[var(--brand)]"
            >
              {hi ? "स्टॉक अलर्ट →" : "Stock alerts →"}
            </Link>
          </div>
        </div>
      </section>

      <section id="people" className="scroll-mt-16">
        <h2 className="mt-10 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
          {hi ? "लोग" : "People"}
        </h2>
        <div className="mt-3 grid gap-4 lg:grid-cols-2">
          <div className="tt-panel overflow-x-auto">
            <h3 className="p-4 pb-0 text-sm font-semibold">
              {hi ? "टॉप डीलर" : "Top dealers"}
            </h3>
            <table className="tt-table min-w-[480px]">
              <thead>
                <tr>
                  <th>{hi ? "डीलर" : "Dealer"}</th>
                  <th>₹</th>
                </tr>
              </thead>
              <tbody>
                {(report?.dealers.top ?? []).slice(0, 10).map((d) => (
                  <tr key={d.key}>
                    <td>{d.label}</td>
                    <td className="tabular-nums">{money(d.amount, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-4 pb-4 text-xs text-[var(--ink-muted)]">
              {hi ? "नए डीलर" : "New dealers"}: {report?.dealers.newDealers.length ?? 0}
              {" · "}
              {hi ? "क्रेडिट ब्रीच" : "Credit breaches"}:{" "}
              {report?.dealers.creditBreaches.length ?? 0}
            </p>
          </div>
          <div className="tt-panel p-4">
            <h3 className="text-sm font-semibold">{hi ? "एचआर / पेरोल" : "HR / payroll"}</h3>
            <ul className="mt-3 space-y-1 text-sm">
              <li className="flex justify-between">
                <span>{hi ? "नेट पेरोल" : "Payroll net"}</span>
                <span className="tabular-nums">
                  {money(report?.hr.payrollNet ?? 0, locale)}
                </span>
              </li>
              <li className="flex justify-between">
                <span>{hi ? "एडवांस बाकी" : "Advances outstanding"}</span>
                <span className="tabular-nums">
                  {money(report?.hr.advancesOutstanding ?? 0, locale)}
                </span>
              </li>
              <li className="flex justify-between">
                <span>{hi ? "हाजिरी फ्लैग" : "Attendance flags"}</span>
                <span className="tabular-nums">
                  {report?.hr.attendanceExceptions ?? 0}
                </span>
              </li>
            </ul>
            <Link href="/admin/hr" className="mt-3 inline-block text-sm font-semibold text-[var(--brand)]">
              {hi ? "एचआर डेस्क →" : "HR desk →"}
            </Link>
          </div>
        </div>
      </section>

      <section id="audit" className="scroll-mt-16">
        <h2 className="mt-10 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
          {hi ? "ऑडिट" : "Audit"}
        </h2>
        <div className="tt-panel mt-3 p-4">
          <p className="text-sm">
            {audit?.stamp
              ? `${hi ? "बंद" : "Closed"} ${audit.stamp.closedAt.slice(0, 10)} · ${audit.stamp.closedByName}`
              : hi
                ? "इस माह का ऑडिट अभी खुला है।"
                : "This month’s audit is still open."}
          </p>
          {report?.auditOverride ? (
            <p className="mt-2 text-sm text-amber-800">
              {hi ? "ओवरराइड" : "Override"}: {report.auditOverride.reason}
            </p>
          ) : null}
          <ul className="mt-3 grid gap-2 sm:grid-cols-2 text-sm">
            <li>
              {hi ? "कमी" : "Shortages"}: {audit?.stockShortages.length ?? 0}
            </li>
            <li>
              {hi ? "न गिने SKU" : "Uncounted SKUs"}: {audit?.uncountedSkus ?? 0}
            </li>
            <li>
              {hi ? "GPS फ्लैग" : "GPS flags"}: {audit?.gpsFlags.length ?? 0}
            </li>
            <li>
              {hi ? "पीरियड लॉक" : "Period lock"}:{" "}
              {report?.periodLockedThrough || (hi ? "खुला" : "Open")}
            </li>
          </ul>
          <Link
            href={`/admin/owner/monthly-audit?month=${month}`}
            className="tt-btn tt-btn-dark mt-4 inline-flex"
          >
            {hi ? "पूरा मासिक ऑडिट" : "Full monthly audit"}
          </Link>
        </div>
      </section>
    </AdminShell>
  );
}
