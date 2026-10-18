"use client";

import { FormEvent, useState } from "react";
import { useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { AdminShell } from "@/components/AdminShell";
import { useDb, useSession } from "@/lib/hooks";
import { parseTallyStockExport, parseTallyStockRows } from "@/lib/tally-sync";
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
  const [payload, setPayload] = useState("");
  const [msg, setMsg] = useState("");

  const importItems = (items: { name?: string; stock: number }[]) => {
    if (!items.length) {
      setMsg(t("admin.tallyImportEmpty"));
      return;
    }
    try {
      const result = applyTallyStockSync(items);
      setMsg(
        t("admin.tallyImportDone", {
          applied: result.applied,
          created: result.created,
        })
      );
      refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      markTallyError(message);
      setMsg(message);
      refresh();
    }
  };

  const onSync = (e: FormEvent) => {
    e.preventDefault();
    try {
      importItems(parseTallyStockExport(payload));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      markTallyError(message);
      setMsg(message);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const name = file.name.toLowerCase();
      if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        const buffer = await file.arrayBuffer();
        await workbook.xlsx.load(buffer);
        const sheet = workbook.worksheets[0];
        if (!sheet) {
          setMsg(t("admin.tallyImportEmpty"));
          return;
        }
        const rows: string[][] = [];
        sheet.eachRow((row) => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell, col) => {
            const value = cell.value;
            if (value && typeof value === "object" && "text" in value) {
              cells[col - 1] = String((value as { text?: string }).text || "");
            } else if (value && typeof value === "object" && "result" in value) {
              cells[col - 1] = String((value as { result?: unknown }).result ?? "");
            } else {
              cells[col - 1] = value == null ? "" : String(value);
            }
          });
          rows.push(cells);
        });
        importItems(parseTallyStockRows(rows));
        return;
      }
      importItems(parseTallyStockExport(await file.text()));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Import failed";
      markTallyError(message);
      setMsg(message);
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

      <div className="mt-8 rounded-2xl border border-[var(--line)] bg-white p-4">
        <h2 className="font-semibold">Sales waiting for Tally</h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          Confirmed and billed orders queue here. The office bridge pulls them into Tally.
        </p>
        <ul className="mt-3 space-y-1 text-sm">
          {(db.tallyPosts ?? [])
            .filter((p) => p.kind === "sale" && p.status !== "posted")
            .map((p) => (
              <li key={p.id}>
                {p.orderNumber} · {p.partyName} · ₹{p.amount} · {p.status}
              </li>
            ))}
          {(db.tallyPosts ?? []).every(
            (p) => p.kind !== "sale" || p.status === "posted"
          ) ? (
            <li className="text-[var(--ink-muted)]">None waiting.</li>
          ) : null}
        </ul>
      </div>

      <form onSubmit={onSync} className="mt-8 space-y-3">
        <h2 className="font-semibold">{t("admin.tallyImport")}</h2>
        <p className="text-sm text-[var(--ink-muted)]">{t("admin.tallyImportHint")}</p>
        <input
          type="file"
          accept=".csv,.txt,.tsv,.xlsx,.xls"
          className="block w-full text-sm"
          onChange={(e) => {
            void onFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <textarea
          className="tt-textarea min-h-[160px] font-mono text-xs"
          value={payload}
          placeholder={t("admin.tallyImportPaste")}
          onChange={(e) => setPayload(e.target.value)}
        />
        <div className="tt-sticky-bar">
          <button type="submit" className="tt-btn tt-btn-dark">
            {t("admin.tallyImport")}
          </button>
        </div>
        {msg ? <p className="text-sm text-[var(--brand)]">{msg}</p> : null}
      </form>

      <ol className="mt-8 list-decimal space-y-2 pl-5 text-sm text-[var(--ink-muted)]">
        <li>Enable TallyPrime HTTP on the office PC (port 9000 by default).</li>
        <li>
          On that PC, copy <code>tally-bridge/.env.example</code> to <code>.env</code>.
          Set the company name, this site&apos;s <code>/api/tally/sync</code> URL, and the same{" "}
          <code>TALLY_SYNC_KEY</code> as the website.
        </li>
        <li>
          Run <code>npm install</code> then <code>npm start</code> in <code>tally-bridge</code>.
        </li>
        <li>
          Each cycle the bridge sends stock (matched by Tally item, SKU, or exact name) and
          posts queued sales, then acknowledges them.
        </li>
      </ol>
    </AdminShell>
  );
}
