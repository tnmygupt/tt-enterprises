"use client";

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { FilePick } from "@/components/FilePick";
import { NumberField } from "@/components/NumberField";
import { SearchSelect } from "@/components/SearchSelect";
import {
  catalogRowValue,
  deriveSecondaryQty,
  inventoryRows,
  voucherLineAmount,
} from "@/lib/inventory";
import { applyCatalogToVoucherLine } from "@/lib/voucher-line-catalog";
import { ExportButtons } from "@/components/ExportButtons";
import { fileToDataUrl, useDb, useSession } from "@/lib/hooks";
import {
  formatInr,
  isSqftUnit,
  ratePerPacket,
  ratePerPiece,
  resolveSqftPack,
} from "@/lib/pricing";
import { listOpenPurchaseOrders, poRemainingQty } from "@/lib/purchase-orders";
import {
  canViewFinancials,
  checkAnyCapability,
  checkCapability,
  createVoucher,
  markPurchaseOrderOrdered,
} from "@/lib/store/db";
import type { PurchaseOrder } from "@/lib/types";
import {
  blankLine,
  isEmptyItemLine,
  lastEmptyItemIndex,
  lastItemLineIndex,
  mergeFilledItemLine,
  withTrailingBlankItem,
} from "../vouchers/helpers";
import {
  sendWhatsAppMessage,
  supplierPoWhatsAppText,
  whatsappCountryCode,
  whatsappResultCopy,
} from "@/lib/whatsapp";

export default function PurchasesPage() {
  return (
    <Suspense
      fallback={
        <AccountsShell>
          <p>Loading…</p>
        </AccountsShell>
      }
    >
      <PurchasesInner />
    </Suspense>
  );
}

