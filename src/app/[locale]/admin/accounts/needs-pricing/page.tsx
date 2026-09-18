"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { NumberField } from "@/components/NumberField";
import { PURCHASE_CHARGE_PRESETS, partyBalance } from "@/lib/accounting";
import { resolveOpenContract } from "@/lib/contracts";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr, roundMoney, roundOffRupees } from "@/lib/pricing";
import {
  canViewFinancials,
  listUnpricedGoodsReceipts,
  priceGoodsReceived,
} from "@/lib/store/db";

type ExpenseDraft = {
  id: string;
  presetId: string;
  itemLabel: string;
  accountId: string;
  amount: number | "";
};

function blankExpense(): ExpenseDraft {
  const preset = PURCHASE_CHARGE_PRESETS[0];
  return {
    id: crypto.randomUUID(),
    presetId: preset.id,
    itemLabel: preset.label,
    accountId: preset.accountId,
    amount: "",
  };
}

export default function NeedsPricingPage() {
  const t = useTranslations();
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [activeId, setActiveId] = useState<string>("");
  const [rates, setRates] = useState<Record<string, string>>({});
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [expenses, setExpenses] = useState<ExpenseDraft[]>([]);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);

  const queue = useMemo(
    () => (db ? listUnpricedGoodsReceipts(db) : []),
    [db]
  );

  const active = queue.find((q) => q.grn.id === activeId) || queue[0];

  const activeGrnId = active?.grn.id;
  useEffect(() => {
    if (!activeGrnId || !db) return;
    const row = listUnpricedGoodsReceipts(db).find(
      (q) => q.grn.id === activeGrnId
    );
    if (!row) return;
    const next: Record<string, string> = {};
    for (const line of row.grn.lines) {
      const poLine = row.po.lines.find((l) => l.id === line.poLineId);
      if (poLine && poLine.rate > 0) {
        next[line.id] = String(poLine.rate);
        continue;
      }
      const contract = resolveOpenContract(
        db.supplierContracts ?? [],
        db.products,
        row.po.supplierId,
        line.productId || poLine?.productId,
        row.grn.date,
        {
          contractId: poLine?.contractId,
          variationId: line.variationId || poLine?.variationId,
        }
      );
      next[line.id] = contract ? String(contract.rate) : "";
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRates(next);
    setExpenses([]);
    if (!activeId) setActiveId(activeGrnId);
  }, [activeGrnId, activeId, db]);

  if (!session || !canViewFinancials(session.role)) {
    return (
      <AccountsShell>
        <AdminAccessDenied title={t("accounts.ownerOnlyPurchaseRates")} />
      </AccountsShell>
    );
  }

  const openPricing = (grnId: string) => {
    setActiveId(grnId);
    setError("");
    setMsg("");
    setExpenses([]);
    const row = queue.find((q) => q.grn.id === grnId);
    if (!row) return;
    const next: Record<string, string> = {};
    for (const line of row.grn.lines) {
      const poLine = row.po.lines.find((l) => l.id === line.poLineId);
      if (poLine && poLine.rate > 0) {
        next[line.id] = String(poLine.rate);
        continue;
      }
      const contract = db
        ? resolveOpenContract(
            db.supplierContracts ?? [],
            db.products,
            row.po.supplierId,
            line.productId || poLine?.productId,
            row.grn.date,
            {
              contractId: poLine?.contractId,
              variationId: line.variationId || poLine?.variationId,
            }
          )
        : undefined;
      next[line.id] =
        contract ? String(contract.rate) : rates[line.id] || "";
    }
    setRates(next);
  };

  const linePreview = active
    ? active.grn.lines.map((l) => {
        const qty = l.secondaryQty ?? l.qty;
        const rate = Number(rates[l.id]) || 0;
        const poLine = active.po.lines.find((pl) => pl.id === l.poLineId);
        const contract = db
          ? resolveOpenContract(
              db.supplierContracts ?? [],
              db.products,
              active.po.supplierId,
              l.productId || poLine?.productId,
              active.grn.date,
              {
                contractId: poLine?.contractId,
                variationId: l.variationId || poLine?.variationId,
              }
            )
          : undefined;
        return {
          ...l,
          measure: qty,
          rate,
          amount: roundMoney(qty * rate),
          contractRate: contract?.rate,
        };
      })
    : [];

  const goodsSubtotal = roundMoney(
    linePreview.reduce((s, l) => s + l.amount, 0)
  );

  const expensePreview = expenses
    .map((e) => {
      const amount = typeof e.amount === "number" ? e.amount : 0;
      return {
        ...e,
        amount,
        tax: 0,
      };
    })
    .filter((e) => e.amount > 0);

  const expenseSubtotal = roundMoney(
    expensePreview.reduce((s, e) => s + e.amount, 0)
  );
  const previewSubtotal = roundMoney(goodsSubtotal + expenseSubtotal);
  const exactTotal = previewSubtotal;
  const previewTotal = roundOffRupees(exactTotal);
  const previewRoundOff = roundMoney(previewTotal - exactTotal);

  const totalBundles = active
    ? roundMoney(active.grn.lines.reduce((s, l) => s + (l.qty || 0), 0))
    : 0;
  const totalWeight = active
    ? roundMoney(
        active.grn.lines.reduce(
          (s, l) => s + (l.secondaryQty ?? l.qty ?? 0),
          0
        )
      )
    : 0;

  const supplierParty = active
    ? db?.parties.find((p) => p.id === active.po.supplierId)
    : undefined;
  const supplierClosing = supplierParty
    ? partyBalance(supplierParty, db?.ledgerEntries ?? [], date)
    : 0;

  const onSave = (e: FormEvent) => {
    e.preventDefault();
    if (!active) return;
    setError("");
    setMsg("");
    setSaving(true);
    try {
      const rateNums: Record<string, number> = {};
      for (const line of active.grn.lines) {
        rateNums[line.id] = Number(rates[line.id]) || 0;
      }
      const expenseLines = expenses
        .map((exp) => ({
          itemLabel: exp.itemLabel.trim() || "Expense",
          accountId: exp.accountId,
          amount: typeof exp.amount === "number" ? exp.amount : 0,
          taxPercent: 0,
        }))
        .filter((x) => x.amount > 0);
      const v = priceGoodsReceived({
        grnId: active.grn.id,
        date,
        createdBy: session.id,
        rates: rateNums,
        taxPercent: 0,
        expenses: expenseLines.map((x) => ({ ...x, taxPercent: 0 })),
      });
      setMsg(
        `Purchase bill ${v.number} posted · ${formatInr(v.total)}. Stock was already in.`
      );
      setActiveId("");
      setRates({});
      setExpenses([]);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AccountsShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <AccountsPageHeader
            title={t("accounts.needsPricing")}
            hint={t("accounts.needsPricingHint")}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/accounts/payables"
            className="tt-btn tt-btn-outline"
          >
            {t("accounts.billsPayable")}
          </Link>
          <Link
            href="/admin/accounts/goods-received"
            className="tt-btn tt-btn-outline"
          >
            ← {t("accounts.goodsReceived")}
          </Link>
        </div>
      </div>

      {msg ? <p className="mt-3 text-sm text-[var(--ok)]">{msg}</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      {!queue.length ? (
        <div className="tt-panel mt-5 p-6 text-sm text-[var(--ink-muted)]">
          Nothing waiting. When staff save a goods receipt, it appears here.
        </div>
      ) : (
        <div className="mt-5 grid gap-5 lg:grid-cols-[240px_1fr]">
          <div className="tt-panel h-fit overflow-hidden p-0 lg:sticky lg:top-20">
            <p className="border-b border-[var(--line)] px-3 py-2 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              Queue · {queue.length}
            </p>
            <ul className="max-h-[70vh] space-y-0.5 overflow-y-auto p-2">
              {queue.map((row) => {
                const selected = (active?.grn.id || "") === row.grn.id;
                const bundles = row.grn.lines.reduce(
                  (s, l) => s + (l.qty || 0),
                  0
                );
                return (
                  <li key={row.grn.id}>
                    <button
                      type="button"
                      onClick={() => openPricing(row.grn.id)}
                      className={`flex w-full flex-col rounded-md px-3 py-2.5 text-left text-sm ${
                        selected
                          ? "tt-selected bg-[var(--brand)] text-white"
                          : "hover:bg-[var(--brand-soft)]"
                      }`}
                    >
                      <span className="font-semibold">{row.grn.number}</span>
                      <span
                        className={`text-xs ${selected ? "text-white/80" : "text-[var(--ink-muted)]"}`}
                      >
                        {row.supplierName} · {row.grn.date}
                      </span>
                      <span
                        className={`mt-0.5 text-[11px] ${selected ? "text-white/70" : "text-[var(--ink-muted)]"}`}
                      >
                        {row.grn.lines.length} line
                        {row.grn.lines.length === 1 ? "" : "s"} · {bundles}{" "}
                        bundles
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          {active ? (
            <form onSubmit={onSave} className="space-y-4">
              <div className="tt-panel space-y-4 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-lg font-semibold text-[var(--brand-deep)]">
                      {active.grn.number}
                    </p>
                    <p className="text-sm text-[var(--ink-muted)]">
                      {active.supplierName} · received {active.grn.date}
                      {active.grn.narration
                        ? ` · ${active.grn.narration}`
                        : ""}
                    </p>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">
                      Supplier payable closing:{" "}
                      <strong className="tabular-nums text-[var(--ink)]">
                        {formatInr(supplierClosing)}
                      </strong>
                    </p>
                  </div>
                  {active.grn.packingSlipDataUrl ? (
                    <a
                      href={active.grn.packingSlipDataUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="tt-btn tt-btn-outline"
                    >
                      View packing slip
                    </a>
                  ) : (
                    <span className="text-xs text-[var(--ink-muted)]">
                      No packing slip attached
                    </span>
                  )}
                </div>

                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                      Bundles
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">
                      {totalBundles}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                      Total weight / pcs
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">
                      {totalWeight}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                      Goods + expenses
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular-nums">
                      {formatInr(previewSubtotal)}
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--brand)]/40 bg-[var(--brand-soft)] px-3 py-2.5">
                    <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">
                      Bill total
                    </p>
                    <p className="mt-1 text-xl font-semibold tabular-nums text-[var(--brand-deep)]">
                      {formatInr(previewTotal)}
                    </p>
                  </div>
                </div>

                {active.grn.packingSlipDataUrl?.startsWith("data:image") ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={active.grn.packingSlipDataUrl}
                    alt="Packing slip"
                    className="max-h-48 w-full rounded-lg border border-[var(--line)] object-contain bg-[var(--surface)]"
                  />
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="tt-label">Bill date</label>
                    <input
                      type="date"
                      className="tt-input"
                      value={date}
                      onChange={(e) => setDate(e.target.value)}
                      required
                    />
                  </div>
                </div>
              </div>

              <div className="tt-panel overflow-hidden p-0">
                <p className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
                  Goods — enter rate per kg / pcs
                </p>
                <div className="overflow-x-auto p-4">
                  <table className="tt-table min-w-[680px] w-full">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th className="text-right">Bundles</th>
                        <th className="text-right">Kg / pcs</th>
                        <th className="text-right">Rate (₹)</th>
                        <th className="text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {linePreview.map((l) => (
                        <tr key={l.id}>
                          <td className="font-medium">{l.itemLabel}</td>
                          <td className="text-right tabular-nums">{l.qty}</td>
                          <td className="text-right tabular-nums">
                            {l.measure}
                          </td>
                          <td>
                            <NumberField
                              className="tt-input ml-auto w-32 text-right"
                              value={
                                rates[l.id] === undefined || rates[l.id] === ""
                                  ? ""
                                  : Number(rates[l.id])
                              }
                              emptyAs={null}
                              onValueChange={(v) =>
                                setRates({
                                  ...rates,
                                  [l.id]:
                                    typeof v === "number" ? String(v) : "",
                                })
                              }
                              placeholder="0.00"
                              required
                              autoFocus={linePreview[0]?.id === l.id}
                            />
                            {l.contractRate != null && l.contractRate > 0 ? (
                              <p className="mt-0.5 text-right text-[10px] text-[var(--ink-muted)]">
                                Contract rate {formatInr(l.contractRate)}
                              </p>
                            ) : null}
                          </td>
                          <td className="text-right font-medium tabular-nums">
                            {formatInr(l.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={3} className="text-right text-[var(--ink-muted)]">
                          Goods subtotal
                        </td>
                        <td
                          colSpan={2}
                          className="text-right font-semibold tabular-nums"
                        >
                          {formatInr(goodsSubtotal)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="tt-panel space-y-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">
                      Expenses on this bill
                    </p>
                    <p className="text-xs text-[var(--ink-muted)]">
                      Freight, packing, loading — posted to expense ledgers and
                      added to supplier payable
                    </p>
                  </div>
                  <button
                    type="button"
                    className="tt-btn tt-btn-outline"
                    onClick={() => setExpenses([...expenses, blankExpense()])}
                  >
                    + Add expense
                  </button>
                </div>

                {!expenses.length ? (
                  <div className="flex flex-wrap gap-2">
                    {PURCHASE_CHARGE_PRESETS.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="inline-flex min-h-11 items-center rounded-full border border-[var(--line)] px-3 text-sm hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
                        onClick={() =>
                          setExpenses([
                            {
                              id: crypto.randomUUID(),
                              presetId: p.id,
                              itemLabel: p.label,
                              accountId: p.accountId,
                              amount: "",
                            },
                          ])
                        }
                      >
                        + {p.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {expenses.map((exp, i) => (
                      <div
                        key={exp.id}
                        className="grid gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface-2)]/50 p-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_7rem_auto]"
                      >
                        <div>
                          <label className="tt-label">Type</label>
                          <select
                            className="tt-select"
                            value={exp.presetId}
                            onChange={(e) => {
                              const preset = PURCHASE_CHARGE_PRESETS.find(
                                (p) => p.id === e.target.value
                              );
                              if (!preset) return;
                              const next = [...expenses];
                              next[i] = {
                                ...exp,
                                presetId: preset.id,
                                accountId: preset.accountId,
                                itemLabel: preset.label,
                              };
                              setExpenses(next);
                            }}
                          >
                            {PURCHASE_CHARGE_PRESETS.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="tt-label">Label</label>
                          <input
                            className="tt-input"
                            value={exp.itemLabel}
                            onChange={(e) => {
                              const next = [...expenses];
                              next[i] = {
                                ...exp,
                                itemLabel: e.target.value,
                              };
                              setExpenses(next);
                            }}
                            required
                          />
                        </div>
                        <div>
                          <label className="tt-label">Amount (₹)</label>
                          <NumberField
                            className="tt-input"
                            value={exp.amount}
                            emptyAs={null}
                            onValueChange={(v) => {
                              const next = [...expenses];
                              next[i] = { ...exp, amount: v };
                              setExpenses(next);
                            }}
                            required
                          />
                        </div>
                        <button
                          type="button"
                          className="self-end pb-2 text-sm text-[var(--danger)]"
                          onClick={() =>
                            setExpenses(expenses.filter((x) => x.id !== exp.id))
                          }
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="text-sm font-semibold text-[var(--brand)]"
                      onClick={() =>
                        setExpenses([...expenses, blankExpense()])
                      }
                    >
                      + Another expense
                    </button>
                  </div>
                )}
              </div>

              <div className="tt-panel flex flex-wrap items-end justify-between gap-4 p-5">
                <div className="space-y-1 text-sm">
                  <p className="flex justify-between gap-8">
                    <span className="text-[var(--ink-muted)]">Goods</span>
                    <span className="tabular-nums">
                      {formatInr(goodsSubtotal)}
                    </span>
                  </p>
                  {expenseSubtotal > 0 ? (
                    <p className="flex justify-between gap-8">
                      <span className="text-[var(--ink-muted)]">Expenses</span>
                      <span className="tabular-nums">
                        {formatInr(expenseSubtotal)}
                      </span>
                    </p>
                  ) : null}
                  {Math.abs(previewRoundOff) >= 0.005 ? (
                    <p className="flex justify-between gap-8">
                      <span className="text-[var(--ink-muted)]">Round off</span>
                      <span className="tabular-nums">
                        {previewRoundOff > 0 ? "+" : ""}
                        {formatInr(previewRoundOff)}
                      </span>
                    </p>
                  ) : null}
                  <p className="flex justify-between gap-8 text-base font-semibold text-[var(--brand-deep)]">
                    <span>Bill total</span>
                    <span className="tabular-nums">
                      {formatInr(previewTotal)}
                    </span>
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={`/admin/accounts/vouchers?new=payment&party=${active.po.supplierId}`}
                    className="tt-btn tt-btn-outline"
                  >
                    Pay this supplier
                  </Link>
                  <button type="submit" className="tt-btn tt-btn-dark" disabled={saving}>
                    {saving ? "Saving…" : "Approve & post purchase bill"}
                  </button>
                </div>
              </div>
            </form>
          ) : null}
        </div>
      )}
    </AccountsShell>
  );
}
