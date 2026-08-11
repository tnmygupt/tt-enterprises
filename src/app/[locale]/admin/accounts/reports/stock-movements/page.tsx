"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { filterStockMovements } from "@/lib/accounting";
import { toDateInputValue } from "@/lib/date-range";
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
  const { session } = useSession();
  const { db } = useDb();
  const search = useSearchParams();
  const today = toDateInputValue();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState(today);
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
            Stock movements
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Full register — filter by date, product, type.
          </p>
        </div>
        <Link href="/admin/accounts/inventory" className="tt-btn tt-btn-outline">
          Stock on hand
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
          className="tt-select min-w-[180px]"
          value={productId}
          onChange={(e) => setProductId(e.target.value)}
        >
          <option value="">All products</option>
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
          <option value="">All types</option>
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
