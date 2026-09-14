"use client";

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AccountsShell } from "@/components/AccountsShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { ExportButtons } from "@/components/ExportButtons";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { canViewFinancials, checkCapability } from "@/lib/store/db";

export default function AccountsDaybookPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db } = useDb();
  const showPurchaseAmounts = session
    ? canViewFinancials(session.role)
    : false;
  const [range, setRange] = useAdminDateRange("mtd");

  const rows = useMemo(() => {
    if (!db) return [];
    return db.vouchers
      .filter(
        (v) => !v.voided && v.date >= range.from && v.date <= range.to
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  }, [db, range.from, range.to]);

  const exportOptions = useMemo(
    () => ({
      title: t("accounts.daybook"),
      subtitle: `${range.from} → ${range.to}`,
      filename: `daybook-${range.from}-${range.to}.pdf`,
      columns: ["No.", "Type", "Party", "Narration", "Total"],
      rows: rows.map((v) => [
        v.number,
        v.type,
        db?.parties.find((p) => p.id === v.partyId)?.name || "—",
        v.narration || "—",
        (v.type === "purchase" || v.type === "debit_note") &&
        !showPurchaseAmounts
          ? "••••"
          : formatInr(v.total, locale),
      ]),
    }),
    [db, locale, range.from, range.to, rows, showPurchaseAmounts, t]
  );

  if (!session || !checkCapability(session, db, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <AccountsPageHeader
        title={t("accounts.daybook")}
        extra={
          <div className="flex flex-wrap items-end gap-3">
            <DateRangeBar value={range} onChange={setRange} />
            <ExportButtons options={exportOptions} />
          </div>
        }
      />
      <div className="tt-acct-cards mt-6 sm:hidden">
        {rows.map((v) => (
          <div key={v.id} className="tt-panel tt-acct-card">
            <p className="font-mono text-sm font-semibold text-[var(--brand-deep)]">
              <VoucherNumberLink id={v.id} number={v.number} />
            </p>
            <p className="text-xs capitalize text-[var(--ink-muted)]">
              {v.date} · {v.type}
              {db?.parties.find((p) => p.id === v.partyId)
                ? ` · ${db.parties.find((p) => p.id === v.partyId)?.name}`
                : ""}
            </p>
            <p className="mt-1 text-sm font-semibold tabular-nums">
              {(v.type === "purchase" || v.type === "debit_note") &&
              !showPurchaseAmounts
                ? "••••"
                : formatInr(v.total, locale)}
            </p>
          </div>
        ))}
      </div>
      <div className="tt-panel tt-acct-table-wrap mt-6 hidden sm:block">
        <table className="tt-table min-w-[700px]">
          <thead>
            <tr>
              <th>{t("accounts.colNo")}</th>
              <th>{t("accounts.colType")}</th>
              <th>{t("accounts.colParty")}</th>
              <th>{t("accounts.colNarration")}</th>
              <th>{t("accounts.colTotal")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td><VoucherNumberLink id={v.id} number={v.number} /></td>
                <td className="capitalize">{v.type}</td>
                <td>
                  {db?.parties.find((p) => p.id === v.partyId)?.name || "—"}
                </td>
                <td className="text-sm text-[var(--ink-muted)]">
                  {v.narration || "—"}
                </td>
                <td className="tabular-nums">
                  {(v.type === "purchase" || v.type === "debit_note") &&
                  !showPurchaseAmounts
                    ? "••••"
                    : formatInr(v.total, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length ? (
        <AccountsEmpty
          message={t("accounts.emptyDaybook")}
          href="/admin/accounts/vouchers?new=receipt"
          cta={t("accounts.recordReceipt")}
        />
      ) : null}
    </AccountsShell>
  );
}
