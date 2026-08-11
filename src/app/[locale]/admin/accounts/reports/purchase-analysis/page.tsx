"use client";

import { useMemo, useState } from "react";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { purchaseAnalysis } from "@/lib/accounting";
import { toDateInputValue } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { canViewFinancials } from "@/lib/store/db";

type Dim = "supplier" | "item";

export default function PurchaseAnalysisPage() {
  const { session } = useSession();
  const { db } = useDb();
  const today = toDateInputValue();
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);
  const [dim, setDim] = useState<Dim>("supplier");

  const data = useMemo(() => {
    if (!db) return null;
    return purchaseAnalysis(db.vouchers, db.parties, from, to);
  }, [db, from, to]);

  const tableRows =
    dim === "supplier" ? data?.bySupplier ?? [] : data?.byItem ?? [];

  const exportOptions = useMemo(
    () => ({
      title: `Purchase analysis · ${dim}`,
      subtitle: `${from} → ${to}`,
      filename: `purchase-analysis-${dim}-${from}-${to}.pdf`,
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

  if (!session || !canViewFinancials(session.role)) {
    return (
      <AccountsShell>
        <AdminAccessDenied title="Owner only — purchase analysis" />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)]">
        Purchase analysis
      </h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        Spend by supplier and item.
      </p>

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
          <option value="supplier">By supplier</option>
          <option value="item">By item</option>
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
          <p className="p-4 text-sm text-[var(--ink-muted)]">
            No purchases in range.
          </p>
        ) : null}
      </div>
    </AccountsShell>
  );
}
