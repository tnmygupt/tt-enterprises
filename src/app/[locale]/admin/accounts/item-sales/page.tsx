"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { itemPurchaseReport, itemSalesReport } from "@/lib/accounting";
import { ExportButtons } from "@/components/ExportButtons";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { canViewFinancials, checkCapability } from "@/lib/store/db";
import { toDateInputValue } from "@/lib/date-range";

export default function ItemSalesPurchaseReportPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db } = useDb();
  const showPurchase = session ? canViewFinancials(session.role) : false;
  const [mode, setMode] = useState<"sales" | "purchase">("sales");
  const today = toDateInputValue();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

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
        {effectiveMode === "sales"
          ? t("accounts.salesByItem")
          : t("accounts.purchaseByItem")}
      </h1>
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
        <Link
          href="/admin/accounts/reports/sales-analysis"
          className="tt-btn tt-btn-outline"
        >
          Sales analysis
        </Link>
      </div>
      <div className="tt-panel mt-4 overflow-x-auto">
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
          <p className="p-4 text-sm text-[var(--ink-muted)]">
            {t("common.empty")}
          </p>
        ) : null}
      </div>
    </AccountsShell>
  );
}
