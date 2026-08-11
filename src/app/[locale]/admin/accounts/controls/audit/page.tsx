"use client";

import { useMemo, useState } from "react";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { listAuditRows } from "@/lib/accounting";
import { toDateInputValue } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import { checkCapability } from "@/lib/store/db";

export default function AuditTrailPage() {
  const { session } = useSession();
  const { db } = useDb();
  const today = toDateInputValue();
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
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

  if (!session || !checkCapability(session, db?.users, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)]">
            Audit trail
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Who posted or voided what — from voucher and GRN history.
          </p>
        </div>
        <Link href="/admin/accounts/controls" className="tt-btn tt-btn-outline">
          Controls
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
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
        <input
          className="tt-input min-w-[160px]"
          placeholder="Search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ExportButtons options={exportOptions} disabled={!rows.length} />
      </div>

      <div className="tt-panel mt-5 overflow-x-auto">
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
