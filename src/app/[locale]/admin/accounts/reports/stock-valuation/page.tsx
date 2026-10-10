"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { stockValuation } from "@/lib/accounting";
import { ExportButtons } from "@/components/ExportButtons";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { canViewFinancials } from "@/lib/store/db";

export default function StockValuationPage() {
  const t = useTranslations();
  const { session } = useSession();
  const { db } = useDb();

  const report = useMemo(() => {
    if (!db) return null;
    const valuation = stockValuation(db.stockBatches ?? []);
    const totalValue = valuation.reduce((sum, row) => sum + row.value, 0);
    return { valuation, totalValue };
  }, [db]);

  const exportOptions = useMemo(() => {
    if (!report) {
      return {
        title: "Stock Valuation",
        filename: `stock-valuation-${new Date().toISOString().slice(0, 10)}.pdf`,
        columns: ["Item", "Qty", "Avg Cost", "Value", "Status"],
        rows: [] as string[][],
      };
    }
    return {
      title: "Stock Valuation",
      subtitle: `As of ${new Date().toISOString().slice(0, 10)} · Total: ${formatInr(report.totalValue, "en")}`,
      filename: `stock-valuation-${new Date().toISOString().slice(0, 10)}.pdf`,
      columns: ["Item", "Qty", "Avg Cost", "Value", "Status"],
      rows: [
        ...report.valuation.map((row) => {
          const product = db?.products.find((p) => p.id === row.productId);
          const variation = product?.variations.find(
            (v) => v.id === row.variationId
          );
          const itemName = variation
            ? `${product?.name.en} ${variation.label.en}`
            : product?.name.en || row.productId;
          return [
            itemName,
            `${row.qty.toFixed(2)} ${product?.unit || ""}`,
            formatInr(row.avgRate, "en"),
            formatInr(row.value, "en"),
            row.hasProvisional ? "Provisional" : "OK",
          ];
        }),
        ["Total", "", "", formatInr(report.totalValue, "en"), ""],
      ],
    };
  }, [db, report]);

  if (!session || !canViewFinancials(session.role)) {
    return (
      <AccountsShell>
        <AdminAccessDenied title={t("owner.ownerOnly")} />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <AccountsPageHeader
        title={t("accounts.stockValuation")}
        hint={t("accounts.stockValuationHint")}
      />

      <div className="mt-4 flex items-center gap-3">
        <ExportButtons options={exportOptions} disabled={!report} />
      </div>

      <div className="tt-panel mt-6 tt-acct-table-wrap">
        <table className="tt-table">
          <thead>
            <tr>
              <th>Item</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Avg Cost</th>
              <th className="text-right">Value</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(report?.valuation ?? []).map((row) => {
              const product = db?.products.find((p) => p.id === row.productId);
              const variation = product?.variations.find(
                (v) => v.id === row.variationId
              );
              const itemName = variation
                ? `${product?.name.en} ${variation.label.en}`
                : product?.name.en || row.productId;
              return (
                <tr key={`${row.productId}|${row.variationId}|${row.colorId}`}>
                  <td>{itemName}</td>
                  <td className="text-right">
                    {row.qty.toFixed(2)} {product?.unit}
                  </td>
                  <td className="text-right">{formatInr(row.avgRate, "en")}</td>
                  <td className="text-right">{formatInr(row.value, "en")}</td>
                  <td>
                    {row.hasProvisional && (
                      <span className="rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                        Provisional
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td className="font-semibold">Total</td>
              <td></td>
              <td></td>
              <td className="text-right font-semibold">
                {formatInr(report?.totalValue ?? 0, "en")}
              </td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </AccountsShell>
  );
}
