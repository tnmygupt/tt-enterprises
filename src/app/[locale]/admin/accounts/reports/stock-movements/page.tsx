"use client";

import { Suspense, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { ExportButtons } from "@/components/ExportButtons";
import { filterStockMovements } from "@/lib/accounting";
import { useDb, useSession } from "@/lib/hooks";
import { checkCapability } from "@/lib/store/db";
import type { StockMovementType } from "@/lib/types";

const TYPES: StockMovementType[] = [
  "sale",
  "purchase",
  "grn",
  "adjustment",
  "sale_return",
  "purchase_return",
  "estimate_reserve",
  "estimate_release",
  "void_sale",
  "void_purchase",
];

function StockMovementsInner() {
  const t = useTranslations();
  const { session } = useSession();
  const { db } = useDb();
  const search = useSearchParams();
  const [range, setRange] = useAdminDateRange("mtd");
  const from = range.from;
  const to = range.to;
  // Stock alerts and the on-hand table deep-link a single product in here
  const [productId, setProductId] = useState(search.get("product") || "");
  const [type, setType] = useState("");
  const [direction, setDirection] = useState<"" | "in" | "out">("");
  const [q, setQ] = useState("");

  const products = useMemo(
    () =>
      (db?.products ?? [])
        .filter((p) => p.active)
        .sort((a, b) => a.name.en.localeCompare(b.name.en)),
    [db]
  );

  const rows = useMemo(() => {
    if (!db) return [];
    return filterStockMovements(db.stockMovements ?? [], {
      from: from || undefined,
      to: to || undefined,
      productId: productId || undefined,
      type: type || undefined,
      direction,
      q,
    }).slice(0, 500);
  }, [db, from, to, productId, type, direction, q]);

  const exportOptions = useMemo(
    () => ({
      title: "Stock movements",
      subtitle: `${from || "…"} → ${to}`,
      filename: `stock-movements-${to}.pdf`,
      columns: ["Date", "Type", "Product", "Dir", "Bundles", "Kg/Pcs", "Note"],
      rows: rows.map((m) => {
        const p = db?.products.find((x) => x.id === m.productId);
        return [
          m.date,
          m.type,
          p?.name.en || m.productId,
          m.direction,
          m.qty,
          m.secondaryQty ?? "",
          m.note || "",
        ];
      }),
    }),
    [db, from, rows, to]
  );

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
        title={t("accounts.stockMovements")}
        hint={t("accounts.stockMovementsHint")}
        actions={
          <Link href="/admin/accounts/inventory" className="tt-btn tt-btn-outline">
            {t("accounts.stockOnHand")}
          </Link>
        }
      />

      <div className="mt-4 flex flex-wrap gap-3">
        <DateRangeBar value={range} onChange={setRange} />
        <select
          className="tt-select min-w-[180px]"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
        >
          <option value="">{t("accounts.allProducts")}</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name.en}
            </option>
          ))}
        </select>
        <select
          className="tt-select"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">{t("accounts.allTypes")}</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          className="tt-select"
          value={direction}
          onChange={(e) =>
            setDirection(e.target.value as "" | "in" | "out")
          }
        >
          <option value="">In + out</option>
          <option value="in">In</option>
          <option value="out">Out</option>
        </select>
        <input
          className="tt-input min-w-[140px]"
          placeholder="Search note…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <ExportButtons options={exportOptions} disabled={!rows.length} />
      </div>

      <div className="tt-panel mt-5 overflow-x-auto">
        <table className="tt-table min-w-[720px]">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Product</th>
              <th>Dir</th>
              <th>Bundles</th>
              <th>Kg / Pcs</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => {
              const p = db?.products.find((x) => x.id === m.productId);
              return (
                <tr key={m.id}>
                  <td>{m.date}</td>
                  <td className="font-mono text-xs">{m.type}</td>
                  <td>{p?.name.en || m.productId}</td>
                  <td>{m.direction}</td>
                  <td>{m.qty}</td>
                  <td>{m.secondaryQty ?? "—"}</td>
                  <td className="text-sm text-[var(--ink-muted)]">
                    {m.note || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length ? (
          <p className="p-4 text-sm text-[var(--ink-muted)]">
            No movements match these filters.
          </p>
        ) : rows.length >= 500 ? (
          <p className="p-3 text-xs text-[var(--ink-muted)]">
            Showing first 500 — narrow the date range.
          </p>
        ) : null}
      </div>
    </AccountsShell>
  );
}

export default function StockMovementsPage() {
  return (
    <Suspense fallback={<p className="p-6 text-sm">Loading…</p>}>
      <StockMovementsInner />
    </Suspense>
  );
}
