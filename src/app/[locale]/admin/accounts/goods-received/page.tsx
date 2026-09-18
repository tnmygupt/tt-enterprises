"use client";

import { FormEvent, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { FilePick } from "@/components/FilePick";
import { NumberField } from "@/components/NumberField";
import {
  CreatePartyModal,
  CreateProductModal,
} from "@/components/QuickCreateModals";
import { SearchSelect } from "@/components/SearchSelect";
import {
  catalogRowValue,
  deriveSecondaryQty,
  inventoryRows,
  parseCatalogRowValue,
} from "@/lib/inventory";
import { fileToDataUrl, useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import {
  listOpenPurchaseOrders,
  poLineRemaining,
  poRemainingQty,
} from "@/lib/purchase-orders";
import {
  canViewFinancials,
  checkCapability,
  createGoodsReceipt,
  listUnpricedGoodsReceipts,
  recordGoodsReceived,
  voidGoodsReceipt,
} from "@/lib/store/db";
import type { PurchaseOrder } from "@/lib/types";

type LineDraft = {
  id: string;
  productId: string;
  variationId: string;
  colorId: string;
  itemLabel: string;
  qty: number;
  secondaryQty: number;
  poLineId?: string;
};

function blankLine(): LineDraft {
  return {
    id: crypto.randomUUID(),
    productId: "",
    variationId: "",
    colorId: "",
    itemLabel: "",
    qty: 1,
    secondaryQty: 1,
  };
}

function linesFromPo(po: PurchaseOrder): LineDraft[] {
  const remaining = po.lines.filter((l) => poLineRemaining(l) > 0.001);
  if (!remaining.length) return [blankLine()];
  return remaining.map((l) => {
    const rem = poLineRemaining(l);
    const ratio = l.qty > 0 ? rem / l.qty : 1;
    return {
      id: crypto.randomUUID(),
      productId: l.productId || "",
      variationId: l.variationId || "",
      colorId: l.colorId || "",
      itemLabel: l.itemLabel,
      qty: rem,
      secondaryQty: (l.secondaryQty ?? l.qty) * ratio,
      poLineId: l.id,
    };
  });
}

export default function GoodsReceivedPage() {
  return (
    <Suspense
      fallback={
        <AccountsShell>
          <p>Loading…</p>
        </AccountsShell>
      }
    >
      <GoodsReceivedInner />
    </Suspense>
  );
}

function GoodsReceivedInner() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const search = useSearchParams();
  const highlightId = search.get("id") || "";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;
  const highlightRef = useRef<HTMLTableRowElement | null>(null);

  const [supplierId, setSupplierId] = useState("");
  const [poId, setPoId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [packingFile, setPackingFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [productModalLine, setProductModalLine] = useState<number | null>(
    null
  );

  useEffect(() => {
    if (!highlightId) return;
    highlightRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [highlightId, db]);

  const catalog = useMemo(() => (db ? inventoryRows(db) : []), [db]);
  const supplierOptions = useMemo(
    () =>
      (db?.parties.filter((p) => p.active && p.type === "supplier") ?? []).map(
        (s) => ({
          value: s.id,
          label: s.name,
          searchText: `${s.name} ${s.phone ?? ""} ${s.gstin ?? ""}`,
        })
      ),
    [db]
  );
  const unpriced = useMemo(
    () => (db ? listUnpricedGoodsReceipts(db) : []),
    [db]
  );
  const recent = useMemo(() => {
    if (!db) return [];
    return [...(db.goodsReceipts ?? [])]
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, 40);
  }, [db]);
  const openPos = useMemo(
    () => listOpenPurchaseOrders(db?.purchaseOrders),
    [db]
  );
  const selectedPo = openPos.find((p) => p.id === poId);

  const exportOptions = useMemo(
    () => ({
      title: "Goods received",
      subtitle: new Date().toISOString().slice(0, 10),
      filename: `goods-received-${new Date().toISOString().slice(0, 10)}.pdf`,
      columns: ["No.", "Date", "Supplier", "Items", "Packing slip", "Status"],
      rows: recent.map((g) => {
        const po = db?.purchaseOrders.find((p) => p.id === g.poId);
        const supplier =
          db?.parties.find((p) => p.id === po?.supplierId)?.name || "—";
        const billed = db?.vouchers.some(
          (v) => v.linkedGrnId === g.id && v.type === "purchase" && !v.voided
        );
        return [
          g.number,
          g.date,
          supplier,
          g.lines.length,
          g.packingSlipName || (g.packingSlipDataUrl ? "Yes" : "—"),
          billed ? "Priced" : g.voided ? "Voided" : "Needs pricing",
        ];
      }),
    }),
    [db, recent]
  );

  if (!session || !checkCapability(session, db, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setMsg("");
    setSaving(true);
    try {
      let packingSlipDataUrl: string | undefined;
      let packingSlipName: string | undefined;
      if (packingFile) {
        packingSlipDataUrl = await fileToDataUrl(packingFile);
        packingSlipName = packingFile.name;
      }
      const cleaned = lines.filter((l) => l.productId && l.itemLabel.trim());
      if (!cleaned.length) {
        throw new Error("Add at least one catalog item");
      }
      for (const l of cleaned) {
        const product = db?.products.find((p) => p.id === l.productId);
        if (!product) throw new Error(`Product missing for ${l.itemLabel}`);
        if (product.variations.length && !l.variationId) {
          throw new Error(`Choose size for ${l.itemLabel}`);
        }
        if (product.colors.length && !l.colorId) {
          throw new Error(`Choose color for ${l.itemLabel}`);
        }
        if (!(l.qty > 0) && !(l.secondaryQty > 0)) {
          throw new Error(`Enter quantity for ${l.itemLabel}`);
        }
      }
      let grnNumber = "";
      if (poId) {
        if (!selectedPo) throw new Error("Select an open purchase order");
        const against = cleaned.filter((l) => l.poLineId);
        if (!against.length) {
          throw new Error("Receive remaining lines from the selected PO");
        }
        const grn = createGoodsReceipt({
          poId,
          date,
          narration,
          packingSlipDataUrl,
          packingSlipName,
          createdBy: session.id,
          lines: against.map((l) => ({
            id: `grnl_${crypto.randomUUID()}`,
            poLineId: l.poLineId || "",
            productId: l.productId,
            variationId: l.variationId || undefined,
            colorId: l.colorId || undefined,
            itemLabel: l.itemLabel,
            qty: l.qty,
            secondaryQty: l.secondaryQty,
            unit: db?.products.find((p) => p.id === l.productId)?.unit,
          })),
        });
        grnNumber = grn.number;
      } else {
        const { grn } = recordGoodsReceived({
          supplierId,
          date,
          narration,
          packingSlipDataUrl,
          packingSlipName,
          createdBy: session.id,
          lines: cleaned.map((l) => ({
            productId: l.productId,
            variationId: l.variationId || undefined,
            colorId: l.colorId || undefined,
            itemLabel: l.itemLabel,
            qty: l.qty,
            secondaryQty: l.secondaryQty,
            unit: db?.products.find((p) => p.id === l.productId)?.unit,
          })),
        });
        grnNumber = grn.number;
      }
      setMsg(
        `Saved ${grnNumber}. Stock is in — check Stock (Alt+F2). Owner will set the rate next.`
      );
      setSupplierId("");
      setPoId("");
      setNarration("");
      setLines([blankLine()]);
      setPackingFile(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AccountsShell focusMode>
      <AccountsPageHeader
        title={t("accounts.goodsReceived")}
        hint={t("accounts.goodsReceivedHint")}
        actions={
          <>
            <ExportButtons options={exportOptions} />
            {isOwner && unpriced.length > 0 ? (
              <Link
                href="/admin/accounts/needs-pricing"
                className="tt-btn tt-btn-dark"
              >
                {t("accounts.needsPricing")} · {unpriced.length}
              </Link>
            ) : null}
          </>
        }
      />

      {unpriced.length > 0 ? (
        <p className="mt-3 rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {unpriced.length} receipt{unpriced.length === 1 ? "" : "s"} waiting
          for the owner to set rates
          {isOwner ? (
            <>
              {" · "}
              <Link
                href="/admin/accounts/needs-pricing"
                className="font-semibold underline"
              >
                Open queue
              </Link>
            </>
          ) : null}
        </p>
      ) : null}

      {msg ? (
        <p className="mt-3 text-sm text-[var(--ok)]">
          {msg}{" "}
          <Link href="/admin/accounts/inventory" className="underline">
            Open stock
          </Link>
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      {openPos.length ? (
        <div className="tt-panel mt-5 overflow-x-auto">
          <p className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
            Open purchase orders
          </p>
          <table className="tt-table min-w-[560px]">
            <thead>
              <tr>
                <th>No.</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Remaining</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {openPos.map((po) => {
                const supplier =
                  db?.parties.find((p) => p.id === po.supplierId)?.name || "—";
                return (
                  <tr key={po.id}>
                    <td className="font-mono text-xs">{po.number}</td>
                    <td>{supplier}</td>
                    <td className="capitalize">{po.status}</td>
                    <td className="tabular-nums">{poRemainingQty(po)}</td>
                    <td>
                      <button
                        type="button"
                        className="text-sm font-semibold text-[var(--brand-deep)] underline"
                        onClick={() => {
                          setPoId(po.id);
                          setSupplierId(po.supplierId);
                          setLines(linesFromPo(po));
                          setError("");
                        }}
                      >
                        Receive
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}

      <form onSubmit={onSave} className="tt-panel mt-5 space-y-4 p-5">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={`tt-btn ${!poId ? "tt-btn-dark" : "tt-btn-outline"}`}
            onClick={() => {
              setPoId("");
              setLines([blankLine()]);
            }}
          >
            Walk-in (new PO)
          </button>
          <button
            type="button"
            className={`tt-btn ${poId ? "tt-btn-dark" : "tt-btn-outline"}`}
            onClick={() => {
              if (openPos[0]) {
                setPoId(openPos[0].id);
                setSupplierId(openPos[0].supplierId);
                setLines(linesFromPo(openPos[0]));
              }
            }}
            disabled={!openPos.length}
          >
            Receive against PO
          </button>
        </div>
        {poId ? (
          <div>
            <label className="tt-label">Purchase order</label>
            <select
              className="tt-select"
              value={poId}
              onChange={(e) => {
                const nextId = e.target.value;
                setPoId(nextId);
                const po = openPos.find((p) => p.id === nextId);
                if (po) {
                  setSupplierId(po.supplierId);
                  setLines(linesFromPo(po));
                }
              }}
            >
              {openPos.map((po) => {
                const supplier =
                  db?.parties.find((p) => p.id === po.supplierId)?.name || "—";
                return (
                  <option key={po.id} value={po.id}>
                    {po.number} · {supplier} · {po.status} · left{" "}
                    {poRemainingQty(po)}
                  </option>
                );
              })}
            </select>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="tt-label mb-0">Supplier</label>
              {!poId ? (
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-deep)] underline"
                  onClick={() => setShowSupplierModal(true)}
                >
                  + New supplier
                </button>
              ) : null}
            </div>
            <SearchSelect
              options={supplierOptions}
              value={supplierId}
              onChange={setSupplierId}
              placeholder="Search supplier…"
              emptyLabel="Select supplier…"
              required={!poId}
              disabled={!!poId}
            />
          </div>
          <div>
            <label className="tt-label">Date</label>
            <input
              type="date"
              className="tt-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="tt-label">Note</label>
            <input
              className="tt-input"
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <FilePick
          kind="photoOrPdf"
          value={packingFile}
          onChange={(files) => setPackingFile(files[0] ?? null)}
          label="Packing slip (photo or PDF)"
        />

        <div className="space-y-3">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            Items — quantity only, no rates
          </p>
          <div className="hidden gap-2 px-3 md:grid md:grid-cols-[minmax(0,1fr)_6rem_7rem_2rem]">
            <p className="tt-label mb-0">Catalog item</p>
            <p className="tt-label mb-0 text-center">Bundles</p>
            <p className="tt-label mb-0 text-center">Kg / pcs</p>
            <span />
          </div>
          {lines.map((l, i) => (
            <div
              key={l.id}
              className="grid gap-2 rounded-lg border border-[var(--line)] p-3 md:grid-cols-[minmax(0,1fr)_6rem_7rem_2rem]"
            >
              <div>
                <div className="mb-1 flex items-center justify-between gap-2 sm:mb-0">
                  <label className="tt-label mb-0 sm:sr-only">
                    Catalog item
                  </label>
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-deep)] underline md:ml-auto"
                    onClick={() => setProductModalLine(i)}
                  >
                    + New item
                  </button>
                </div>
                <SearchSelect
                  options={catalog.map((c) => ({
                    value: catalogRowValue(c),
                    label: `${c.sku} · ${c.name}`,
                    searchText: `${c.sku} ${c.name}`,
                  }))}
                  value={
                    l.productId
                      ? catalogRowValue({
                          productId: l.productId,
                          variationId: l.variationId || undefined,
                          colorId: l.colorId || undefined,
                        })
                      : ""
                  }
                  onChange={(val) => {
                    const next = [...lines];
                    if (!val) {
                      next[i] = {
                        ...l,
                        productId: "",
                        variationId: "",
                        colorId: "",
                        itemLabel: "",
                      };
                      setLines(next);
                      return;
                    }
                    const { productId, variationId, colorId } =
                      parseCatalogRowValue(val);
                    const item = catalog.find(
                      (c) =>
                        c.productId === productId &&
                        (c.variationId ?? "") === (variationId || "") &&
                        (c.colorId ?? "") === (colorId || "")
                    );
                    const product = db?.products.find(
                      (p) => p.id === productId
                    );
                    const qty = l.qty || 1;
                    const secondaryQty = product
                      ? deriveSecondaryQty(
                          product,
                          qty,
                          variationId || undefined
                        )
                      : qty;
                    next[i] = {
                      ...l,
                      productId,
                      variationId: variationId || "",
                      colorId: colorId || "",
                      itemLabel: item?.name || "",
                      secondaryQty,
                    };
                    setLines(next);
                  }}
                  placeholder="Search catalog…"
                  emptyLabel="Select item…"
                  required
                />
              </div>
              <div>
                <label className="tt-label sm:sr-only">Bundles</label>
                <NumberField
                  className="tt-input w-full"
                  placeholder="Bundles"
                  value={l.qty}
                  onValueChange={(v) => {
                    const qty = typeof v === "number" ? v : 0;
                    const product = l.productId
                      ? db?.products.find((p) => p.id === l.productId)
                      : undefined;
                    const secondaryQty = product
                      ? deriveSecondaryQty(
                          product,
                          qty,
                          l.variationId || undefined
                        )
                      : l.secondaryQty;
                    const next = [...lines];
                    next[i] = { ...l, qty, secondaryQty };
                    setLines(next);
                  }}
                />
              </div>
              <div>
                <label className="tt-label sm:sr-only">
                  Total weight / pcs
                </label>
                <NumberField
                  className="tt-input w-full"
                  placeholder="Kg / pcs"
                  value={l.secondaryQty}
                  onValueChange={(v) => {
                    const next = [...lines];
                    next[i] = {
                      ...l,
                      secondaryQty: typeof v === "number" ? v : 0,
                    };
                    setLines(next);
                  }}
                />
              </div>
              <button
                type="button"
                className="self-end pb-2 text-[var(--danger)] sm:self-center sm:pb-0"
                onClick={() => setLines(lines.filter((x) => x.id !== l.id))}
                aria-label="Remove line"
              >
                ×
              </button>
            </div>
          ))}
          {lines.some((l) => l.productId) ? (
            <p className="text-sm text-[var(--ink-muted)]">
              Totals:{" "}
              <strong className="tabular-nums text-[var(--ink)]">
                {lines.reduce((s, l) => s + (l.qty || 0), 0)}
              </strong>{" "}
              bundles ·{" "}
              <strong className="tabular-nums text-[var(--ink)]">
                {lines.reduce((s, l) => s + (l.secondaryQty || 0), 0)}
              </strong>{" "}
              kg / pcs
            </p>
          ) : null}
          {poId ? null : (
          <button
            type="button"
            className="text-sm font-semibold text-[var(--brand)]"
            onClick={() => setLines([...lines, blankLine()])}
          >
            + Add line
          </button>
          )}
        </div>

        <button type="submit" className="tt-btn tt-btn-dark" disabled={saving}>
          {saving ? "Saving…" : "Save — stock in"}
        </button>
      </form>

      <div className="mt-6 space-y-2 sm:hidden">
        <p className="text-sm font-semibold">Recent receipts</p>
        {recent.map((g) => {
          const po = db?.purchaseOrders.find((p) => p.id === g.poId);
          const supplier =
            db?.parties.find((p) => p.id === po?.supplierId)?.name || "—";
          const bill = db?.vouchers.find(
            (v) =>
              v.linkedGrnId === g.id && v.type === "purchase" && !v.voided
          );
          const billed = !!bill;
          const highlighted = highlightId === g.id;
          return (
            <div
              key={g.id}
              className={`tt-panel p-3 ${g.voided ? "opacity-50" : ""} ${
                highlighted
                  ? "bg-[var(--brand-soft)] ring-1 ring-[var(--brand)]"
                  : ""
              }`}
            >
              <p className="font-mono text-sm font-semibold">{g.number}</p>
              <p className="text-sm">{supplier}</p>
              <p className="text-xs text-[var(--ink-muted)]">
                {g.date} · {g.lines.length} items
              </p>
              <p className="mt-1 text-sm">
                {g.voided ? (
                  <span className="text-[var(--danger)]">Voided</span>
                ) : billed ? (
                  <span className="text-[var(--ok)]">Priced</span>
                ) : (g.accruedAmount || 0) > 0.009 ? (
                  <span className="font-semibold text-[var(--brand-deep)]">
                    {t("accounts.grniOpen")}
                    {isOwner
                      ? ` · ${formatInr(g.accruedAmount || 0, locale)}`
                      : ""}
                  </span>
                ) : (
                  <span className="font-semibold text-[var(--brand-deep)]">
                    Needs pricing
                  </span>
                )}
              </p>
              {g.voided ? null : billed && bill ? (
                <p className="mt-2 text-xs text-[var(--ink-muted)]">
                  Void the purchase bill first.{" "}
                  <Link
                    href={`/admin/accounts/vouchers?id=${encodeURIComponent(bill.id)}`}
                    className="font-semibold text-[var(--brand-deep)] underline"
                  >
                    {bill.number}
                  </Link>
                </p>
              ) : (
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold text-[var(--danger)]"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Void ${g.number}? Stock and contract usage will be reversed.`
                      )
                    ) {
                      return;
                    }
                    try {
                      voidGoodsReceipt(g.id, session?.id || "system");
                      setMsg(`Voided ${g.number}`);
                      setError("");
                      refresh();
                    } catch (err) {
                      setError(
                        err instanceof Error
                          ? err.message
                          : "Could not void GRN"
                      );
                      setMsg("");
                    }
                  }}
                >
                  Void
                </button>
              )}
            </div>
          );
        })}
        {!recent.length ? (
          <p className="p-2 text-sm text-[var(--ink-muted)]">
            No goods received yet
          </p>
        ) : null}
      </div>

      <div className="tt-panel mt-6 hidden overflow-x-auto sm:block">
        <p className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
          Recent receipts
        </p>
        <table className="tt-table min-w-[720px]">
          <thead>
            <tr>
              <th>No.</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Items</th>
              <th>Packing slip</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {recent.map((g) => {
              const po = db?.purchaseOrders.find((p) => p.id === g.poId);
              const supplier =
                db?.parties.find((p) => p.id === po?.supplierId)?.name || "—";
              const bill = db?.vouchers.find(
                (v) =>
                  v.linkedGrnId === g.id && v.type === "purchase" && !v.voided
              );
              const billed = !!bill;
              const highlighted = highlightId === g.id;
              return (
                <tr
                  key={g.id}
                  ref={highlighted ? highlightRef : undefined}
                  id={g.id}
                  className={`${g.voided ? "opacity-50" : ""} ${
                    highlighted
                      ? "bg-[var(--brand-soft)] ring-1 ring-[var(--brand)]"
                      : ""
                  }`}
                >
                  <td className="font-mono text-xs">{g.number}</td>
                  <td>{g.date}</td>
                  <td>{supplier}</td>
                  <td>{g.lines.length}</td>
                  <td>
                    {g.packingSlipDataUrl ? (
                      <a
                        href={g.packingSlipDataUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[var(--brand)] underline"
                      >
                        {g.packingSlipName || "View"}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {g.voided ? (
                      <span className="text-[var(--danger)]">Voided</span>
                    ) : billed ? (
                      <span className="text-[var(--ok)]">Priced</span>
                    ) : (g.accruedAmount || 0) > 0.009 ? (
                      <span className="font-semibold text-[var(--brand-deep)]">
                        {t("accounts.grniOpen")}
                        {isOwner
                          ? ` · ${formatInr(g.accruedAmount || 0, locale)}`
                          : ""}
                      </span>
                    ) : (
                      <span className="font-semibold text-[var(--brand-deep)]">
                        Needs pricing
                      </span>
                    )}
                  </td>
                  <td>
                    {g.voided ? null : billed && bill ? (
                      <span className="block max-w-[14rem] text-xs text-[var(--ink-muted)]">
                        Void the purchase bill first, then void this GRN.{" "}
                        <Link
                          href={`/admin/accounts/vouchers?id=${encodeURIComponent(bill.id)}`}
                          className="font-semibold text-[var(--brand-deep)] underline"
                        >
                          {bill.number}
                        </Link>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="text-xs font-semibold text-[var(--danger)]"
                        onClick={() => {
                          if (
                            !window.confirm(
                              `Void ${g.number}? Stock and contract usage will be reversed.`
                            )
                          ) {
                            return;
                          }
                          try {
                            voidGoodsReceipt(g.id, session?.id || "system");
                            setMsg(`Voided ${g.number}`);
                            setError("");
                            refresh();
                          } catch (err) {
                            setError(
                              err instanceof Error
                                ? err.message
                                : "Could not void GRN"
                            );
                            setMsg("");
                          }
                        }}
                      >
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {!recent.length ? (
              <tr>
                <td colSpan={7} className="text-[var(--ink-muted)]">
                  No goods received yet
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {showSupplierModal ? (
        <CreatePartyModal
          defaultType="supplier"
          onClose={() => setShowSupplierModal(false)}
          onCreated={(party) => {
            setSupplierId(party.id);
            setShowSupplierModal(false);
            refresh();
          }}
        />
      ) : null}

      {productModalLine != null ? (
        <CreateProductModal
          onClose={() => setProductModalLine(null)}
          onCreated={(product, variationId) => {
            const i = productModalLine;
            const qty = lines[i]?.qty || 1;
            const secondaryQty = deriveSecondaryQty(
              product,
              qty,
              variationId
            );
            const next = [...lines];
            next[i] = {
              ...(lines[i] || blankLine()),
              productId: product.id,
              variationId,
              colorId: product.colors[0]?.id || "",
              itemLabel: product.name.en,
              qty,
              secondaryQty,
            };
            setLines(next);
            setProductModalLine(null);
            refresh();
          }}
        />
      ) : null}
    </AccountsShell>
  );
}