function PurchasesInner() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const search = useSearchParams();
  const { session } = useSession();
  const { db, refresh } = useDb();
  const showRates = session ? canViewFinancials(session.role) : false;
  const canBooks =
    !!session && checkCapability(session, db, "manage_accounts");
  const canReorder =
    !!session && checkCapability(session, db, "manage_reorder");
  const plantOnly = canReorder && !canBooks;
  const tab =
    plantOnly || search.get("tab") === "orders" ? "orders" : "bills";
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [poBusyId, setPoBusyId] = useState<string | null>(null);
  const [packingFile, setPackingFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    supplierId: "",
    date: new Date().toISOString().slice(0, 10),
    narration: "",
    lines: [blankLine()],
  });
  const [focusLineId, setFocusLineId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const lineCatalogRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const catalog = useMemo(() => (db ? inventoryRows(db) : []), [db]);
  const catalogOptions = useMemo(
    () =>
      catalog.map((c) => ({
        value: catalogRowValue(c),
        label: `${c.sku} · ${c.name}`,
        searchText: `${c.sku} ${c.name}`,
      })),
    [catalog]
  );
  const suppliers =
    db?.parties.filter((p) => p.active && p.type === "supplier") ?? [];
  const purchases = useMemo(() => {
    if (!db) return [];
    return db.vouchers
      .filter((v) => v.type === "purchase" && !v.voided)
      .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  }, [db]);
  const openPos = useMemo(
    () => listOpenPurchaseOrders(db?.purchaseOrders),
    [db]
  );

  const exportOptions = useMemo(
    () => ({
      title: t("accounts.purchases"),
      subtitle: new Date().toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN"),
      filename: `purchases-${new Date().toISOString().slice(0, 10)}.pdf`,
      columns: showRates
        ? ["No.", "Date", "Supplier", "Narration", "Total"]
        : ["No.", "Date", "Supplier", "Narration"],
      rows: purchases.map((v) => {
        const sup = db?.parties.find((p) => p.id === v.partyId)?.name || "—";
        return showRates
          ? [v.number, v.date, sup, v.narration || "—", formatInr(v.total, locale)]
          : [v.number, v.date, sup, v.narration || "—"];
      }),
    }),
    [db, locale, purchases, showRates, t]
  );

  useEffect(() => {
    if (!focusLineId) return;
    lineCatalogRefs.current[focusLineId]?.focus();
  }, [focusLineId, focusNonce]);

  if (!session || !checkAnyCapability(session, db, ["manage_accounts", "manage_reorder"])) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const catalogFillOpts = {
    catalogItems: catalog,
    products: db?.products ?? [],
    type: "purchase" as const,
    partyId: form.supplierId,
    date: form.date,
    contracts: db?.supplierContracts,
  };

  const applyLineCatalog = (index: number, val: string) => {
    const current = form.lines[index];
    if (!current) return;
    const result = applyCatalogToVoucherLine({
      ...catalogFillOpts,
      line: current,
      catalogValue: val,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    const next = [...form.lines];
    next[index] = result.line;
    setForm({
      ...form,
      lines: result.cleared ? next : withTrailingBlankItem(next),
    });
  };

  const quickAddCatalog = (val: string) => {
    if (!val) return;
    const idx = lastEmptyItemIndex(form.lines);
    const source = idx >= 0 ? form.lines[idx]! : blankLine();
    const result = applyCatalogToVoucherLine({
      ...catalogFillOpts,
      line: source,
      catalogValue: val,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError("");
    setForm({
      ...form,
      lines: mergeFilledItemLine(form.lines, result.line),
    });
  };

  const addBlankItemLine = () => {
    const idx = lastEmptyItemIndex(form.lines);
    if (idx >= 0) {
      setFocusLineId(form.lines[idx]!.id);
      setFocusNonce((n) => n + 1);
      return;
    }
    const blank = blankLine();
    setForm({ ...form, lines: [...form.lines, blank] });
    setFocusLineId(blank.id);
    setFocusNonce((n) => n + 1);
  };

  const onLastItemFieldEnter = (index: number) => {
    if (index !== lastItemLineIndex(form.lines)) return;
    const row = form.lines[index];
    if (!row || isEmptyItemLine(row)) return;
    addBlankItemLine();
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setMsg("");
    setSaving(true);
    try {
      if (!showRates) {
        throw new Error("Only the owner can enter purchase rates");
      }
      const lines = form.lines
        .map((l) => {
          const product = l.productId
            ? db?.products.find((p) => p.id === l.productId)
            : undefined;
          return {
            ...l,
            amount: voucherLineAmount(l, product),
          };
        })
        .filter((l) => l.itemLabel.trim() && l.amount > 0);
      if (!form.supplierId) throw new Error("Select supplier");
      if (!lines.length) throw new Error("Add purchase lines");
      let packingSlipDataUrl: string | undefined;
      let packingSlipName: string | undefined;
      if (packingFile) {
        packingSlipDataUrl = await fileToDataUrl(packingFile);
        packingSlipName = packingFile.name;
      }
      const v = createVoucher({
        type: "purchase",
        date: form.date,
        partyId: form.supplierId,
        narration: form.narration || "Purchase",
        lines,
        packingSlipDataUrl,
        packingSlipName,
        createdBy: session.id,
      });
      setMsg(`Purchase saved: ${v.number} (stock updated)`);
      setForm({
        supplierId: "",
        date: new Date().toISOString().slice(0, 10),
        narration: "",
        lines: [blankLine()],
      });
      setPackingFile(null);
      setShowForm(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const onConfirmPo = async (po: PurchaseOrder) => {
    if (!session || poBusyId) return;
    setPoBusyId(po.id);
    setError("");
    setMsg("");
    try {
      markPurchaseOrderOrdered(po.id, session.id);
      refresh();
      const sup = db?.parties.find((p) => p.id === po.supplierId);
      const wa = await sendWhatsAppMessage(
        sup?.phone || "",
        supplierPoWhatsAppText({
          po,
          companyName: db?.settings.companyName || "TT Enterprises",
          locale,
        }),
        whatsappCountryCode(db?.settings),
        { outboxLabel: sup?.name }
      );
      setMsg(
        `${t("accounts.poMarkedOrdered", { number: po.number })} · ${whatsappResultCopy(
          wa,
          {
            sent: t("common.whatsappSent"),
            opened: t("common.whatsappOpened"),
            fail: t("common.whatsappSendFailed"),
            noPhone: t("common.whatsappNoPhone"),
          }
        )}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setPoBusyId(null);
    }
  };

  return (
    <AccountsShell focusMode={showForm}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <AccountsPageHeader
            title={t("accounts.purchases")}
            hint={t("accounts.purchasesHint")}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {canBooks || canReorder ? (
            <>
              {canBooks ? (
              <Link
                href="/admin/accounts/purchases"
                className={`tt-btn ${tab === "bills" ? "tt-btn-dark" : "tt-btn-outline"}`}
              >
                {t("accounts.tabBills")}
              </Link>
              ) : null}
              <Link
                href="/admin/accounts/purchases?tab=orders"
                className={`tt-btn ${tab === "orders" ? "tt-btn-dark" : "tt-btn-outline"}`}
              >
                {t("accounts.tabOrders")}
                {openPos.length ? ` · ${openPos.length}` : ""}
              </Link>
            </>
          ) : null}
          {plantOnly ? null : <ExportButtons options={exportOptions} />}
          {showRates ? (
            <button
              type="button"
              className="tt-btn tt-btn-dark"
              onClick={() => setShowForm((v) => !v)}
            >
              {showForm ? t("common.cancel") : t("accounts.newPurchase")}
            </button>
          ) : null}
        </div>
      </div>

      {plantOnly ? (
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          {t("accounts.plantPoHint")}
        </p>
      ) : canBooks && !showRates ? (
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          Purchase rates are owner-only. Use Goods received to enter stock;
          the owner sets rates on Needs pricing.
        </p>
      ) : null}

      {msg ? <p className="mt-3 text-sm text-[var(--ok)]">{msg}</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      {showForm && showRates ? (
        <form
          onSubmit={onSave}
          className="mt-4 space-y-3 rounded-2xl border border-[var(--line)] bg-white p-5"
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <select
              className="tt-select"
              value={form.supplierId}
              onChange={(e) =>
                setForm({ ...form, supplierId: e.target.value })
              }
              required
            >
              <option value="">{t("accounts.suppliers")}…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              type="date"
              className="tt-input"
              value={form.date}
              onChange={(e) => setForm({ ...form, date: e.target.value })}
              required
            />
            <input
              className="tt-input"
              placeholder={locale === "hi" ? "नोट" : "Narration"}
              value={form.narration}
              onChange={(e) =>
                setForm({ ...form, narration: e.target.value })
              }
            />
          </div>
          <FilePick
            kind="photoOrPdf"
            value={packingFile}
            onChange={(files) => setPackingFile(files[0] ?? null)}
            label="Packing slip (photo or PDF)"
          />

          <div className="sticky top-0 z-20 rounded-xl border border-[var(--brand)]/30 bg-white/95 p-3 shadow-sm backdrop-blur">
            <label className="tt-label" htmlFor="purchase-quick-add">
              {t("accounts.quickAddItem")}
            </label>
            <SearchSelect
              id="purchase-quick-add"
              options={catalogOptions}
              value=""
              onChange={quickAddCatalog}
              placeholder="Search catalog…"
              allowClear={false}
              keepFocusOnPick
            />
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {t("accounts.quickAddItemHint")}
            </p>
          </div>

          {form.lines.map((l, i) => (
            <div key={l.id} className="grid gap-2 md:grid-cols-5">
              <SearchSelect
                className="sm:col-span-2"
                options={catalogOptions}
                value={
                  l.productId
                    ? catalogRowValue({
                        productId: l.productId,
                        variationId: l.variationId,
                        colorId: l.colorId,
                      })
                    : ""
                }
                onChange={(val) => applyLineCatalog(i, val)}
                placeholder="Search catalog…"
                emptyLabel="Catalog…"
                autoFocus={l.id === focusLineId}
                inputRef={(el) => {
                  lineCatalogRefs.current[l.id] = el;
                }}
              />
              <NumberField
                className="tt-input"
                placeholder={t("common.bundles")}
                integer
                emptyAs={null}
                value={l.qty}
                onValueChange={(v) => {
                  const qty = typeof v === "number" ? v : 0;
                  const product = l.productId
                    ? db?.products.find((p) => p.id === l.productId)
                    : undefined;
                  const secondaryQty = product
                    ? deriveSecondaryQty(product, qty, l.variationId)
                    : l.secondaryQty ?? qty;
                  const next = [...form.lines];
                  const updated = {
                    ...l,
                    qty,
                    secondaryQty,
                    amount: 0,
                  };
                  updated.amount = voucherLineAmount(updated, product);
                  next[i] = updated;
                  setForm({ ...form, lines: next });
                }}
              />
              <NumberField
                className="tt-input"
                placeholder="Kg / Pcs"
                value={l.secondaryQty ?? ""}
                emptyAs={null}
                onValueChange={(v) => {
                  const secondaryQty = typeof v === "number" ? v : 0;
                  const next = [...form.lines];
                  const product = l.productId
                    ? db?.products.find((p) => p.id === l.productId)
                    : undefined;
                  const updated = {
                    ...l,
                    secondaryQty,
                    amount: 0,
                  };
                  updated.amount = voucherLineAmount(updated, product);
                  next[i] = updated;
                  setForm({ ...form, lines: next });
                }}
                onKeyDown={
                  showRates
                    ? undefined
                    : (e) => {
                        if (e.key !== "Enter") return;
                        e.preventDefault();
                        onLastItemFieldEnter(i);
                      }
                }
              />
              {showRates ? (
                <div>
                  <NumberField
                    className="tt-input"
                    placeholder={
                      isSqftUnit(l.unit) ? "₹ / sqft" : "Rate"
                    }
                    emptyAs={null}
                    value={l.rate}
                    onValueChange={(v) => {
                      const rate = typeof v === "number" ? v : 0;
                      const next = [...form.lines];
                      const product = l.productId
                        ? db?.products.find((p) => p.id === l.productId)
                        : undefined;
                      const updated = {
                        ...l,
                        rate,
                        amount: 0,
                      };
                      updated.amount = voucherLineAmount(updated, product);
                      next[i] = updated;
                      setForm({ ...form, lines: next });
                    }}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      e.preventDefault();
                      onLastItemFieldEnter(i);
                    }}
                  />
                  {isSqftUnit(l.unit) && l.productId && l.rate > 0
                    ? (() => {
                        const product = db?.products.find(
                          (p) => p.id === l.productId
                        );
                        if (!product) return null;
                        const spec = resolveSqftPack(
                          product,
                          l.variationId
                            ? product.variations.find(
                                (v) => v.id === l.variationId
                              )
                            : undefined
                        );
                        return (
                          <p className="mt-0.5 text-[10px] text-[var(--ink-muted)]">
                            {formatInr(
                              ratePerPiece(
                                l.rate,
                                spec.lengthFt,
                                spec.widthFt
                              )
                            )}
                            /pc ·{" "}
                            {formatInr(
                              ratePerPacket(
                                l.rate,
                                spec.lengthFt,
                                spec.widthFt,
                                spec.pcsPerPacket
                              )
                            )}
                            /pkt
                          </p>
                        );
                      })()
                    : null}
                </div>
              ) : (
                <span className="self-center text-xs text-[var(--ink-muted)]">
                  ••••
                </span>
              )}
            </div>
          ))}

          <button
            type="button"
            className="tt-btn tt-btn-outline"
            onClick={addBlankItemLine}
          >
            + {t("accounts.addItem")}
          </button>
          <button type="submit" className="tt-btn tt-btn-dark block" disabled={saving}>
            {saving ? t("accounts.saving") : t("common.save")}
          </button>
        </form>
      ) : null}

      {tab === "orders" ? (
        <div className="tt-panel mt-6 overflow-x-auto">
          <p className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
            {t("accounts.openPos")}
          </p>
          <table className="tt-table min-w-[640px]">
            <thead>
              <tr>
                <th>No.</th>
                <th>Date</th>
                <th>{t("accounts.suppliers")}</th>
                <th>Status</th>
                <th>{t("accounts.remainingQty")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {openPos.map((po) => {
                const sup = db?.parties.find((p) => p.id === po.supplierId);
                return (
                  <tr key={po.id}>
                    <td className="font-mono text-sm">{po.number}</td>
                    <td>{po.date}</td>
                    <td>{sup?.name || "—"}</td>
                    <td className="capitalize">{po.status}</td>
                    <td className="tabular-nums">{poRemainingQty(po)}</td>
                    <td>
                      <div className="flex flex-wrap gap-x-3">
                        {po.status === "draft" ? (
                          <button
                            type="button"
                            className="text-sm font-semibold text-[var(--brand-deep)] underline"
                            disabled={poBusyId === po.id}
                            onClick={() => void onConfirmPo(po)}
                          >
                            {poBusyId === po.id
                              ? "…"
                              : t("accounts.confirmPoWhatsApp")}
                          </button>
                        ) : null}
                        {canBooks ? (
                          <Link
                            href="/admin/accounts/goods-received"
                            className="text-sm font-semibold text-[var(--brand-deep)] underline"
                          >
                            {t("accounts.receiveAgainstPo")}
                          </Link>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!openPos.length ? (
            <AccountsEmpty message={t("common.empty")} />
          ) : null}
        </div>
      ) : (
      <div className="tt-panel mt-6 overflow-x-auto">
        <p className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
          {t("accounts.purchaseBills")}
        </p>
        <table className="tt-table min-w-[720px]">
          <thead>
            <tr>
              <th>No.</th>
              <th>Date</th>
              <th>{t("accounts.suppliers")}</th>
              <th>{locale === "hi" ? "नोट" : "Narration"}</th>
              {showRates ? <th>{t("common.total")}</th> : null}
            </tr>
          </thead>
          <tbody>
            {purchases.map((v) => {
              const sup = db?.parties.find((p) => p.id === v.partyId);
              return (
                <tr key={v.id}>
                  <td><VoucherNumberLink id={v.id} number={v.number} /></td>
                  <td>{v.date}</td>
                  <td>{sup?.name || "—"}</td>
                  <td className="text-sm text-[var(--ink-muted)]">
                    {v.narration || "—"}
                  </td>
                  {showRates ? (
                    <td>{formatInr(v.total, locale)}</td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
        {!purchases.length ? (
          <AccountsEmpty message={t("common.empty")} />
        ) : null}
      </div>
      )}
    </AccountsShell>
  );
}
