"use client";

import { FormEvent, useState } from "react";
import { useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminShell } from "@/components/AdminShell";
import { useDb, useSession } from "@/lib/hooks";
import {
  applyTallyStockSync,
  hasCapability,
  markTallyError,
  upsertProduct,
} from "@/lib/store/db";

/**
 * Admin UI for mapping website products to TallyPrime stock items
 * and applying a stock sync payload (from the local tally-bridge).
 */
export default function AdminTallyPage() {
  const t = useTranslations();
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [payload, setPayload] = useState(
    JSON.stringify(
      [
        {
          productId: "prod_tarpaulin_hdpe",
          variationId: "var_trp_12x18",
          tallyItemId: "TRP-HDPE-120-12x18",
          stock: 180,
        },
        {
          productId: "prod_shade_net_50",
          variationId: "var_sn_3m",
          tallyItemId: "SN-50-3M",
          stock: 420,
        },
      ],
      null,
      2
    )
  );
  const [msg, setMsg] = useState("");

  const onSync = (e: FormEvent) => {
    e.preventDefault();
    try {
      const parsed = JSON.parse(payload) as {
        productId: string;
        variationId?: string;
        stock: number;
        tallyItemId: string;
      }[];
      applyTallyStockSync(parsed);
      setMsg(`Synced ${parsed.length} item(s)`);
      refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Invalid JSON";
      markTallyError(message);
      setMsg(message);
      refresh();
    }
  };

  if (!session || !hasCapability(session.role, "manage_products")) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  if (!db) {
    return (
      <AdminShell>
        <p>{t("common.loading")}</p>
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <AdminPageHeader title={t("admin.tally")} hint={t("admin.tallyHint")} />

      <div className="mt-6 rounded-2xl bg-[var(--brand-deep)] p-5 text-white">
        <p className="text-sm text-[#b7c9bc]">{t("admin.tallySyncStatus")}</p>
        <p className="mt-1 text-xl font-semibold capitalize">
          {db.settings.tallySyncStatus}
        </p>
        <p className="mt-2 text-sm text-[#c5d4ca]">{db.settings.tallySyncMessage}</p>
        {db.settings.tallyLastSyncAt ? (
        <p className="mt-2 text-xs text-[#9fb0a5]">
          {t("admin.lastSync")}: {new Date(db.settings.tallyLastSyncAt).toLocaleString()}
        </p>
        ) : null}
      </div>

      <div className="mt-8 rounded-2xl border border-[var(--line)] bg-white tt-acct-table-wrap">
        <table className="tt-table min-w-[800px]">
          <thead>
            <tr>
              <th>Product</th>
              <th>Variation</th>
              <th>Website stock</th>
              <th>Tally item ID</th>
            </tr>
          </thead>
          <tbody>
            {db.products.flatMap((p) =>
              (p.variations.length ? p.variations : [null]).map((v) => (
                <tr key={`${p.id}-${v?.id ?? "base"}`}>
                  <td>
                    {p.code} — {p.name.en}
                  </td>
                  <td>{v?.label.en ?? "—"}</td>
                  <td>{v?.stock ?? p.stock}</td>
                  <td>
                    <input
                      className="tt-input"
                      defaultValue={v?.tallyItemId ?? p.tallyItemId ?? ""}
                      placeholder="Tally stock item name/code"
                      onBlur={(e) => {
                        const tallyItemId = e.target.value.trim();
                        if (v) {
                          upsertProduct({
                            ...p,
                            variations: p.variations.map((x) =>
                              x.id === v.id ? { ...x, tallyItemId } : x
                            ),
                            tallyItemId: p.tallyItemId || tallyItemId,
                          });
                        } else {
                          upsertProduct({ ...p, tallyItemId });
                        }
                        refresh();
                      }}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <form onSubmit={onSync} className="mt-8 space-y-3">
        <h2 className="font-semibold">Apply sync payload</h2>
        <textarea
          className="tt-textarea min-h-[220px] font-mono text-xs"
          value={payload}
          onChange={(e) => setPayload(e.target.value)}
        />
        <div className="tt-sticky-bar">
          <button type="submit" className="tt-btn tt-btn-dark">
            {t("admin.syncNow")}
          </button>
        </div>
        {msg ? <p className="text-sm text-[var(--brand)]">{msg}</p> : null}
      </form>

      <ol className="mt-8 list-decimal space-y-2 pl-5 text-sm text-[var(--ink-muted)]">
        <li>Enable TallyPrime HTTP/ODBC on the office PC (port 9000 by default).</li>
        <li>
          Open <code>tally-bridge</code>, copy <code>.env.example</code> to{" "}
          <code>.env</code>, set company name and API URL.
        </li>
        <li>
          Run <code>npm install</code> then <code>npm start</code> in{" "}
          <code>tally-bridge</code>.
        </li>
        <li>Bridge posts stock into <code>/api/tally/sync</code> (or paste JSON here).</li>
      </ol>
    </AdminShell>
  );
}
