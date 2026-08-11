"use client";

import { FormEvent, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { NumberField } from "@/components/NumberField";
import { SearchSelect } from "@/components/SearchSelect";
import {
  catalogRowValue,
  deriveSecondaryQty,
  inventoryRows,
  parseCatalogRowValue,
} from "@/lib/inventory";
import { ExportButtons } from "@/components/ExportButtons";
import { fileToDataUrl, useDb, useSession } from "@/lib/hooks";
import { formatInr, roundMoney } from "@/lib/pricing";
import {
  canViewFinancials,
  createVoucher,
  checkCapability,
} from "@/lib/store/db";
import type { VoucherLine } from "@/lib/types";

function blankLine(): VoucherLine {
  return {
    id: `vl_${crypto.randomUUID()}`,
    itemLabel: "",
    qty: 1,
    secondaryQty: 1,
    rate: 0,
    amount: 0,
  };
}

export default function PurchasesPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const showRates = session ? canViewFinancials(session.role) : false;
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [packingFile, setPackingFile] = useState<File | null>(null);
  const [form, setForm] = useState({
    supplierId: "",
    date: new Date().toISOString().slice(0, 10),
    narration: "",
    lines: [blankLine()],
  });

  const catalog = useMemo(() => (db ? inventoryRows(db) : []), [db]);
  const suppliers =
    db?.parties.filter((p) => p.active && p.type === "supplier") ?? [];
  const purchases = useMemo(() => {
    if (!db) return [];
    return db.vouchers
      .filter((v) => v.type === "purchase" && !v.voided)
      .sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number));
  }, [db]);

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
      if (!showRates) {
        throw new Error("Only the owner can enter purchase rates");
      }
      const lines = form.lines
        .map((l) => ({
          ...l,
          amount: roundMoney((l.secondaryQty ?? l.qty) * l.rate),
        }))
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
    }
  };

  return (
    <AccountsShell focusMode={showForm}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">
            {t("accounts.purchases")}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Owner direct bills. Day-to-day: staff use{" "}
            <Link
              href="/admin/accounts/goods-received"
              className="font-semibold text-[var(--brand-deep)] underline"
            >
              Goods received
            </Link>
            , then you price them.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ExportButtons options={exportOptions} />
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

      {!showRates ? (
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
          <div>
            <label className="tt-label">Packing slip (photo or PDF)</label>
            <input
              type="file"
              accept="image/*,.pdf"
              className="tt-input"
              onChange={(e) => setPackingFile(e.target.files?.[0] ?? null)}
            />
          </div>

          {form.lines.map((l, i) => (
            <div key={l.id} className="grid gap-2 md:grid-cols-5">
              <SearchSelect
                className="sm:col-span-2"
                options={catalog.map((c) => ({
                  value: catalogRowValue(c),
                  label: `${c.sku} · ${c.name}`,
                  searchText: `${c.sku} ${c.name}`,
                }))}
                value={
                  l.productId
                    ? catalogRowValue({
                        productId: l.productId,
                        variationId: l.variationId,
                        colorId: l.colorId,
                      })
                    : ""
                }
                onChange={(val) => {
                  const next = [...form.lines];
                  if (!val) {
                    next[i] = {
                      ...l,
                      productId: undefined,
                      variationId: undefined,
                      colorId: undefined,
                      itemLabel: "",
                    };
                    setForm({ ...form, lines: next });
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
                  const product = db?.products.find((p) => p.id === productId);
                  const variation = product?.variations.find(
                    (v) => v.id === variationId
                  );
                  const rate = variation?.rate ?? product?.baseRate ?? l.rate;
                  const qty = l.qty || 1;
                  const secondaryQty = product
                    ? deriveSecondaryQty(product, qty, variationId || undefined)
                    : qty;
                  next[i] = {
                    ...l,
                    productId,
                    variationId: variationId || undefined,
                    colorId: colorId || undefined,
                    itemLabel: item?.name || l.itemLabel,
                    unit: product?.unit,
                    rate,
                    secondaryQty,
                    amount: roundMoney(secondaryQty * rate),
                  };
                  setForm({ ...form, lines: next });
                }}
                placeholder="Search catalog…"
                emptyLabel="Catalog…"
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
                  next[i] = {
                    ...l,
                    qty,
                    secondaryQty,
                    amount: roundMoney(secondaryQty * l.rate),
                  };
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
                  next[i] = {
                    ...l,
                    secondaryQty,
                    amount: roundMoney(secondaryQty * l.rate),
                  };
                  setForm({ ...form, lines: next });
                }}
              />
              {showRates ? (
                <NumberField
                  className="tt-input"
                  placeholder="Rate"
                  emptyAs={null}
                  value={l.rate}
                  onValueChange={(v) => {
                    const rate = typeof v === "number" ? v : 0;
                    const next = [...form.lines];
                    next[i] = {
                      ...l,
                      rate,
                      amount: roundMoney((l.secondaryQty ?? l.qty) * rate),
                    };
                    setForm({ ...form, lines: next });
                  }}
                />
              ) : (
                <span className="self-center text-xs text-[var(--ink-muted)]">
                  ••••
                </span>
              )}
            </div>
          ))}

          <button
            type="button"
            className="text-sm font-semibold text-[var(--brand)]"
            onClick={() =>
              setForm({ ...form, lines: [...form.lines, blankLine()] })
            }
          >
            + {locale === "hi" ? "लाइन" : "Line"}
          </button>
          <button type="submit" className="tt-btn tt-btn-dark block">
            {t("common.save")}
          </button>
        </form>
      ) : null}

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
          <p className="p-4 text-sm text-[var(--ink-muted)]">
            {t("common.empty")}
          </p>
        ) : null}
      </div>
    </AccountsShell>
  );
}
