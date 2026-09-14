"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { NumberField } from "@/components/NumberField";
import { stockAlertsFromDb } from "@/lib/accounting";
import { countReorderBlockers } from "@/lib/reorder-po";
import { useDb, useSession } from "@/lib/hooks";
import {
  checkAnyCapability,
  checkCapability,
  createDraftPosFromStockAlerts,
} from "@/lib/store/db";

export default function StockAlertsPage() {
  const t = useTranslations();
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [slowDays, setSlowDays] = useState(45);
  const [deadDays, setDeadDays] = useState(90);
  const [kind, setKind] = useState<"" | "reorder" | "dead" | "slow">("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const canBooks =
    !!session && checkCapability(session, db, "manage_accounts");

  const all = useMemo(() => {
    if (!db) return [];
    return stockAlertsFromDb(db, {
      slowDays,
      deadDays,
    });
  }, [db, slowDays, deadDays]);

  const rows = useMemo(
    () => (kind ? all.filter((r) => r.kind === kind) : all),
    [all, kind]
  );

  const counts = useMemo(() => {
    const blockers = countReorderBlockers(all);
    return {
      reorder: all.filter((r) => r.kind === "reorder").length,
      dead: all.filter((r) => r.kind === "dead").length,
      slow: all.filter((r) => r.kind === "slow").length,
      missingSupplier: blockers.missingSupplier,
      contractExhausted: blockers.contractExhausted,
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
        "Avg/day",
        "Incoming",
        "Committed",
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
          r.kind === "reorder" ? Number((r.avgDailyOut ?? 0).toFixed(2)) : "—",
          r.kind === "reorder" ? r.incomingQty ?? 0 : "—",
          r.kind === "reorder" ? r.committedQty ?? 0 : "—",
          r.suggestedQty || "—",
          sup || "—",
          r.lastOutDate || "never",
          r.daysSinceOut ?? "—",
        ];
      }),
    }),
    [db, rows]
  );

  if (!session || !checkAnyCapability(session, db, ["manage_accounts", "manage_reorder"])) {
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
          counts.missingSupplier
            ? t("accounts.noDraftPoMissingSupplier")
            : "No draft PO created — set preferred supplier on products, and pick lines with suggested qty."
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
      <AccountsPageHeader
        title={t("accounts.stockAlerts")}
        hint={t("accounts.stockAlertsHint")}
        actions={
          <>
            <Link
              href="/admin/accounts/purchases?tab=orders"
              className="tt-btn tt-btn-outline"
            >
              {t("accounts.purchaseOrder")}
            </Link>
            <Link
              href="/admin/accounts/inventory"
              className="tt-btn tt-btn-outline"
            >
              {t("accounts.stockOnHand")}
            </Link>
            <Link href="/admin/products" className="tt-btn tt-btn-outline">
              {t("accounts.stock")}
            </Link>
          </>
        }
      />

      {counts.missingSupplier ? (
        <p className="mt-4 rounded-xl border border-[var(--danger)] bg-[var(--danger-soft,transparent)] px-4 py-3 text-sm font-semibold text-[var(--danger)]">
          {t("accounts.missingSupplierBlocker", { count: counts.missingSupplier })}
        </p>
      ) : null}
      {counts.contractExhausted ? (
        <p className="mt-2 rounded-xl border border-[var(--line)] px-4 py-3 text-sm">
          {t("accounts.contractExhaustedBlocker", { count: counts.contractExhausted })}
        </p>
      ) : null}
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
        <table className="tt-table min-w-[1180px]">
          <thead>
            <tr>
              <th />
              <th>Kind</th>
              <th>Product</th>
              <th>Stock</th>
              <th>Min</th>
              <th>Avg/day</th>
              <th>Incoming</th>
              <th>Committed</th>
              <th>Suggested</th>
              <th>Blocker</th>
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
                  <td className="tabular-nums text-sm">
                    {r.kind === "reorder"
                      ? (r.avgDailyOut ?? 0).toFixed(2)
                      : "—"}
                  </td>
                  <td className="tabular-nums text-sm">
                    {r.kind === "reorder" ? r.incomingQty ?? 0 : "—"}
                  </td>
                  <td className="tabular-nums text-sm">
                    {r.kind === "reorder" ? r.committedQty ?? 0 : "—"}
                  </td>
                  <td className="font-semibold tabular-nums">
                    {r.kind === "reorder" ? r.suggestedQty : "—"}
                    {r.kind === "reorder" && r.coverMode ? (
                      <span className="block text-xs font-normal text-[var(--ink-muted)]">
                        {r.coverMode}
                        {r.contractCapped ? " · capped" : ""}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-sm text-[var(--danger)]">
                    {r.blockers?.includes("missing_supplier")
                      ? t("accounts.setPreferredSupplier")
                      : r.blockers?.includes("contract_exhausted")
                        ? t("accounts.contractExhausted")
                        : "—"}
                  </td>
                  <td className="text-sm">
                    {sup?.name || (
                      <span className="text-[var(--ink-muted)]">
                        {t("accounts.setPreferredSupplier")}
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
                          {r.preferredSupplierId ? (
                          <button
                            type="button"
                            className="inline-flex min-h-11 items-center text-sm font-semibold underline"
                            disabled={busy}
                            onClick={() => onCreatePo([key])}
                          >
                            Draft PO
                          </button>
                          ) : (
                          <Link
                            href="/admin/products"
                            className="inline-flex min-h-11 items-center text-sm font-semibold underline"
                          >
                            {t("accounts.setPreferredSupplier")}
                          </Link>
                          )}
                          {canBooks ? (
                          <Link
                            href="/admin/accounts/goods-received"
                            className="inline-flex min-h-11 items-center text-sm underline"
                          >
                            Receive
                          </Link>
                          ) : null}
                        </>
                      ) : null}
                      {canBooks ? (
                      <Link
                        href={`/admin/accounts/reports/stock-movements?product=${r.productId}`}
                        className="inline-flex min-h-11 items-center text-sm underline"
                      >
                        History
                      </Link>
                      ) : null}
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
              : "No alerts. Set min stock on products, or wait for sales velocity."}
          </p>
        ) : null}
      </div>
    </AccountsShell>
  );
}
