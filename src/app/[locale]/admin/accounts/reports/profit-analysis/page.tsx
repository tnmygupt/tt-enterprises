"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { ExportButtons } from "@/components/ExportButtons";
import { BarChart } from "@/components/charts/BarChart";
import { profitAnalysis } from "@/lib/accounting";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { canViewFinancials } from "@/lib/store/db";

type Dim = "item" | "dealer" | "order";

export default function ProfitAnalysisPage() {
  const t = useTranslations();
  const { session } = useSession();
  const { db } = useDb();
  const [range, setRange] = useAdminDateRange("mtd");
  const from = range.from;
  const to = range.to;
  const [dim, setDim] = useState<Dim>("item");

  const data = useMemo(() => {
    if (!db) return null;
    return profitAnalysis(
      db.vouchers,
      db.parties,
      db.products,
      db.batchConsumptions ?? [],
      from,
      to
    );
  }, [db, from, to]);

  const tableRows = useMemo(
    () =>
      dim === "item"
        ? data?.byItem ?? []
        : dim === "dealer"
          ? data?.byDealer ?? []
          : data?.byOrder ?? [],
    [data, dim]
  );

  const exportOptions = useMemo(
    () => ({
      title: `Profit analysis · ${dim}`,
      subtitle: `${from} → ${to}`,
      filename: `profit-analysis-${dim}-${from}-${to}.pdf`,
      columns: ["Name", "Sales", "COGS", "Profit"],
      rows: tableRows.map((r) => [
        r.label,
        formatInr(r.amount),
        formatInr(r.cogs || 0),
        formatInr(r.profit || 0),
      ]),
    }),
    [dim, from, to, tableRows]
  );

  if (!session || !canViewFinancials(session.role)) {
    return (
      <AccountsShell>
        <AdminAccessDenied title={t("accounts.ownerOnlyProfitAnalysis")} />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <AccountsPageHeader
        title={t("accounts.profitAnalysis")}
        hint={t("accounts.profitAnalysisHint")}
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="tt-panel p-4">
          <p className="text-xs text-[var(--ink-muted)]">Sales</p>
          <p className="tt-display text-2xl text-[var(--brand-deep)]">
            {formatInr(data?.totals.sales ?? 0)}
          </p>
        </div>
        <div className="tt-panel p-4">
          <p className="text-xs text-[var(--ink-muted)]">COGS</p>
          <p className="tt-display text-2xl text-[var(--brand-deep)]">
            {formatInr(data?.totals.cogs ?? 0)}
          </p>
        </div>
        <div className="tt-panel p-4">
          <p className="text-xs text-[var(--ink-muted)]">Gross profit</p>
          <p className="tt-display text-2xl text-[var(--ok)]">
            {formatInr(data?.totals.profit ?? 0)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <DateRangeBar value={range} onChange={setRange} />
        <select
          className="tt-select"
          value={dim}
          onChange={(e) => setDim(e.target.value as Dim)}
        >
          <option value="item">By item</option>
          <option value="dealer">By dealer</option>
          <option value="order">By order</option>
        </select>
        <ExportButtons options={exportOptions} />
      </div>

      <div className="tt-panel mt-5 p-4">
        <p className="mb-2 text-sm font-semibold">Top profit · {dim}</p>
        <BarChart
          data={tableRows.slice(0, 8).map((r) => ({
            label: r.label,
            value: r.profit || 0,
          }))}
        />
      </div>

      <div className="tt-panel mt-5 overflow-x-auto">
        <table className="tt-table min-w-[640px]">
          <thead>
            <tr>
              <th>Name</th>
              <th>Sales</th>
              <th>COGS</th>
              <th>Profit</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td>{formatInr(r.amount)}</td>
                <td>{formatInr(r.cogs || 0)}</td>
                <td
                  className={
                    (r.profit || 0) >= 0
                      ? "text-[var(--ok)]"
                      : "text-[var(--danger)]"
                  }
                >
                  {formatInr(r.profit || 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!tableRows.length ? (
          <p className="p-4 text-sm text-[var(--ink-muted)]">
            No sales with cost data in range.
          </p>
        ) : null}
      </div>
    </AccountsShell>
  );
}
