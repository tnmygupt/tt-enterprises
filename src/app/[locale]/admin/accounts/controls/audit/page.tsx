"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { ExportButtons } from "@/components/ExportButtons";
import { listAuditRows } from "@/lib/accounting";
import { useDb, useSession } from "@/lib/hooks";
import { checkCapability } from "@/lib/store/db";

export default function AuditTrailPage() {
  const t = useTranslations();
  const { session } = useSession();
  const { db } = useDb();
  const [range, setRange] = useAdminDateRange("mtd");
  const from = range.from;
  const to = range.to;
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    if (!db) return [];
    return listAuditRows({
      vouchers: db.vouchers,
      goodsReceipts: db.goodsReceipts,
      users: db.users,
      from,
      to,
      q,
    }).slice(0, 400);
  }, [db, from, to, q]);

  const exportOptions = useMemo(
    () => ({
      title: "Audit trail",
      subtitle: `${from} → ${to}`,
      filename: `audit-${from}-${to}.pdf`,
      columns: ["When", "Date", "Kind", "Number", "By", "Summary"],
      rows: rows.map((r) => [
        r.at.slice(0, 19).replace("T", " "),
        r.date,
        r.kind,
        r.number,
        r.byName,
        r.summary,
      ]),
    }),
    [from, rows, to]
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
        title={t("accounts.auditTrail")}
        hint={t("accounts.auditHint")}
        actions={
          <Link href="/admin/accounts/controls" className="tt-btn tt-btn-outline">
            {t("accounts.navControls")}
          </Link>
        }
      />

      <div className="mt-4 flex flex-wrap gap-3">
        <DateRangeBar value={range} onChange={setRange} />
        <input
          className="tt-input min-w-[160px]"
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ExportButtons options={exportOptions} disabled={!rows.length} />
      </div>

      <div className="tt-panel mt-5 tt-acct-table-wrap">
        <table className="tt-table min-w-[780px]">
          <thead>
            <tr>
              <th>When</th>
              <th>Voucher date</th>
              <th>Kind</th>
              <th>Number</th>
              <th>By</th>
              <th>Summary</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.id}
                className={r.voided ? "opacity-60" : undefined}
              >
                <td className="font-mono text-xs whitespace-nowrap">
                  {r.at.slice(0, 19).replace("T", " ")}
                </td>
                <td>{r.date}</td>
                <td className="font-mono text-xs">{r.kind}</td>
                <td className="font-mono text-sm">{r.number}</td>
                <td>{r.byName}</td>
                <td className="text-sm">{r.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? (
          <p className="p-4 text-sm text-[var(--ink-muted)]">
            No audit rows in this range.
          </p>
        ) : null}
      </div>
    </AccountsShell>
  );
}
