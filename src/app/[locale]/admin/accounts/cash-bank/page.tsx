"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AccountsShell } from "@/components/AccountsShell";
import { ACCT, accountBalance, cashBankAccounts } from "@/lib/accounting";
import { ExportButtons } from "@/components/ExportButtons";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr, roundMoney } from "@/lib/pricing";
import { checkCapability } from "@/lib/store/db";
import { toDateInputValue } from "@/lib/date-range";

export default function CashBankBookPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db } = useDb();
  const [accountId, setAccountId] = useState<string>(ACCT.cash);
  const today = toDateInputValue();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

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

  if (!session || !checkCapability(session, db?.users, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)] print:text-2xl">
        {t("accounts.cashBankBook")}
      </h1>
      <div className="mt-4 flex flex-wrap gap-3 print:hidden">
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
        <input
          type="date"
          className="tt-input"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          className="tt-input"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
        <button
          type="button"
          className="tt-btn tt-btn-outline"
          onClick={() => window.print()}
        >
          {t("accounts.print")}
        </button>
        <ExportButtons options={exportOptions} />
      </div>
      <div className="tt-panel mt-4 overflow-x-auto">
        <table className="tt-table min-w-[720px]">
          <thead>
            <tr>
              <th>Date</th>
              <th>Voucher</th>
              <th>Narration</th>
              <th>Debit</th>
              <th>Credit</th>
              <th>Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={5}>Opening</td>
              <td>{formatInr(opening, locale)}</td>
            </tr>
            {rowsWithBal.map(({ e, bal }) => (
              <tr key={e.id}>
                <td>{e.date}</td>
                <td><VoucherNumberLink id={e.voucherId} number={e.voucherNumber} /></td>
                <td className="text-sm">{e.narration || "—"}</td>
                <td>{e.debit ? formatInr(e.debit, locale) : ""}</td>
                <td>{e.credit ? formatInr(e.credit, locale) : ""}</td>
                <td>{formatInr(bal, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AccountsShell>
  );
}
