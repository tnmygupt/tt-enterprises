"use client";

import { useMemo, useState } from "react";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { salesAnalysis } from "@/lib/accounting";
import { toDateInputValue } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { checkCapability } from "@/lib/store/db";

type Dim = "item" | "customer" | "category";

export default function SalesAnalysisPage() {
  const { session } = useSession();
  const { db } = useDb();
  const today = toDateInputValue();
  const monthStart = today.slice(0, 8) + "01";
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [dim, setDim] = useState<Dim>("item");

  const data = useMemo(() => {
    if (!db) return null;
    return salesAnalysis(
      db.vouchers,
      db.products,
      db.parties,
      db.categories ?? [],
      from,
      to
    );
  }, [db, from, to]);

  const tableRows =
    dim === "item"
      ? data?.byItem ?? []
      : dim === "customer"
        ? data?.byCustomer ?? []
        : data?.byCategory ?? [];

  const exportOptions = useMemo(
    () => ({
      title: `Sales analysis · ${dim}`,
      subtitle: `${from} → ${to}`,
      filename: `sales-analysis-${dim}-${from}-${to}.pdf`,
      columns: ["Name", "Amount", "Qty", "Bills"],
      rows: tableRows.map((r) => [
        r.label,
        formatInr(r.amount),
        r.qty ?? "",
        r.count ?? "",
      ]),
    }),
    [dim, from, to, tableRows]
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
            Sales analysis
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            By item, customer or category — with monthly trend.
          </p>
        </div>
        <Link href="/admin/accounts/item-sales" className="tt-btn tt-btn-outline">
          Classic by-item
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
        <select
          className="tt-select"
          value={dim}
          onChange={(e) => setDim(e.target.value as Dim)}
        >
          <option value="item">By item</option>
          <option value="customer">By customer</option>
          <option value="category">By category</option>
        </select>
        <ExportButtons options={exportOptions} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="tt-panel p-4">
          <p className="mb-2 text-sm font-semibold">Monthly trend</p>
          <LineChart
            data={(data?.byMonth ?? []).map((m) => ({
              label: m.month,
              value: m.amount,
            }))}
          />
        </div>
        <div className="tt-panel p-4">
          <p className="mb-2 text-sm font-semibold">Top {dim}</p>
          <BarChart
            data={tableRows.slice(0, 8).map((r) => ({
              label: r.label,
              value: r.amount,
            }))}
          />
        </div>
      </div>

      <div className="tt-panel mt-5 overflow-x-auto">
        <table className="tt-table min-w-[560px]">
          <thead>
            <tr>
              <th>Name</th>
              <th>Amount</th>
              <th>Qty</th>
              <th>Bills</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td>{formatInr(r.amount)}</td>
                <td>{r.qty ?? "—"}</td>
                <td>{r.count ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!tableRows.length ? (
          <p className="p-4 text-sm text-[var(--ink-muted)]">No sales in range.</p>
        ) : null}
      </div>
    </AccountsShell>
  );
}
