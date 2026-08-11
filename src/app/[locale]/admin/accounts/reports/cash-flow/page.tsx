"use client";

import { useMemo, useState } from "react";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { BarChart } from "@/components/charts/BarChart";
import { cashFlowStatement } from "@/lib/accounting";
import { toDateInputValue } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { canViewFinancials } from "@/lib/store/db";

export default function CashFlowPage() {
  const { session } = useSession();
  const { db } = useDb();
  const today = toDateInputValue();
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);

  const cf = useMemo(() => {
    if (!db) return null;
    return cashFlowStatement(
      db.accounts,
      db.ledgerEntries,
      db.vouchers,
      from,
      to
    );
  }, [db, from, to]);

  const exportOptions = useMemo(() => {
    if (!cf) {
      return {
        title: "Cash flow",
        filename: "cash-flow.pdf",
        columns: ["Section", "Line", "Amount"],
        rows: [] as string[][],
      };
    }
    const rows: string[][] = [
      ["Opening", "Cash + bank", formatInr(cf.opening)],
      ...cf.operating.rows.map((r) => [
        "Operating",
        r.label,
        formatInr(r.amount),
      ]),
      ["Operating", "Total", formatInr(cf.operating.total)],
      ...cf.financing.rows.map((r) => [
        "Financing",
        r.label,
        formatInr(r.amount),
      ]),
      ["Financing", "Total", formatInr(cf.financing.total)],
      ["Closing", "Cash + bank", formatInr(cf.closing)],
      ["Net change", "", formatInr(cf.netChange)],
    ];
    return {
      title: "Cash flow",
      subtitle: `${from} → ${to}`,
      filename: `cash-flow-${from}-${to}.pdf`,
      columns: ["Section", "Line", "Amount"],
      rows,
    };
  }, [cf, from, to]);

  if (!session || !canViewFinancials(session.role)) {
    return (
      <AccountsShell>
        <AdminAccessDenied title="Owner only — cash flow" />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)]">
        Cash flow
      </h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        How cash and bank moved in the period — receipts, supplier pays,
        expenses, capital.
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
        <ExportButtons options={exportOptions} />
      </div>

      {cf ? (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-3">
            <div className="tt-panel p-4">
              <p className="text-xs text-[var(--ink-muted)]">Opening</p>
              <p className="tt-display text-2xl text-[var(--brand-deep)]">
                {formatInr(cf.opening)}
              </p>
            </div>
            <div className="tt-panel p-4">
              <p className="text-xs text-[var(--ink-muted)]">Net change</p>
              <p
                className={`tt-display text-2xl ${
                  cf.netChange >= 0 ? "text-[var(--ok)]" : "text-[var(--danger)]"
                }`}
              >
                {formatInr(cf.netChange)}
              </p>
            </div>
            <div className="tt-panel p-4">
              <p className="text-xs text-[var(--ink-muted)]">Closing</p>
              <p className="tt-display text-2xl text-[var(--brand-deep)]">
                {formatInr(cf.closing)}
              </p>
            </div>
          </div>

          <div className="tt-panel mt-5 p-4">
            <p className="mb-2 text-sm font-semibold">Section totals</p>
            <BarChart
              data={[
                { label: "Operating", value: cf.operating.total },
                { label: "Financing", value: cf.financing.total },
                { label: "Net", value: cf.netChange },
              ]}
            />
          </div>

          {(
            [
              cf.operating,
              cf.investing,
              cf.financing,
            ] as const
          ).map((sec) => (
            <div key={sec.label} className="tt-panel mt-4 overflow-x-auto">
              <p className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
                {sec.label}
                <span className="ml-2 font-normal text-[var(--ink-muted)]">
                  {formatInr(sec.total)}
                </span>
              </p>
              <table className="tt-table min-w-[400px]">
                <tbody>
                  {sec.rows.map((r) => (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td className="text-right">{formatInr(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </>
      ) : null}
    </AccountsShell>
  );
}
