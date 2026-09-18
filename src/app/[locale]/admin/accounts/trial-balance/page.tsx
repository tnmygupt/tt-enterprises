"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { trialBalance } from "@/lib/accounting";
import { ExportButtons } from "@/components/ExportButtons";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { canViewFinancials } from "@/lib/store/db";

export default function TrialBalancePage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db } = useDb();
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));

  const report = useMemo(() => {
    if (!db) return null;
    return trialBalance(db.accounts, db.ledgerEntries, asOf);
  }, [db, asOf]);

  const exportOptions = useMemo(() => {
    if (!report) {
      return {
        title: t("accounts.trialBalance"),
        filename: `trial-balance-${asOf}.pdf`,
        columns: [
          t("accounts.colCode"),
          t("accounts.accountLabel"),
          t("accounts.colDebit"),
          t("accounts.colCredit"),
        ],
        rows: [] as string[][],
      };
    }
    return {
      title: t("accounts.trialBalance"),
      subtitle: `${t("common.asOf")} ${asOf}`,
      filename: `trial-balance-${asOf}.pdf`,
      columns: [
        t("accounts.colCode"),
        t("accounts.accountLabel"),
        t("accounts.colDebit"),
        t("accounts.colCredit"),
      ],
      rows: report.rows.map((r) => [
        r.code,
        r.name,
        r.debit ? formatInr(r.debit, locale) : "",
        r.credit ? formatInr(r.credit, locale) : "",
      ]),
      foot: [
        t("common.total"),
        "",
        formatInr(report.totalDebit, locale),
        formatInr(report.totalCredit, locale),
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
        title={t("accounts.trialBalance")}
        hint={t("accounts.reportTbHint")}
      />
      <div className="mt-4 flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="tt-label">{t("common.asOf")}</label>
          <input
            type="date"
            className="tt-input"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </div>
        <button
          type="button"
          className="tt-btn tt-btn-outline"
          onClick={() => window.print()}
        >
          {t("accounts.print")}
        </button>
        <ExportButtons options={exportOptions} disabled={!report} />
      </div>
      <div className="tt-panel mt-4 tt-acct-table-wrap">
        <table className="tt-table min-w-[640px]">
          <thead>
            <tr>
              <th>{t("accounts.colCode")}</th>
              <th>{t("accounts.accountLabel")}</th>
              <th>{t("accounts.colDebit")}</th>
              <th>{t("accounts.colCredit")}</th>
            </tr>
          </thead>
          <tbody>
            {report?.rows.map((r) => (
              <tr key={r.accountId}>
                <td className="font-mono text-sm">{r.code}</td>
                <td>{r.name}</td>
                <td>{r.debit ? formatInr(r.debit, locale) : ""}</td>
                <td>{r.credit ? formatInr(r.credit, locale) : ""}</td>
              </tr>
            ))}
            <tr className="font-semibold">
              <td colSpan={2}>{t("common.total")}</td>
              <td>{formatInr(report?.totalDebit ?? 0, locale)}</td>
              <td>{formatInr(report?.totalCredit ?? 0, locale)}</td>
            </tr>
          </tbody>
        </table>
        {!report?.rows.length ? (
          <AccountsEmpty
            message={t("accounts.emptyTrialBalance")}
            href="/admin/orders/new"
            cta={t("accounts.emptyTrialBalanceCta")}
          />
        ) : null}
      </div>
    </AccountsShell>
  );
}
