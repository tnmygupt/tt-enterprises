"use client";

import { useMemo, useState } from "react";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { NumberField } from "@/components/NumberField";
import { stockAlerts } from "@/lib/accounting";
import { useDb, useSession } from "@/lib/hooks";
import {
  checkCapability,
  createDraftPosFromStockAlerts,
} from "@/lib/store/db";

export default function StockAlertsPage() {
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [slowDays, setSlowDays] = useState(45);
  const [deadDays, setDeadDays] = useState(90);
  const [kind, setKind] = useState<"" | "reorder" | "dead" | "slow">("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const all = useMemo(() => {
    if (!db) return [];
    return stockAlerts(db.products, db.stockMovements ?? [], {
      slowDays,
      deadDays,
    });
  }, [db, slowDays, deadDays]);

  const rows = useMemo(
    () => (kind ? all.filter((r) => r.kind === kind) : all),
    [all, kind]
  );

  const counts = useMemo(() => {
    return {
      reorder: all.filter((r) => r.kind === "reorder").length,
      dead: all.filter((r) => r.kind === "dead").length,
      slow: all.filter((r) => r.kind === "slow").length,
    };
  }, [all]);

  const rowKey = (r: (typeof rows)[number]) =>
    `${r.productId}|${r.variationId ?? ""}|${r.colorId ?? ""}`;

  const exportOptions = useMemo(
    () => ({
      title: "Stock alerts",
      filename: `stock-alerts.pdf`,
      columns: [
        "Kind",
        "Product",
        "Stock",
        "Min",
        "Suggested",
        "Supplier",
        "Last out",
        "Days idle",
      ],
      rows: rows.map((r) => {
        const sup = r.preferredSupplierId
          ? db?.parties.find((p) => p.id === r.preferredSupplierId)?.name
          : "";
        return [
          r.kind,
          r.label,
          r.stock,
          r.minStockLevel || "—",
          r.suggestedQty || "—",
          sup || "—",
          r.lastOutDate || "never",
          r.daysSinceOut ?? "—",
        ];
      }),
    }),
    [db, rows]
  );

  if (!session || !checkCapability(session, db?.users, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const selectedKeys = Object.keys(selected).filter((k) => selected[k]);
  const onCreatePo = (keys?: string[]) => {
    if (!session) return;
    setBusy(true);
    setMsg("");
    try {
      const created = createDraftPosFromStockAlerts(session.id, {
        rowKeys: keys,
      });
      if (!created.length) {
        setMsg(
          "No draft PO created — set preferred supplier on products, and pick lines with suggested qty."
        );
      } else {
        setMsg(
          `Created ${created.length} draft PO: ${created.map((p) => p.number).join(", ")}`
        );
        setSelected({});
        refresh();
      }
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccountsShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)]">
            Stock alerts
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Reorder at product / size / color mins. Suggested qty fills back to
            min (or reorder target). Set preferred supplier to draft POs.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/accounts/purchases"
            className="tt-btn tt-btn-outline"
          >
            Purchase orders
          </Link>
          <Link
            href="/admin/accounts/inventory"
            className="tt-btn tt-btn-outline"
          >
            Stock on hand
          </Link>
          <Link href="/admin/products" className="tt-btn tt-btn-outline">
            Set min levels
          </Link>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {(
          [
            { key: "reorder", label: "Reorder", value: counts.reorder, danger: true },
            {
              key: "dead",
              label: `Dead (${deadDays}d+)`,
              value: counts.dead,
              danger: false,
            },
            {
              key: "slow",
              label: `Slow (${slowDays}d+)`,
              value: counts.slow,
              danger: false,
            },
          ] as const
        ).map((card) => (
          <button
            key={card.key}
            type="button"
            aria-pressed={kind === card.key}
            onClick={() => setKind(kind === card.key ? "" : card.key)}
            className={`tt-panel p-4 text-left ${
              kind === card.key
                ? "border-[var(--brand)] ring-1 ring-[var(--brand)]"
                : ""
            }`}
          >
            <p className="text-xs text-[var(--ink-muted)]">{card.label}</p>
            <p
              className={`tt-display text-2xl ${
                card.danger ? "text-[var(--danger)]" : "text-[var(--brand-deep)]"
              }`}
            >
              {card.value}
            </p>
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <label className="flex items-center gap-2 text-sm">
          Slow after
          <NumberField
            className="tt-input w-20"
            min={7}
            integer
            emptyAs={null}
            value={slowDays}
            onValueChange={(v) => {
              if (v === "") return;
              setSlowDays(v);
            }}
            onBlur={() => setSlowDays(Math.max(7, slowDays || 45))}
          />
          days
        </label>
        <label className="flex items-center gap-2 text-sm">
          Dead after
          <NumberField
            className="tt-input w-20"
            min={30}
            integer
            emptyAs={null}
            value={deadDays}
            onValueChange={(v) => {
              if (v === "") return;
              setDeadDays(v);
            }}
            onBlur={() => setDeadDays(Math.max(30, deadDays || 90))}
          />
          days
        </label>
        <ExportButtons options={exportOptions} disabled={!rows.length} />
        <button
          type="button"
          className="tt-btn tt-btn-dark"
          disabled={busy || !counts.reorder}
          onClick={() =>
            onCreatePo(selectedKeys.length ? selectedKeys : undefined)
          }
        >
          {busy
            ? "…"
            : selectedKeys.length
              ? `Draft PO (${selectedKeys.length})`
              : "Draft PO (all reorder)"}
        </button>
      </div>
      {msg ? (
        <p className="mt-2 text-sm text-[var(--brand-deep)]">{msg}</p>
      ) : null}

      <div className="tt-panel mt-5 overflow-x-auto">
        <table className="tt-table min-w-[980px]">
          <thead>
            <tr>
              <th />
              <th>Kind</th>
              <th>Product</th>
              <th>Stock</th>
              <th>Min</th>
              <th>Suggested</th>
              <th>Supplier</th>
              <th>Last out</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const key = rowKey(r);
              const sup = r.preferredSupplierId
                ? db?.parties.find((p) => p.id === r.preferredSupplierId)
                : undefined;
              return (
                <tr key={`${r.kind}-${key}`}>
                  <td>
                    {r.kind === "reorder" ? (
                      <input
                        type="checkbox"
                        checked={!!selected[key]}
                        onChange={(e) =>
                          setSelected((cur) => ({
                            ...cur,
                            [key]: e.target.checked,
                          }))
                        }
                        aria-label={`Select ${r.label}`}
                      />
                    ) : null}
                  </td>
                  <td className="capitalize">{r.kind}</td>
                  <td className="max-w-[16rem] truncate">{r.label}</td>
                  <td>
                    {r.stock}
                    {r.stockSecondary ? (
                      <span className="block text-xs text-[var(--ink-muted)]">
                        {r.stockSecondary} kg/pcs
                      </span>
                    ) : null}
                  </td>
                  <td>{r.minStockLevel || "—"}</td>
                  <td className="font-semibold tabular-nums">
                    {r.kind === "reorder" ? r.suggestedQty : "—"}
                  </td>
                  <td className="text-sm">
                    {sup?.name || (
                      <span className="text-[var(--ink-muted)]">
                        set preferred
                      </span>
                    )}
                  </td>
                  <td>
                    {r.lastOutDate || "never"}
                    {r.daysSinceOut != null ? (
                      <span className="block text-xs text-[var(--ink-muted)]">
                        {r.daysSinceOut}d
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-x-3">
                      {r.kind === "reorder" ? (
                        <>
                          <button
                            type="button"
                            className="inline-flex min-h-11 items-center text-sm font-semibold underline"
                            disabled={busy || !r.preferredSupplierId}
                            onClick={() => onCreatePo([key])}
                          >
                            Draft PO
                          </button>
                          <Link
                            href="/admin/accounts/goods-received"
                            className="inline-flex min-h-11 items-center text-sm underline"
                          >
                            Receive
                          </Link>
                        </>
                      ) : null}
                      <Link
                        href={`/admin/accounts/reports/stock-movements?product=${r.productId}`}
                        className="inline-flex min-h-11 items-center text-sm underline"
                      >
                        History
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length ? (
          <p className="p-4 text-sm text-[var(--ink-muted)]">
            {kind
              ? `No ${kind} alerts right now.`
              : "No alerts. Set min stock on products / sizes / colors."}
          </p>
        ) : null}
      </div>
    </AccountsShell>
  );
}
