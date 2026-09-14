"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { runBooksHealthCheck } from "@/lib/accounting";
import { toDateInputValue } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import {
  canViewFinancials,
  checkCapability,
  repairBooksIntegrity,
} from "@/lib/store/db";

export default function HealthCheckPage() {
  const t = useTranslations();
  const { session } = useSession();
  const { db, refresh } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;
  const [asOf, setAsOf] = useState(toDateInputValue());
  const [repairMsg, setRepairMsg] = useState("");
  const [repairErr, setRepairErr] = useState("");
  const [repairing, setRepairing] = useState(false);

  const report = useMemo(() => {
    if (!db) return null;
    return runBooksHealthCheck({
      accounts: db.accounts,
      ledgerEntries: db.ledgerEntries,
      parties: db.parties,
      vouchers: db.vouchers,
      billAllocations: db.billAllocations,
      orders: db.orders,
      stockBatches: db.stockBatches,
      asOf,
    });
  }, [db, asOf]);

  const visible = useMemo(
    () =>
      (report?.items ?? []).filter((i) => isOwner || !i.ownerOnly),
    [report, isOwner]
  );

  const exportOptions = useMemo(
    () => ({
      title: "Books health check",
      subtitle: `As of ${asOf}`,
      filename: `health-check-${asOf}.pdf`,
      columns: ["Check", "Status", "Detail"],
      rows: visible.map((i) => [
        i.label,
        i.ok ? "OK" : "FAIL",
        i.detail,
      ]),
    }),
    [asOf, visible]
  );

  const onRepair = () => {
    if (!session || !isOwner) return;
    setRepairMsg("");
    setRepairErr("");
    setRepairing(true);
    try {
      const result = repairBooksIntegrity(session.id);
      const failBit =
        result.salesFailed.length > 0
          ? ` · ${result.salesFailed.length} sale(s) still failing`
          : "";
      setRepairMsg(
        `Repaired: ${result.salesCreated} sale voucher(s), ${result.receiptsSynced} new receipt(s), openings synced${failBit}`
      );
      if (result.salesFailed.length) {
        setRepairErr(result.salesFailed.slice(0, 5).join(" · "));
      }
      refresh();
    } catch (err) {
      setRepairErr(err instanceof Error ? err.message : "Repair failed");
    } finally {
      setRepairing(false);
    }
  };

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
        title={t("accounts.healthCheck")}
        hint={t("accounts.healthHint")}
        actions={
          <Link href="/admin/accounts/controls" className="tt-btn tt-btn-outline">
            {t("accounts.navControls")}
          </Link>
        }
      />

      <div className="mt-4 flex flex-wrap gap-3">
        <input
          type="date"
          className="tt-input"
          value={asOf}
          onChange={(e) => setAsOf(e.target.value)}
        />
        <ExportButtons options={exportOptions} />
        {isOwner ? (
          <button
            type="button"
            className="tt-btn tt-btn-dark"
            disabled={repairing}
            onClick={onRepair}
          >
            {repairing ? "Repairing…" : "Repair books gaps"}
          </button>
        ) : null}
      </div>
      {repairMsg ? (
        <p className="mt-2 text-sm text-[var(--ok)]">{repairMsg}</p>
      ) : null}
      {repairErr ? (
        <p className="mt-2 text-sm text-[var(--danger)]">{repairErr}</p>
      ) : null}

      {report ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="tt-panel p-4">
            <p className="text-xs text-[var(--ink-muted)]">Passed</p>
            <p className="tt-display text-3xl text-[var(--ok)]">
              {visible.filter((i) => i.ok).length}
            </p>
          </div>
          <div className="tt-panel p-4">
            <p className="text-xs text-[var(--ink-muted)]">Failed</p>
            <p
              className={`tt-display text-3xl ${
                visible.some((i) => !i.ok)
                  ? "text-[var(--danger)]"
                  : "text-[var(--ok)]"
              }`}
            >
              {visible.filter((i) => !i.ok).length}
            </p>
          </div>
        </div>
      ) : null}

      <div className="tt-panel mt-5 overflow-x-auto">
        <table className="tt-table min-w-[640px]">
          <thead>
            <tr>
              <th>Check</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((i) => (
              <tr key={i.id}>
                <td className="font-medium">{i.label}</td>
                <td>
                  <span
                    className={
                      i.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"
                    }
                  >
                    {i.ok ? "OK" : "FAIL"}
                  </span>
                </td>
                <td className="text-sm text-[var(--ink-muted)]">{i.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AccountsShell>
  );
}
