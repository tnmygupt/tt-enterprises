"use client";

import { FormEvent, useMemo, useState } from "react";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
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
import {
  canViewFinancials,
  checkCapability,
  listUnpricedGoodsReceipts,
  recordGoodsReceived,
  voidGoodsReceipt,
} from "@/lib/store/db";

type LineDraft = {
  id: string;
  productId: string;
  variationId: string;
  colorId: string;
  itemLabel: string;
  qty: number;
  secondaryQty: number;
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

export default function GoodsReceivedPage() {
  const { session } = useSession();
  const { db, refresh } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;

  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [packingFile, setPackingFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [productModalLine, setProductModalLine] = useState<number | null>(
    null
  );

  const catalog = useMemo(() => (db ? inventoryRows(db) : []), [db]);
  const suppliers =
    db?.parties.filter((p) => p.active && p.type === "supplier") ?? [];
  const supplierOptions = useMemo(
    () =>
      suppliers.map((s) => ({
        value: s.id,
        label: s.name,
        searchText: `${s.name} ${s.phone ?? ""} ${s.gstin ?? ""}`,
      })),
    [suppliers]
  );
  const unpriced = useMemo(
    () => (db ? listUnpricedGoodsReceipts(db) : []),
    [db]
  );
  const recent = useMemo(() => {
    if (!db) return [];
    return [...(db.goodsReceipts ?? [])]
      .filter((g) => !g.voided)
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 30);
  }, [db]);

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
          billed ? "Priced" : "Needs pricing",
        ];
      }),
    }),
    [db, recent]
  );

  if (!session || !checkCapability(session, db?.users, "manage_accounts")) {
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
      setMsg(
        `Saved ${grn.number}. Stock is in — check Stock (Alt+F2). Owner will set the rate next.`
      );
      setSupplierId("");
      setNarration("");
      setLines([blankLine()]);
      setPackingFile(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <AccountsShell focusMode>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">
            Goods received
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Enter supplier, items and quantities. Attach the packing slip.
            Rates are set by the owner later.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButtons options={exportOptions} />
          {isOwner && unpriced.length > 0 ? (
            <Link
              href="/admin/accounts/needs-pricing"
              className="tt-btn tt-btn-dark"
            >
              Needs pricing · {unpriced.length}
            </Link>
          ) : null}
        </div>
      </div>

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

      <form onSubmit={onSave} className="tt-panel mt-5 space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="tt-label mb-0">Supplier</label>
              <button
                type="button"
                className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-deep)] underline"
                onClick={() => setShowSupplierModal(true)}
              >
                + New supplier
              </button>
            </div>
            <SearchSelect
              options={supplierOptions}
              value={supplierId}
              onChange={setSupplierId}
              placeholder="Search supplier…"
              emptyLabel="Select supplier…"
              required
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

        <div>
          <label className="tt-label">Packing slip (photo or PDF)</label>
          <input
            type="file"
            accept="image/*,.pdf"
            className="tt-input"
            onChange={(e) => setPackingFile(e.target.files?.[0] ?? null)}
          />
        </div>

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
          <button
            type="button"
            className="text-sm font-semibold text-[var(--brand)]"
            onClick={() => setLines([...lines, blankLine()])}
          >
            + Add line
          </button>
        </div>

        <button type="submit" className="tt-btn tt-btn-dark">
          Save — stock in
        </button>
      </form>

      <div className="tt-panel mt-6 overflow-x-auto">
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
              const billed = db?.vouchers.some(
                (v) =>
                  v.linkedGrnId === g.id && v.type === "purchase" && !v.voided
              );
              return (
                <tr key={g.id} className={g.voided ? "opacity-50" : undefined}>
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
                    ) : (
                      <span className="font-semibold text-[var(--brand-deep)]">
                        Needs pricing
                      </span>
                    )}
                  </td>
                  <td>
                    {!g.voided && !billed ? (
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
                    ) : null}
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
