"use client";

import { Suspense, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { NumberField } from "@/components/NumberField";
import { deriveSecondaryQty, inventoryRows } from "@/lib/inventory";
import { useDb, useSession } from "@/lib/hooks";
import { unitLabel } from "@/lib/pricing";
import { adjustStockBatch, checkAnyCapability, checkCapability } from "@/lib/store/db";

type InventoryRow = ReturnType<typeof inventoryRows>[number];

type PendingAdj = {
  /** Signed bundles: +in / −out */
  bundles: string;
  /** Optional signed kg/pcs override; blank = auto from bundles */
  secondary: string;
};

function rowKey(r: Pick<InventoryRow, "productId" | "variationId" | "colorId">) {
  return `${r.productId}|${r.variationId ?? ""}|${r.colorId ?? ""}`;
}

export default function AccountsInventoryPage() {
  return (
    <Suspense
      fallback={
        <AccountsShell>
          <p>Loading…</p>
        </AccountsShell>
      }
    >
      <InventoryFromParams />
    </Suspense>
  );
}

function InventoryFromParams() {
  const search = useSearchParams();
  const initialQ = search.get("q") || "";
  return <InventoryInner key={initialQ} initialQ={initialQ} />;
}

function InventoryInner({ initialQ }: { initialQ: string }) {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [q, setQ] = useState(initialQ);
  const [lowOnly, setLowOnly] = useState(false);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<Record<string, PendingAdj>>({});
  const canBooks =
    !!session && checkCapability(session, db, "manage_accounts");
  const canAdjust = canBooks;

  const allRows = useMemo(() => (db ? inventoryRows(db) : []), [db]);

  /** A row counts as low when it is empty, or its product sits at/below min. */
  const isLow = useMemo(() => {
    const byProduct = new Map(
      (db?.products ?? []).map((p) => [p.id, p] as const)
    );
    return (row: InventoryRow) => {
      if (row.stock <= 0) return true;
      const product = byProduct.get(row.productId);
      const min = product?.minStockLevel ?? 0;
      return min > 0 && (product?.stock ?? 0) <= min;
    };
  }, [db]);

  const lowCount = useMemo(
    () => allRows.filter((r) => isLow(r)).length,
    [allRows, isLow]
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allRows.filter((r) => {
      if (lowOnly && !isLow(r)) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        r.sku.toLowerCase().includes(needle) ||
        r.code.toLowerCase().includes(needle)
      );
    });
  }, [allRows, isLow, lowOnly, q]);

  // Bundles drive the movement; kg alone without bundles is ignored on save.
  const pendingCount = useMemo(() => {
    let n = 0;
    for (const adj of Object.values(pending)) {
      if (Number(adj.bundles)) n++;
    }
    return n;
  }, [pending]);

  const movements = useMemo(
    () => (db?.stockMovements ?? []).slice(0, 40),
    [db]
  );

  const exportOptions = useMemo(
    () => ({
      title: t("accounts.inventory"),
      subtitle: new Date().toLocaleDateString(
        locale === "hi" ? "hi-IN" : "en-IN"
      ),
      filename: `inventory-${new Date().toISOString().slice(0, 10)}.pdf`,
      columns: ["SKU", "Item", "Bundles", "Kg / Pcs", "Unit"],
      rows: rows.map((r) => [
        r.sku,
        r.name,
        r.stock,
        r.stockSecondary,
        unitLabel(r.unit, locale),
      ]),
    }),
    [locale, rows, t]
  );

  if (!session || !checkAnyCapability(session, db, ["manage_accounts", "manage_reorder"])) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const setRowAdj = (
    key: string,
    patch: Partial<PendingAdj>
  ) => {
    setPending((cur) => {
      const prev = cur[key] ?? { bundles: "", secondary: "" };
      const next = { ...prev, ...patch };
      if (!next.bundles && !next.secondary) {
        const rest = { ...cur };
        delete rest[key];
        return rest;
      }
      return { ...cur, [key]: next };
    });
  };

  const previewAfter = (r: InventoryRow) => {
    const adj = pending[rowKey(r)];
    if (!adj) return null;
    const b = Number(adj.bundles) || 0;
    const s =
      adj.secondary === ""
        ? null
        : Number(adj.secondary) || 0;
    if (!b && (s == null || !s)) return null;
    return {
      bundles: r.stock + b,
      secondary:
        s == null
          ? null
          : r.stockSecondary + s,
    };
  };

  const onSaveAll = () => {
    if (!session || !db || pendingCount === 0) return;
    setBusy(true);
    setMsg("");
    try {
      const sharedNote =
        note.trim() ||
        (locale === "hi" ? "मल्टी एडजस्ट" : "Multi adjust");
      const inputs = [];
      for (const r of allRows) {
        const key = rowKey(r);
        const adj = pending[key];
        if (!adj) continue;
        const bRaw = Number(adj.bundles) || 0;
        if (!bRaw) continue;
        const sRaw =
          adj.secondary === "" ? null : Number(adj.secondary) || 0;
        const direction = bRaw >= 0 ? "in" : "out";
        const qty = Math.abs(bRaw);
        const product = db.products.find((p) => p.id === r.productId);
        const secondaryQty =
          sRaw != null && sRaw !== 0
            ? Math.abs(sRaw)
            : product
              ? deriveSecondaryQty(product, qty, r.variationId)
              : 0;

        inputs.push({
          productId: r.productId,
          variationId: r.variationId,
          colorId: r.colorId,
          qty,
          secondaryQty,
          direction: direction as "in" | "out",
          note: sharedNote,
          createdBy: session.id,
        });
      }

      if (!inputs.length) {
        setMsg(locale === "hi" ? "कुछ नहीं बदला" : "Nothing to save");
        setBusy(false);
        return;
      }

      const n = adjustStockBatch(inputs);
      setPending({});
      setNote("");
      setMsg(
        locale === "hi"
          ? `${n} आइटम एडजस्ट हो गए`
          : `${n} items adjusted`
      );
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Adjustment failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AccountsShell>
      <AccountsPageHeader
        title={t("accounts.inventory")}
        hint={t("accounts.inventoryHint")}
      />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <input
          className="tt-input max-w-sm"
          placeholder={t("common.search")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button
          type="button"
          aria-pressed={lowOnly}
          onClick={() => setLowOnly((v) => !v)}
          className={`tt-btn ${lowOnly ? "tt-btn-dark" : "tt-btn-outline"}`}
        >
          {locale === "hi" ? "कम स्टॉक" : "Low / out"} ({lowCount})
        </button>
        <ExportButtons options={exportOptions} />
        {canBooks ? (
          <Link
            href="/admin/accounts/reports/stock-movements"
            className="tt-btn tt-btn-outline"
          >
            {t("accounts.stockMovements")}
          </Link>
        ) : null}
        <Link
          href="/admin/accounts/reports/stock-alerts"
          className="tt-btn tt-btn-outline"
        >
          {t("accounts.stockAlerts")}
        </Link>
      </div>

      <div className="tt-acct-cards mt-4 sm:hidden">
        {rows.map((r) => {
          const key = rowKey(r);
          const adj = pending[key] ?? { bundles: "", secondary: "" };
          const preview = previewAfter(r);
          const dirty = !!(adj.bundles || adj.secondary);
          return (
            <div
              key={key}
              className={`tt-panel tt-acct-card space-y-2 ${
                dirty ? "border-[var(--brand)]" : ""
              }`}
            >
              <p className="font-semibold">{r.name}</p>
              <p className="font-mono text-xs text-[var(--ink-muted)]">
                {r.sku} · {r.code} · {unitLabel(r.unit, locale)}
              </p>
              <p className="text-sm tabular-nums">
                <span className={r.stock <= 0 ? "text-[var(--danger)]" : ""}>
                  {r.stock} {t("common.bundles")}
                </span>
                {preview && Number(adj.bundles) ? (
                  <span className="ml-1 text-xs text-[var(--brand-deep)]">
                    → {preview.bundles}
                  </span>
                ) : null}
                <span className="mx-2 text-[var(--ink-muted)]">·</span>
                <span
                  className={r.stockSecondary <= 0 ? "text-[var(--danger)]" : ""}
                >
                  {r.stockSecondary} {unitLabel(r.unit, locale)}
                </span>
                {preview?.secondary != null ? (
                  <span className="ml-1 text-xs text-[var(--brand-deep)]">
                    → {preview.secondary}
                  </span>
                ) : null}
              </p>
              {canAdjust ? (
                <div className="grid grid-cols-2 gap-2">
                  <label className="tt-hr-field">
                    <span className="tt-hr-label">
                      {locale === "hi" ? "Δ बंडल" : "Δ Bundles"}
                    </span>
                    <NumberField
                      className="tt-input tabular-nums"
                      integer
                      emptyAs={null}
                      placeholder="+ / −"
                      value={adj.bundles}
                      onValueChange={(v) =>
                        setRowAdj(key, {
                          bundles: v === "" ? "" : String(v),
                        })
                      }
                      aria-label={`${r.name} bundle delta`}
                    />
                  </label>
                  <label className="tt-hr-field">
                    <span className="tt-hr-label">
                      {locale === "hi" ? "Δ किग्रा/पीस" : "Δ Kg / Pcs"}
                    </span>
                    <NumberField
                      className="tt-input tabular-nums"
                      emptyAs={null}
                      placeholder={
                        locale === "hi" ? "ऑटो / ±" : "auto / ±"
                      }
                      value={adj.secondary}
                      onValueChange={(v) =>
                        setRowAdj(key, {
                          secondary: v === "" ? "" : String(v),
                        })
                      }
                      aria-label={`${r.name} ${unitLabel(r.unit, locale)} delta`}
                    />
                  </label>
                </div>
              ) : null}
              <Link
                href={`/admin/accounts/reports/stock-movements?product=${r.productId}`}
                className="inline-flex min-h-11 items-center text-sm underline"
              >
                {locale === "hi" ? "इतिहास" : "History"}
              </Link>
            </div>
          );
        })}
        {!rows.length ? (
          <AccountsEmpty message={t("common.empty")} />
        ) : null}
      </div>

      <div className="tt-panel mt-4 hidden overflow-x-auto sm:block">
        <table className="tt-table min-w-[980px]">
          <thead>
            <tr>
              <th>SKU</th>
              <th>Item</th>
              <th>{t("common.bundles")}</th>
              <th>Kg / Pcs</th>
              {canAdjust ? (
                <>
              <th className="min-w-[7rem]">
                {locale === "hi" ? "Δ बंडल" : "Δ Bundles"}
              </th>
              <th className="min-w-[7rem]">
                {locale === "hi" ? "Δ किग्रा/पीस" : "Δ Kg / Pcs"}
              </th>
              <th />
                </>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const key = rowKey(r);
              const adj = pending[key] ?? { bundles: "", secondary: "" };
              const preview = previewAfter(r);
              const dirty = !!(adj.bundles || adj.secondary);
              return (
                <tr
                  key={key}
                  className={dirty ? "bg-[var(--brand-soft,rgba(15,76,74,0.06))]" : ""}
                >
                  <td className="font-mono text-sm">{r.sku}</td>
                  <td>
                    <div className="max-w-[14rem] truncate font-medium">
                      {r.name}
                    </div>
                    <div className="text-xs text-[var(--ink-muted)]">
                      {r.code} · {unitLabel(r.unit, locale)}
                    </div>
                  </td>
                  <td
                    className={`font-semibold tabular-nums ${
                      r.stock <= 0 ? "text-[var(--danger)]" : ""
                    }`}
                  >
                    {r.stock}
                    {preview && Number(adj.bundles) ? (
                      <span className="ml-1 text-xs font-normal text-[var(--brand-deep)]">
                        → {preview.bundles}
                      </span>
                    ) : null}
                  </td>
                  <td
                    className={`font-semibold tabular-nums ${
                      r.stockSecondary <= 0 ? "text-[var(--danger)]" : ""
                    }`}
                  >
                    {r.stockSecondary}
                    {preview?.secondary != null ? (
                      <span className="ml-1 text-xs font-normal text-[var(--brand-deep)]">
                        → {preview.secondary}
                      </span>
                    ) : null}
                  </td>
                  {canAdjust ? (
                    <>
                  <td>
                    <NumberField
                      className="tt-input w-[6.5rem] tabular-nums"
                      integer
                      emptyAs={null}
                      placeholder="+ / −"
                      value={adj.bundles}
                      onValueChange={(v) =>
                        setRowAdj(key, {
                          bundles: v === "" ? "" : String(v),
                        })
                      }
                      aria-label={`${r.name} bundle delta`}
                    />
                  </td>
                  <td>
                    <NumberField
                      className="tt-input w-[6.5rem] tabular-nums"
                      emptyAs={null}
                      placeholder={
                        locale === "hi" ? "ऑटो / ±" : "auto / ±"
                      }
                      value={adj.secondary}
                      onValueChange={(v) =>
                        setRowAdj(key, {
                          secondary: v === "" ? "" : String(v),
                        })
                      }
                      aria-label={`${r.name} ${unitLabel(r.unit, locale)} delta`}
                    />
                  </td>
                  <td>
                    <Link
                      href={`/admin/accounts/reports/stock-movements?product=${r.productId}`}
                      className="inline-flex min-h-11 items-center text-sm underline"
                    >
                      {locale === "hi" ? "इतिहास" : "History"}
                    </Link>
                  </td>
                    </>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length ? (
          <AccountsEmpty message={t("common.empty")} />
        ) : null}
      </div>

      {msg && !pendingCount ? (
        <p className="mt-3 text-sm text-[var(--brand-deep)]">{msg}</p>
      ) : null}

      {/* Sticky multi-save bar — only when something is typed */}
      {canAdjust && pendingCount > 0 ? (
        <div className="sticky bottom-3 z-20 mt-4 rounded-2xl border border-[var(--brand)] bg-white/95 p-3 shadow-[var(--shadow)] backdrop-blur sm:p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[12rem] flex-1">
              <label className="tt-label">
                {locale === "hi"
                  ? `${pendingCount} आइटम — नोट`
                  : `${pendingCount} items — note`}
              </label>
              <input
                className="tt-input"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  locale === "hi"
                    ? "जैसे: स्टॉक जांच / क्षति"
                    : "e.g. stock count / damage"
                }
              />
            </div>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              disabled={busy}
              onClick={() => {
                setPending({});
                setNote("");
                setMsg("");
              }}
            >
              {locale === "hi" ? "साफ़" : "Clear"}
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-dark"
              disabled={busy}
              onClick={onSaveAll}
            >
              {busy
                ? "…"
                : locale === "hi"
                  ? `${pendingCount} सेव करें`
                  : `Save ${pendingCount}`}
            </button>
          </div>
          {msg ? (
            <p className="mt-2 text-sm text-[var(--danger)]">{msg}</p>
          ) : (
            <p className="mt-2 text-xs text-[var(--ink-muted)]">
              {locale === "hi"
                ? "+ जोड़ता है, − घटाता है। खाली किग्रा = बंडल से ऑटो।"
                : "+ adds, − removes. Blank kg uses auto from bundles."}
            </p>
          )}
        </div>
      ) : null}

      <div className="mt-6">
        <p className="text-sm font-semibold sm:hidden">
          {locale === "hi" ? "हाल की मूवमेंट" : "Recent movements"}
        </p>
        <div className="tt-acct-cards mt-3 sm:hidden">
          {movements.map((m) => {
            const p = db?.products.find((x) => x.id === m.productId);
            const v = p?.variations.find((x) => x.id === m.variationId);
            const c = p?.colors.find((x) => x.id === m.colorId);
            return (
              <div key={m.id} className="tt-panel tt-acct-card space-y-1">
                <p className="text-xs text-[var(--ink-muted)]">{m.date}</p>
                <p className="text-sm font-medium">
                  {p?.name[locale] || m.productId}
                  {v ? ` · ${v.size?.[locale] || v.label[locale]}` : ""}
                  {c ? ` · ${c.name[locale]}` : ""}
                </p>
                <p className="text-xs capitalize text-[var(--ink-muted)]">
                  {m.type.replaceAll("_", " ")} ({m.direction})
                </p>
                <p className="text-sm tabular-nums">
                  {m.direction === "in" ? "+" : "−"}
                  {m.qty} {t("common.bundles")}
                  {" · "}
                  {m.direction === "in" ? "+" : "−"}
                  {m.secondaryQty ?? "—"}
                  {m.unit ? ` ${unitLabel(m.unit, locale)}` : ""}
                </p>
                {m.note ? (
                  <p className="text-xs text-[var(--ink-muted)]">{m.note}</p>
                ) : null}
              </div>
            );
          })}
          {!movements.length ? (
            <AccountsEmpty message={t("common.empty")} />
          ) : null}
        </div>
        <div className="tt-panel mt-3 hidden overflow-x-auto sm:block">
        <p className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
          {locale === "hi" ? "हाल की मूवमेंट" : "Recent movements"}
        </p>
        <table className="tt-table min-w-[780px]">
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Item</th>
              <th>{t("common.bundles")}</th>
              <th>Kg / Pcs</th>
              <th>Note</th>
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => {
              const p = db?.products.find((x) => x.id === m.productId);
              const v = p?.variations.find((x) => x.id === m.variationId);
              const c = p?.colors.find((x) => x.id === m.colorId);
              return (
                <tr key={m.id}>
                  <td>{m.date}</td>
                  <td className="capitalize">
                    {m.type.replaceAll("_", " ")} ({m.direction})
                  </td>
                  <td className="text-sm">
                    {p?.name[locale] || m.productId}
                    {v ? ` · ${v.size?.[locale] || v.label[locale]}` : ""}
                    {c ? ` · ${c.name[locale]}` : ""}
                  </td>
                  <td>
                    {m.direction === "in" ? "+" : "−"}
                    {m.qty}
                  </td>
                  <td>
                    {m.direction === "in" ? "+" : "−"}
                    {m.secondaryQty ?? "—"}
                    {m.unit ? ` ${unitLabel(m.unit, locale)}` : ""}
                  </td>
                  <td className="text-xs text-[var(--ink-muted)]">
                    {m.note || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!movements.length ? (
          <AccountsEmpty message={t("common.empty")} />
        ) : null}
        </div>
      </div>
    </AccountsShell>
  );
}
