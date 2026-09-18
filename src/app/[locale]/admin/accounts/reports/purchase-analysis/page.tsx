"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { ExportButtons } from "@/components/ExportButtons";
import { BarChart } from "@/components/charts/BarChart";
import { LineChart } from "@/components/charts/LineChart";
import { purchaseAnalysis } from "@/lib/accounting";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { canViewFinancials } from "@/lib/store/db";

type Dim = "supplier" | "item";

export default function PurchaseAnalysisPage() {
  const t = useTranslations();
  const { session } = useSession();
  const { db } = useDb();
  const [range, setRange] = useAdminDateRange("mtd");
  const from = range.from;
  const to = range.to;
  const [dim, setDim] = useState<Dim>("supplier");

  const data = useMemo(() => {
    if (!db) return null;
    return purchaseAnalysis(db.vouchers, db.parties, from, to);
  }, [db, from, to]);

  const tableRows = useMemo(
    () => (dim === "supplier" ? data?.bySupplier ?? [] : data?.byItem ?? []),
    [data, dim]
  );

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
        <AdminAccessDenied title={t("accounts.ownerOnlyPurchaseAnalysis")} />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <AccountsPageHeader
        title={t("accounts.purchaseAnalysis")}
        hint={t("accounts.purchaseAnalysisHint")}
      />

      <div className="mt-4 flex flex-wrap gap-3">
        <DateRangeBar value={range} onChange={setRange} />
        <select
          className="tt-select"
          value={dim}
          onChange={(e) => setDim(e.target.value as Dim)}
        >
          <option value="supplier">{t("accounts.bySupplier")}</option>
          <option value="item">{t("accounts.byItem")}</option>
        </select>
        <ExportButtons options={exportOptions} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="tt-panel p-4">
          <p className="mb-2 text-sm font-semibold">{t("accounts.monthlyTrend")}</p>
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

      <div className="tt-panel mt-5 tt-acct-table-wrap">
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
