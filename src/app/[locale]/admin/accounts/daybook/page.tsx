"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AccountsShell } from "@/components/AccountsShell";
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
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const rows = useMemo(() => {
    if (!db) return [];
    return db.vouchers
      .filter((v) => !v.voided && v.date === date)
      .sort((a, b) => a.number.localeCompare(b.number));
  }, [db, date]);

  const exportOptions = useMemo(
    () => ({
      title: t("accounts.daybook"),
      subtitle: date,
      filename: `daybook-${date}.pdf`,
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
    [date, db, locale, rows, showPurchaseAmounts, t]
  );

  if (!session || !checkCapability(session, db?.users, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)]">
        {t("accounts.daybook")}
      </h1>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div className="max-w-xs">
          <label className="tt-label">Date</label>
          <input
            type="date"
            className="tt-input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <ExportButtons options={exportOptions} />
      </div>
      <div className="tt-panel mt-6 overflow-x-auto">
        <table className="tt-table min-w-[700px]">
          <thead>
            <tr>
              <th>No.</th>
              <th>Type</th>
              <th>Party</th>
              <th>Narration</th>
              <th>Total</th>
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
                <td>
                  {(v.type === "purchase" || v.type === "debit_note") &&
                  !showPurchaseAmounts
                    ? "••••"
                    : formatInr(v.total, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? (
          <p className="p-4 text-sm text-[var(--ink-muted)]">{t("common.empty")}</p>
        ) : null}
      </div>
    </AccountsShell>
  );
}
