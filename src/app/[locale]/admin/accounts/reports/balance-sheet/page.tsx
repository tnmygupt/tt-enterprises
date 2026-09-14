"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { balanceSheet } from "@/lib/accounting";
import { ExportButtons } from "@/components/ExportButtons";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { canViewFinancials } from "@/lib/store/db";

export default function AccountsBalanceSheetPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db } = useDb();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));

  const report = useMemo(() => {
    if (!db) return null;
    return balanceSheet(
      db.accounts,
      db.ledgerEntries,
      asOf,
      locale,
      db.settings.financialYearStartMonth ?? 4
    );
  }, [db, asOf, locale]);

  const exportOptions = useMemo(() => {
    if (!report) {
      return {
        title: t("accounts.balanceSheet"),
        filename: `balance-sheet-${asOf}.pdf`,
        columns: ["Section", "Account", "Amount"],
        rows: [] as string[][],
      };
    }
    const assetsLabel = locale === "hi" ? "संपत्ति" : "Assets";
    const liabLabel =
      locale === "hi" ? "देनदारियाँ + पूंजी" : "Liabilities + Equity";
    return {
      title: t("accounts.balanceSheet"),
      subtitle: `As of ${asOf}`,
      filename: `balance-sheet-${asOf}.pdf`,
      columns: ["Section", "Account", "Amount"],
      rows: [
        ...report.assets.map((r) => [
          assetsLabel,
          `${r.code} · ${r.name}`,
          formatInr(r.amount, locale),
        ]),
        [
          assetsLabel,
          t("common.total"),
          formatInr(report.totalAssets, locale),
        ],
        ...[...report.liabilities, ...report.equity].map((r) => [
          liabLabel,
          `${r.code} · ${r.name}`,
          formatInr(r.amount, locale),
        ]),
        [
          liabLabel,
          t("common.total"),
          formatInr(report.totalLiabEquity, locale),
        ],
      ],
    };
  }, [asOf, locale, report, t]);

  if (!session || !canViewFinancials(session.role)) {
    return (
      <AccountsShell>
        <AdminAccessDenied title={t("owner.ownerOnly")} />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <AccountsPageHeader
        title={t("accounts.balanceSheet")}
        hint={t("accounts.reportBsHint")}
      />
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="max-w-xs">
          <label className="tt-label">As of</label>
          <input
            type="date"
            className="tt-input"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </div>
        <ExportButtons options={exportOptions} disabled={!report} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <div className="tt-panel overflow-x-auto">
          <div className="border-b border-[var(--line)] bg-[var(--brand-deep)] px-4 py-3 font-semibold text-white">
            {locale === "hi" ? "संपत्ति" : "Assets"}
          </div>
          <table className="tt-table">
            <tbody>
              {(report?.assets ?? []).map((r) => (
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
                  {formatInr(report?.totalAssets ?? 0, locale)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="tt-panel overflow-x-auto">
          <div className="border-b border-[var(--line)] bg-[var(--brand-deep)] px-4 py-3 font-semibold text-white">
            {locale === "hi" ? "देनदारियाँ + पूंजी" : "Liabilities + Equity"}
          </div>
          <table className="tt-table">
            <tbody>
              {[...(report?.liabilities ?? []), ...(report?.equity ?? [])].map(
                (r) => (
                  <tr key={r.accountId}>
                    <td className="max-w-[12rem] truncate sm:max-w-none">
                      {r.code} · {r.name}
                    </td>
                    <td className="text-right">
                      {formatInr(r.amount, locale)}
                    </td>
                  </tr>
                )
              )}
            </tbody>
            <tfoot>
              <tr>
                <td className="font-semibold">Total</td>
                <td className="text-right font-semibold">
                  {formatInr(report?.totalLiabEquity ?? 0, locale)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </AccountsShell>
  );
}
