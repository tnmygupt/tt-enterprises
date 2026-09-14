"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AccountsShell } from "@/components/AccountsShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { ACCT, accountBalance, cashBankAccounts } from "@/lib/accounting";
import { ExportButtons } from "@/components/ExportButtons";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr, roundMoney } from "@/lib/pricing";
import { checkCapability } from "@/lib/store/db";

export default function CashBankBookPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db } = useDb();
  const [accountId, setAccountId] = useState<string>(ACCT.cash);
  const [range, setRange] = useAdminDateRange("mtd");
  const from = range.from;
  const to = range.to;

  const rows = useMemo(() => {
    if (!db) return [];
    return db.ledgerEntries
      .filter(
        (e) =>
          !e.voided &&
          e.accountId === accountId &&
          e.date >= from &&
          e.date <= to
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, [db, accountId, from, to]);

  const opening = useMemo(() => {
    if (!db) return 0;
    const acc = db.accounts.find((a) => a.id === accountId);
    if (!acc) return 0;
    const dayBefore = new Date(from + "T00:00:00");
    dayBefore.setDate(dayBefore.getDate() - 1);
    const asOf = dayBefore.toISOString().slice(0, 10);
    return accountBalance(acc, db.ledgerEntries, asOf);
  }, [db, accountId, from]);

  const rowsWithBal = useMemo(() => {
    const out: { e: (typeof rows)[number]; bal: number }[] = [];
    let running = opening;
    for (const e of rows) {
      running = roundMoney(running + e.debit - e.credit);
      out.push({ e, bal: running });
    }
    return out;
  }, [rows, opening]);

  const cashBankOpts = useMemo(
    () => cashBankAccounts(db?.accounts ?? []),
    [db]
  );

  const exportOptions = useMemo(() => {
    const label =
      cashBankOpts.find((a) => a.id === accountId)?.name.en || "Cash";
    return {
      title: t("accounts.cashBankBook"),
      subtitle: `${label} · ${from} → ${to} · Opening ${formatInr(opening, locale)}`,
      filename: `cash-bank-${from}-${to}.pdf`,
      columns: [
        "Date",
        "Voucher",
        "Narration",
        "Debit",
        "Credit",
        "Balance",
      ],
      rows: [
        ["", "", "Opening", "", "", formatInr(opening, locale)],
        ...rowsWithBal.map(({ e, bal }) => [
          e.date,
          e.voucherNumber,
          e.narration || "—",
          e.debit ? formatInr(e.debit, locale) : "",
          e.credit ? formatInr(e.credit, locale) : "",
          formatInr(bal, locale),
        ]),
      ],
    };
  }, [accountId, cashBankOpts, from, locale, opening, rowsWithBal, t, to]);

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
        title={t("accounts.cashBankBook")}
        extra={
          <div className="flex flex-wrap gap-3">
            <select
              className="tt-select"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {cashBankOpts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name[locale] || a.name.en}
                </option>
              ))}
            </select>
            <DateRangeBar value={range} onChange={setRange} />
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={() => window.print()}
            >
              {t("accounts.print")}
            </button>
            <ExportButtons options={exportOptions} />
            <Link href="/admin/accounts/brs" className="tt-btn tt-btn-outline">
              {t("accounts.brs")} · Alt+B
            </Link>
          </div>
        }
      />
      <div className="tt-acct-cards mt-4 sm:hidden">
        <div className="tt-panel tt-acct-card">
          <p className="text-xs font-bold uppercase text-[var(--ink-muted)]">
            {t("accounts.colOpening")}
          </p>
          <p className="mt-1 text-sm font-semibold tabular-nums">
            {formatInr(opening, locale)}
          </p>
        </div>
        {rowsWithBal.map(({ e, bal }) => (
          <div key={e.id} className="tt-panel tt-acct-card">
            <p className="text-xs text-[var(--ink-muted)]">{e.date}</p>
            <p className="font-mono text-sm font-semibold">
              <VoucherNumberLink id={e.voucherId} number={e.voucherNumber} />
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {e.narration || "—"}
            </p>
            <p className="mt-1 text-sm tabular-nums">
              {e.debit
                ? `Dr ${formatInr(e.debit, locale)}`
                : e.credit
                  ? `Cr ${formatInr(e.credit, locale)}`
                  : "—"}
              <span className="ml-2 text-[var(--ink-muted)]">
                {formatInr(bal, locale)}
              </span>
            </p>
          </div>
        ))}
      </div>
      <div className="tt-panel tt-acct-table-wrap mt-4 hidden sm:block">
        <table className="tt-table min-w-[720px]">
          <thead>
            <tr>
              <th>{t("accounts.colDate")}</th>
              <th>{t("accounts.colVoucher")}</th>
              <th>{t("accounts.colNarration")}</th>
              <th>{t("accounts.colDebit")}</th>
              <th>{t("accounts.colCredit")}</th>
              <th>{t("accounts.colBalance")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5}>{t("accounts.colOpening")}</td>
              <td className="tabular-nums">{formatInr(opening, locale)}</td>
            </tr>
            {rowsWithBal.map(({ e, bal }) => (
              <tr key={e.id}>
                <td>{e.date}</td>
                <td><VoucherNumberLink id={e.voucherId} number={e.voucherNumber} /></td>
                <td className="text-sm">{e.narration || "—"}</td>
                <td className="tabular-nums">{e.debit ? formatInr(e.debit, locale) : ""}</td>
                <td className="tabular-nums">{e.credit ? formatInr(e.credit, locale) : ""}</td>
                <td className="tabular-nums">{formatInr(bal, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rowsWithBal.length ? (
        <AccountsEmpty
          message={t("accounts.emptyCashBank")}
          href="/admin/accounts/vouchers?new=receipt"
          cta={t("accounts.recordReceipt")}
        />
      ) : null}
    </AccountsShell>
  );
}
