"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { profitAndLoss } from "@/lib/accounting";
import { ExportButtons } from "@/components/ExportButtons";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { canViewFinancials } from "@/lib/store/db";

export default function AccountsPlPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db } = useDb();
  const year = new Date().getFullYear();
  const [from, setFrom] = useState(`${year}-01-01`);
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const report = useMemo(() => {
    if (!db) return null;
    return profitAndLoss(db.accounts, db.ledgerEntries, from, to);
  }, [db, from, to]);

  const exportOptions = useMemo(() => {
    if (!report) {
      return {
        title: t("accounts.pl"),
        filename: `profit-loss-${from}-${to}.pdf`,
        columns: ["Section", "Account", "Amount"],
        rows: [] as string[][],
      };
    }
    const incomeLabel = locale === "hi" ? "आय" : "Income";
    const expenseLabel = locale === "hi" ? "खर्च" : "Expenses";
    const netLabel =
      report.netProfit >= 0
        ? locale === "hi"
          ? "शुद्ध लाभ"
          : "Net profit"
        : locale === "hi"
          ? "शुद्ध हानि"
          : "Net loss";
    return {
      title: t("accounts.pl"),
      subtitle: `${from} → ${to} · ${netLabel}: ${formatInr(Math.abs(report.netProfit), locale)}`,
      filename: `profit-loss-${from}-${to}.pdf`,
      columns: ["Section", "Account", "Amount"],
      rows: [
        ...report.income.map((r) => [
          incomeLabel,
          `${r.code} · ${r.name}`,
          formatInr(r.amount, locale),
        ]),
        [incomeLabel, t("common.total"), formatInr(report.totalIncome, locale)],
        ...report.expenses.map((r) => [
          expenseLabel,
          `${r.code} · ${r.name}`,
          formatInr(r.amount, locale),
        ]),
        [
          expenseLabel,
          t("common.total"),
          formatInr(report.totalExpense, locale),
        ],
        ["", netLabel, formatInr(Math.abs(report.netProfit), locale)],
      ],
    };
  }, [from, locale, report, t, to]);

  if (!session || !canViewFinancials(session.role)) {
    return (
      <AccountsShell>
        <AdminAccessDenied title={t("owner.ownerOnly")} />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)]">
        {t("accounts.pl")}
      </h1>
      {report && report.expenses.some((e) => e.name.includes("Cost of Goods Sold")) && (
        <p className="mt-2 text-sm text-gray-600">
          Gross profit = Sales − Cost of goods sold
        </p>
      )}
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="tt-label">From</label>
          <input
            type="date"
            className="tt-input"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="tt-label">To</label>
          <input
            type="date"
            className="tt-input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
        <ExportButtons options={exportOptions} disabled={!report} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="tt-panel overflow-x-auto">
          <div className="border-b border-[var(--line)] bg-[var(--brand-deep)] px-4 py-3 font-semibold text-white">
            {locale === "hi" ? "आय" : "Income"}
          </div>
          <table className="tt-table">
            <tbody>
              {(report?.income ?? []).map((r) => (
                <tr key={r.accountId}>
                  <td className="max-w-[12rem] truncate sm:max-w-none">
                    {r.code} · {r.name}
                  </td>
                  <td className="text-right">{formatInr(r.amount, locale)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="font-semibold">Total</td>
                <td className="text-right font-semibold">
                  {formatInr(report?.totalIncome ?? 0, locale)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="tt-panel overflow-x-auto">
          <div className="border-b border-[var(--line)] bg-[var(--brand-deep)] px-4 py-3 font-semibold text-white">
            {locale === "hi" ? "खर्च" : "Expenses"}
          </div>
          <table className="tt-table">
            <tbody>
              {(report?.expenses ?? []).map((r) => (
                <tr key={r.accountId}>
                  <td className="max-w-[12rem] truncate sm:max-w-none">
                    {r.code} · {r.name}
                  </td>
                  <td className="text-right">{formatInr(r.amount, locale)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="font-semibold">Total</td>
                <td className="text-right font-semibold">
                  {formatInr(report?.totalExpense ?? 0, locale)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {report && (() => {
        const salesRow = report.income.find((r) => r.name === "Sales");
        const cogsRow = report.expenses.find((r) => r.name === "Cost of Goods Sold");
        const grossProfit = salesRow && cogsRow
          ? salesRow.amount - cogsRow.amount
          : null;
        return grossProfit !== null && (
          <div className="mt-4 rounded-lg bg-blue-50 px-4 py-3">
            <p className="text-sm font-medium text-blue-900">
              Gross Profit: {formatInr(grossProfit, locale)}
            </p>
          </div>
        );
      })()}

      <p className="mt-6 text-xl font-semibold text-[var(--brand-deep)]">
        {(report?.netProfit ?? 0) >= 0
          ? locale === "hi"
            ? "शुद्ध लाभ"
            : "Net profit"
          : locale === "hi"
            ? "शुद्ध हानि"
            : "Net loss"}
        : {formatInr(Math.abs(report?.netProfit ?? 0), locale)}
      </p>
    </AccountsShell>
  );
}
