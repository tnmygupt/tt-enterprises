"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { itemPurchaseReport, itemSalesReport } from "@/lib/accounting";
import { ExportButtons } from "@/components/ExportButtons";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { canViewFinancials, checkCapability } from "@/lib/store/db";

export default function ItemSalesPurchaseReportPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db } = useDb();
  const showPurchase = session ? canViewFinancials(session.role) : false;
  const [mode, setMode] = useState<"sales" | "purchase">("sales");
  const [range, setRange] = useAdminDateRange("mtd");
  const from = range.from;
  const to = range.to;

  const effectiveMode =
    !showPurchase && mode === "purchase" ? "sales" : mode;

  const rows = useMemo(() => {
    if (!db) return [];
    return effectiveMode === "sales"
      ? itemSalesReport(db.vouchers, from, to)
      : itemPurchaseReport(db.vouchers, from, to);
  }, [db, effectiveMode, from, to]);

  const exportOptions = useMemo(() => {
    const title =
      effectiveMode === "sales"
        ? t("accounts.salesByItem")
        : t("accounts.purchaseByItem");
    return {
      title,
      subtitle: `${from} → ${to}`,
      filename: `${effectiveMode}-by-item-${from}-${to}.pdf`,
      columns: ["Item", "Bundles", "Kg / Pcs", "Amount"],
      rows: rows.map((r) => [
        r.label,
        r.bundles,
        r.secondaryQty,
        formatInr(r.amount, locale),
      ]),
    };
  }, [effectiveMode, from, locale, rows, t, to]);

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
        title={
          effectiveMode === "sales"
            ? t("accounts.salesByItem")
            : t("accounts.purchaseByItem")
        }
      />
      <div className="mt-4 flex flex-wrap gap-3">
        <select
          className="tt-select"
          value={effectiveMode}
          onChange={(e) => setMode(e.target.value as "sales" | "purchase")}
        >
          <option value="sales">{t("accounts.salesByItem")}</option>
          {showPurchase ? (
            <option value="purchase">{t("accounts.purchaseByItem")}</option>
          ) : null}
        </select>
        <DateRangeBar value={range} onChange={setRange} />
        <ExportButtons options={exportOptions} />
        <Link
          href="/admin/accounts/reports/sales-analysis"
          className="tt-btn tt-btn-outline"
        >
          {t("accounts.salesAnalysis")}
        </Link>
      </div>
      <div className="tt-panel mt-4 tt-acct-table-wrap">
        <table className="tt-table min-w-[640px]">
          <thead>
            <tr>
              <th>Item</th>
              <th>{t("common.bundles")}</th>
              <th>Kg / Pcs</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td>{r.bundles}</td>
                <td>{r.secondaryQty}</td>
                <td>{formatInr(r.amount, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length ? (
          <AccountsEmpty message={t("common.empty")} />
        ) : null}
      </div>
    </AccountsShell>
  );
}
