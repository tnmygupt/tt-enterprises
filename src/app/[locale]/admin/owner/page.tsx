"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import {
  ACCT,
  accountBalance,
  allOpenPayables,
  allOpenReceivables,
  profitAndLoss,
} from "@/lib/accounting";
import { companyFromSettings, exportTablePdf } from "@/lib/export-pdf";
import { useDb, useSession } from "@/lib/hooks";
import { computeOwnerMetrics } from "@/lib/owner-metrics";
import { formatInr } from "@/lib/pricing";
import { canViewFinancials } from "@/lib/store/db";

export default function OwnerTrackingPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db } = useDb();
  const [range, setRange] = useAdminDateRange("today");
  const today = new Date().toISOString().slice(0, 10);

  const metrics = useMemo(
    () => computeOwnerMetrics(db, range),
    [db, range]
  );

  const business = useMemo(() => {
    if (!db) return null;
    const cash = db.accounts.find((a) => a.id === ACCT.cash);
    const bank = db.accounts.find((a) => a.id === ACCT.bank);
    const pl = profitAndLoss(
      db.accounts,
      db.ledgerEntries,
      range.from,
      range.to
    );
    const toCollect = allOpenReceivables(
      db.parties,
      db.vouchers,
      db.billAllocations ?? [],
      today,
      db.orders
    ).reduce((s, r) => s + r.outstanding, 0);
    const toPay = allOpenPayables(
      db.parties,
      db.vouchers,
      db.billAllocations ?? [],
      today
    ).reduce((s, r) => s + r.outstanding, 0);
    const salesInRange = (db.vouchers ?? [])
      .filter(
        (v) =>
          v.type === "sale" &&
          !v.voided &&
          v.date >= range.from &&
          v.date <= range.to
      )
      .reduce((s, v) => s + (v.total || 0), 0);
    const purchasesInRange = (db.vouchers ?? [])
      .filter(
        (v) =>
          v.type === "purchase" &&
          !v.voided &&
          v.date >= range.from &&
          v.date <= range.to
      )
      .reduce((s, v) => s + (v.total || 0), 0);
    const stockSku = (db.products ?? []).filter((p) => p.active).length;
    const stockBundles = (db.products ?? []).reduce((s, p) => {
      const fromVars = (p.variations ?? []).reduce(
        (vs, v) => vs + (Number(v.stock) || 0),
        0
      );
      return s + fromVars + (Number(p.stock) || 0);
    }, 0);
    return {
      cash: cash ? accountBalance(cash, db.ledgerEntries, today) : 0,
      bank: bank ? accountBalance(bank, db.ledgerEntries, today) : 0,
      toCollect,
      toPay,
      salesInRange,
      purchasesInRange,
      netProfit: pl.netProfit,
      stockSku,
      stockBundles,
    };
  }, [db, range.from, range.to, today]);

  if (!session || !canViewFinancials(session.role)) {
    return (
      <AdminShell>
        <AdminAccessDenied title={t("owner.ownerOnly")} />
      </AdminShell>
    );
  }

  const snapshot = [
    {
      label: locale === "hi" ? "नकद" : "Cash",
      value: formatInr(business?.cash ?? 0, locale),
      href: "/admin/accounts/cash-bank",
    },
    {
      label: locale === "hi" ? "बैंक" : "Bank",
      value: formatInr(business?.bank ?? 0, locale),
      href: "/admin/accounts/cash-bank",
    },
    {
      label: locale === "hi" ? "लेना (AR)" : "To collect (AR)",
      value: formatInr(business?.toCollect ?? 0, locale),
      href: "/admin/accounts/receivables",
    },
    {
      label: locale === "hi" ? "देना (AP)" : "To pay (AP)",
      value: formatInr(business?.toPay ?? 0, locale),
      href: "/admin/accounts/payables",
    },
    {
      label: locale === "hi" ? "बिक्री (अवधि)" : "Sales (period)",
      value: formatInr(business?.salesInRange ?? 0, locale),
      href: "/admin/accounts/reports/sales-analysis",
    },
    {
      label: locale === "hi" ? "खरीद (अवधि)" : "Purchases (period)",
      value: formatInr(business?.purchasesInRange ?? 0, locale),
      href: "/admin/accounts/reports/purchase-analysis",
    },
    {
      label: locale === "hi" ? "लाभ / हानि" : "Net P/L",
      value: formatInr(business?.netProfit ?? 0, locale),
      href: "/admin/accounts/reports/pl",
    },
    {
      label: locale === "hi" ? "स्टॉक SKU / बंडल" : "Stock SKUs / bundles",
      value: `${business?.stockSku ?? 0} / ${Math.round(business?.stockBundles ?? 0)}`,
      href: "/admin/accounts/inventory",
    },
  ];

  const kpis = [
    {
      label: locale === "hi" ? "ऑर्डर बनाए" : "Orders created",
      value: String(metrics.ordersCreated),
    },
    {
      label: locale === "hi" ? "बिल्ड / वैल्यू ₹" : "Billed / value ₹",
      value: formatInr(metrics.billedAmount, locale),
    },
    {
      label: locale === "hi" ? "वेरिफाइड पेमेंट ₹" : "Verified payment ₹",
      value: formatInr(metrics.verifiedPaymentAmount, locale),
    },
    {
      label: locale === "hi" ? "वॉलेट जमा ₹" : "Wallet deposits ₹",
      value: formatInr(metrics.walletDepositsVerified, locale),
    },
    {
      label: locale === "hi" ? "सक्रिय डीलर" : "Active dealers",
      value: String(metrics.dealersWithOrders),
    },
    {
      label: locale === "hi" ? "औसत ऑर्डर" : "Avg order value",
      value: formatInr(metrics.avgOrderValue, locale),
    },
  ];

  const exportPdf = () => {
    // Labels are written in English on purpose: the PDF engine cannot shape
    // Devanagari, so Hindi strings would come out blank on the page.
    const money = (n: number) => formatInr(n, "en");
    void exportTablePdf({
      title: "Owner dashboard",
      subtitle: `${range.from} to ${range.to}`,
      filename: `owner-dashboard-${range.from}-${range.to}.pdf`,
      company: companyFromSettings(db?.settings),
      columns: ["Metric", "Value"],
      rows: [
        ["Cash", money(business?.cash ?? 0)],
        ["Bank", money(business?.bank ?? 0)],
        ["To collect (AR)", money(business?.toCollect ?? 0)],
        ["To pay (AP)", money(business?.toPay ?? 0)],
        ["Sales (period)", money(business?.salesInRange ?? 0)],
        ["Purchases (period)", money(business?.purchasesInRange ?? 0)],
        ["Net P/L", money(business?.netProfit ?? 0)],
        [
          "Stock SKUs / bundles",
          `${business?.stockSku ?? 0} / ${Math.round(business?.stockBundles ?? 0)}`,
        ],
        ["Orders created", String(metrics.ordersCreated)],
        ["Billed / value", money(metrics.billedAmount)],
        ["Verified payment", money(metrics.verifiedPaymentAmount)],
        ["Wallet deposits", money(metrics.walletDepositsVerified)],
        ["Active dealers", String(metrics.dealersWithOrders)],
        ["Avg order value", money(metrics.avgOrderValue)],
        ["Backlog - confirm", metrics.backlog.needConfirm],
        ["Backlog - bill", metrics.backlog.needBill],
        ["Backlog - payment", metrics.backlog.needVerify],
        ["Backlog - LR", metrics.backlog.needLr],
        ...metrics.dealers.map((d) => [
          d.name,
          `${d.orders} orders · ${money(d.billed)} · ${d.weightKg.toFixed(1)} kg`,
        ]),
      ],
    });
  };

  return (
    <AdminShell wide>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">
            {locale === "hi" ? "ओनर डैशबोर्ड" : "Owner dashboard"}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {locale === "hi"
              ? "नकद, बिक्री, खरीद, बकाया और ऑर्डर — पूरा व्यवसाय एक नज़र में"
              : "Cash, sales, purchases, dues & orders — full business at a glance"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="tt-btn tt-btn-dark" onClick={exportPdf}>
            {locale === "hi" ? "PDF निर्यात" : "Export PDF"}
          </button>
          <Link href="/admin/owner/monthly-audit" className="tt-btn tt-btn-outline">
            {locale === "hi" ? "मासिक ऑडिट" : "Monthly audit"}
          </Link>
          <Link href="/admin/accounts" className="tt-btn tt-btn-outline">
            {locale === "hi" ? "अकाउंट्स" : "Accounts"}
          </Link>
        </div>
      </div>

      <DateRangeBar value={range} onChange={setRange} className="mt-4" />

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {locale === "hi" ? "व्यवसाय स्नैपशॉट" : "Business snapshot"}
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {snapshot.map((k) => (
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

      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {(
          [
            {
              href: "/admin/accounts/reports/pl",
              label: "P&L",
            },
            {
              href: "/admin/accounts/reports/balance-sheet",
              label: locale === "hi" ? "बैलेंस शीट" : "Balance sheet",
            },
            {
              href: "/admin/accounts/daybook",
              label: locale === "hi" ? "डे बुक" : "Day book",
            },
            {
              href: "/admin/accounts/reports/cash-flow",
              label: locale === "hi" ? "कैश फ्लो" : "Cash flow",
            },
            {
              href: "/admin/accounts/reports/stock-valuation",
              label: locale === "hi" ? "स्टॉक वैल्यू" : "Stock value",
            },
          ] as const
        ).map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="tt-btn tt-btn-outline text-xs"
          >
            {l.label}
          </Link>
        ))}
      </div>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {locale === "hi" ? "ऑर्डर मेट्रिक्स" : "Order metrics"}
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((k) => (
          <div key={k.label} className="tt-panel p-4">
            <p className="text-sm text-[var(--ink-muted)]">{k.label}</p>
            <p className="mt-2 text-xl font-semibold tabular-nums">{k.value}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {locale === "hi" ? "खुला बैकलॉग" : "Open backlog"}
      </h2>
      <p className="mt-1 text-xs text-[var(--ink-muted)]">
        {locale === "hi"
          ? "लाइव कतार — तारीख फ़िल्टर नहीं"
          : "Live queues — not limited by date"}
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            {
              label: locale === "hi" ? "पुष्टि" : "Confirm",
              n: metrics.backlog.needConfirm,
              href: "/admin/orders?filter=estimate",
            },
            {
              label: locale === "hi" ? "बिल" : "Bill",
              n: metrics.backlog.needBill,
              href: "/admin/orders?filter=need_bill",
            },
            {
              label: locale === "hi" ? "पेमेंट" : "Payment",
              n: metrics.backlog.needVerify,
              href: "/admin/orders?filter=need_verify",
            },
            {
              label: locale === "hi" ? "LR" : "LR",
              n: metrics.backlog.needLr,
              href: "/admin/orders?filter=need_lr",
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

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {locale === "hi" ? "फनल" : "Funnel"}
          </h2>
          <div className="tt-panel mt-3 overflow-x-auto">
            <table className="tt-table min-w-[420px]">
              <thead>
                <tr>
                  <th>{t("common.status")}</th>
                  <th>{locale === "hi" ? "गिनती" : "Count"}</th>
                  <th>₹</th>
                </tr>
              </thead>
              <tbody>
                {metrics.funnel.map((s) => (
                  <tr key={s.status}>
                    <td>{locale === "hi" ? s.labelHi : s.labelEn}</td>
                    <td className="tabular-nums">{s.count}</td>
                    <td className="tabular-nums">
                      {formatInr(s.amount, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {locale === "hi" ? "एजिंग" : "Aging"}
          </h2>
          <div className="tt-panel mt-3 overflow-x-auto">
            <table className="tt-table min-w-[360px]">
              <thead>
                <tr>
                  <th>{locale === "hi" ? "बकेट" : "Bucket"}</th>
                  <th>{locale === "hi" ? "गिनती" : "Count"}</th>
                </tr>
              </thead>
              <tbody>
                {metrics.aging.map((a) => (
                  <tr key={a.key}>
                    <td>{locale === "hi" ? a.labelHi : a.labelEn}</td>
                    <td className="tabular-nums">{a.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {locale === "hi" ? "टॉप डीलर" : "Top dealers"}
      </h2>
      <div className="tt-panel mt-3 overflow-x-auto">
        <table className="tt-table min-w-[720px]">
          <thead>
            <tr>
              <th>{locale === "hi" ? "डीलर" : "Dealer"}</th>
              <th>{locale === "hi" ? "फ़ोन" : "Phone"}</th>
              <th>{locale === "hi" ? "ऑर्डर" : "Orders"}</th>
              <th>₹</th>
              <th>Kg</th>
            </tr>
          </thead>
          <tbody>
            {metrics.dealers.map((d) => (
              <tr key={d.userId}>
                <td className="font-medium">{d.name}</td>
                <td className="font-mono text-sm">{d.phone}</td>
                <td className="tabular-nums">{d.orders}</td>
                <td className="tabular-nums">
                  {formatInr(d.billed, locale)}
                </td>
                <td className="tabular-nums">{d.weightKg.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!metrics.dealers.length ? (
          <p className="p-5 text-sm text-[var(--ink-muted)]">{t("common.empty")}</p>
        ) : null}
      </div>

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {locale === "hi" ? "दैनिक श्रृंखला" : "Daily series"}
      </h2>
      <div className="tt-panel mt-3 overflow-x-auto">
        <table className="tt-table min-w-[480px]">
          <thead>
            <tr>
              <th>{locale === "hi" ? "तारीख" : "Date"}</th>
              <th>{locale === "hi" ? "ऑर्डर" : "Orders"}</th>
              <th>₹</th>
            </tr>
          </thead>
          <tbody>
            {metrics.daily.map((d) => (
              <tr key={d.date}>
                <td className="font-mono text-sm">{d.date}</td>
                <td className="tabular-nums">{d.orders}</td>
                <td className="tabular-nums">
                  {formatInr(d.billed, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
