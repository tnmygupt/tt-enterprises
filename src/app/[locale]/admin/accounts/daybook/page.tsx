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
import { accountLabel } from "@/lib/accounting";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr, roundMoney } from "@/lib/pricing";
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
    return (db.ledgerEntries ?? [])
      .filter((e) => {
        if (e.voided) return false;
        const day = e.date.slice(0, 10);
        return day >= range.from && day <= range.to;
      })
      .sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.voucherNumber.localeCompare(b.voucherNumber) ||
          a.id.localeCompare(b.id)
      );
  }, [db, range.from, range.to]);

  const hideAmt = (voucherType: string) =>
    (voucherType === "purchase" || voucherType === "debit_note") &&
    !showPurchaseAmounts;

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const e of rows) {
      if (hideAmt(e.voucherType)) continue;
      debit += e.debit;
      credit += e.credit;
    }
    return { debit: roundMoney(debit), credit: roundMoney(credit) };
  }, [rows, showPurchaseAmounts]);

  const exportOptions = useMemo(
    () => ({
      title: t("accounts.daybook"),
      subtitle: `${range.from} → ${range.to}`,
      filename: `daybook-${range.from}-${range.to}.pdf`,
      columns: ["Date", "No.", "Type", "Account", "Party", "Narration", "Dr", "Cr"],
      rows: rows.map((e) => {
        const hidden = hideAmt(e.voucherType);
        const party =
          e.partyId
            ? db?.parties.find((p) => p.id === e.partyId)?.name || ""
            : "";
        return [
          e.date.slice(0, 10),
          e.voucherNumber,
          e.voucherType,
          db ? accountLabel(db.accounts, e.accountId, "en") : e.accountId,
          party || "—",
          e.narration || "—",
          hidden ? "••••" : e.debit ? formatInr(e.debit, locale) : "",
          hidden ? "••••" : e.credit ? formatInr(e.credit, locale) : "",
        ];
      }),
      foot: [
        "",
        "",
        "",
        "",
        "",
        "Total",
        formatInr(totals.debit, locale),
        formatInr(totals.credit, locale),
      ],
    }),
    [db, locale, range.from, range.to, rows, showPurchaseAmounts, t, totals]
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
        {rows.map((e) => {
          const hidden = hideAmt(e.voucherType);
          return (
            <div key={e.id} className="tt-panel tt-acct-card">
              <p className="font-mono text-sm font-semibold text-[var(--brand-deep)]">
                <VoucherNumberLink
                  id={e.voucherId}
                  number={e.voucherNumber}
                />
              </p>
              <p className="text-xs capitalize text-[var(--ink-muted)]">
                {e.date.slice(0, 10)} · {e.voucherType}
              </p>
              <p className="mt-1 text-sm">
                {db ? accountLabel(db.accounts, e.accountId, locale) : e.accountId}
              </p>
              <p className="mt-1 text-sm font-semibold tabular-nums">
                {hidden
                  ? "••••"
                  : e.debit
                    ? `Dr ${formatInr(e.debit, locale)}`
                    : `Cr ${formatInr(e.credit, locale)}`}
              </p>
            </div>
          );
        })}
      </div>
      <div className="tt-panel tt-acct-table-wrap mt-6 hidden sm:block">
        <table className="tt-table min-w-[860px]">
          <thead>
            <tr>
              <th>{t("common.date")}</th>
              <th>{t("accounts.colNo")}</th>
              <th>{t("accounts.colType")}</th>
              <th>{locale === "hi" ? "खाता" : "Account"}</th>
              <th>{t("accounts.colParty")}</th>
              <th className="text-right">Dr</th>
              <th className="text-right">Cr</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((e) => {
              const hidden = hideAmt(e.voucherType);
              return (
                <tr key={e.id}>
                  <td className="font-mono text-sm">{e.date.slice(0, 10)}</td>
                  <td>
                    <VoucherNumberLink
                      id={e.voucherId}
                      number={e.voucherNumber}
                    />
                  </td>
                  <td className="capitalize">{e.voucherType}</td>
                  <td className="text-sm">
                    {db
                      ? accountLabel(db.accounts, e.accountId, locale)
                      : e.accountId}
                  </td>
                  <td>
                    {e.partyId
                      ? db?.parties.find((p) => p.id === e.partyId)?.name || "—"
                      : "—"}
                  </td>
                  <td className="tabular-nums text-right">
                    {hidden
                      ? "••••"
                      : e.debit
                        ? formatInr(e.debit, locale)
                        : ""}
                  </td>
                  <td className="tabular-nums text-right">
                    {hidden
                      ? "••••"
                      : e.credit
                        ? formatInr(e.credit, locale)
                        : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="text-right font-semibold">
                {locale === "hi" ? "योग" : "Total"}
              </td>
              <td className="tabular-nums font-semibold">
                {formatInr(totals.debit, locale)}
              </td>
              <td className="tabular-nums font-semibold">
                {formatInr(totals.credit, locale)}
              </td>
            </tr>
          </tfoot>
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
