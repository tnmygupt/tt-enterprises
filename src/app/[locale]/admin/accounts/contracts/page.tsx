"use client";

import { FormEvent, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { ExportButtons } from "@/components/ExportButtons";
import { AccountsShell } from "@/components/AccountsShell";
import { NumberField } from "@/components/NumberField";
import {
  contractLockMode,
  contractQtyLeft,
  contractValueLeft,
  groupContractsByNumber,
  isContractOpen,
} from "@/lib/contracts";
import { inventoryRows } from "@/lib/inventory";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr, unitLabel } from "@/lib/pricing";
import {
  canViewFinancials,
  createSupplierContractBatch,
  checkCapability,
  upsertSupplierContract,
} from "@/lib/store/db";
import type {
  ContractLockMode,
  ContractScope,
  UnitOfSale,
} from "@/lib/types";
import { categoryLabel } from "@/lib/categories";

type DraftLine = {
  id: string;
  scope: ContractScope;
  categoryId: string;
  productKey: string;
  rate: string;
  contractedQty: string;
  contractedValue: string;
  unit: UnitOfSale;
};

function blankLine(): DraftLine {
  return {
    id: crypto.randomUUID(),
    scope: "product",
    categoryId: "tarpaulin",
    productKey: "",
    rate: "",
    contractedQty: "",
    contractedValue: "",
    unit: "kg",
  };
}

export default function ContractsPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const showRate = session ? canViewFinancials(session.role) : false;
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [header, setHeader] = useState({
    supplierId: "",
    date: new Date().toISOString().slice(0, 10),
    validFrom: new Date().toISOString().slice(0, 10),
    validTo: "",
    lockMode: "qty" as ContractLockMode,
    narration: "",
  });
  const [lines, setLines] = useState<DraftLine[]>([blankLine()]);

  const catalog = useMemo(() => (db ? inventoryRows(db) : []), [db]);
  const suppliers =
    db?.parties.filter((p) => p.active && p.type === "supplier") ?? [];
  const contracts = useMemo(
    () => db?.supplierContracts ?? [],
    [db]
  );
  const groups = useMemo(
    () => groupContractsByNumber(contracts),
    [contracts]
  );

  const exportOptions = useMemo(
    () => ({
      title: t("contracts.title"),
      subtitle: new Date().toLocaleDateString(
        locale === "hi" ? "hi-IN" : "en-IN"
      ),
      filename: `contracts-${new Date().toISOString().slice(0, 10)}.pdf`,
      columns: showRate
        ? [
            "No.",
            "Supplier",
            "Lock",
            "Scope",
            "Item",
            "Rate",
            "Contract Qty",
            "Used",
            "Qty Left",
            "₹ Left",
          ]
        : [
            "No.",
            "Supplier",
            "Lock",
            "Scope",
            "Item",
            "Contract Qty",
            "Used",
            "Qty Left",
          ],
      rows: contracts.map((c) => {
        const sup = db?.parties.find((p) => p.id === c.supplierId);
        const left = contractQtyLeft(c);
        const row: (string | number)[] = [
          c.number,
          sup?.name || "—",
          contractLockMode(c),
          c.scope,
          c.itemLabel,
        ];
        if (showRate) {
          row.push(`${formatInr(c.rate, locale)}/${unitLabel(c.unit, locale)}`);
        }
        row.push(
          `${c.contractedQty} ${unitLabel(c.unit, locale)}`,
          c.usedQty,
          `${left} ${unitLabel(c.unit, locale)}`
        );
        if (showRate) row.push(formatInr(contractValueLeft(c), locale));
        return row;
      }),
    }),
    [contracts, db, locale, showRate, t]
  );

  if (
    !session ||
    !checkCapability(session, db?.users, "manage_contracts")
  ) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      if (!showRate) {
        throw new Error(
          locale === "hi"
            ? "केवल मालिक रेट सेट कर सकता है"
            : "Only owner can set contract rates"
        );
      }
      const batchLines = lines.map((line) => {
        let productId: string | undefined;
        let variationId: string | undefined;
        let itemLabel = "";
        let unit = line.unit;
        if (line.scope === "product") {
          const [pid, vid] = line.productKey.split("|");
          productId = pid;
          variationId = vid || undefined;
          const row = catalog.find(
            (c) =>
              c.productId === pid && (c.variationId ?? "") === (vid || "")
          );
          const product = db?.products.find((p) => p.id === pid);
          itemLabel = row?.name || "";
          unit = product?.unit || unit;
        } else {
          itemLabel =
            categoryLabel(db?.categories, line.categoryId, locale) ||
            line.categoryId;
        }
        return {
          scope: line.scope,
          categoryId: line.scope === "category" ? line.categoryId : undefined,
          productId,
          variationId,
          itemLabel,
          rate: Number(line.rate) || 0,
          unit,
          contractedQty: Number(line.contractedQty) || 0,
          contractedValue:
            header.lockMode === "value"
              ? Number(line.contractedValue) ||
                (Number(line.contractedQty) || 0) * (Number(line.rate) || 0)
              : undefined,
        };
      });
      const created = createSupplierContractBatch({
        supplierId: header.supplierId,
        date: header.date,
        validFrom: header.validFrom,
        validTo: header.validTo || undefined,
        lockMode: header.lockMode,
        narration: header.narration,
        createdBy: session.id,
        lines: batchLines,
      });
      setMsg(
        locale === "hi"
          ? `${created[0]?.number} · ${created.length} लाइन सेव`
          : `${created[0]?.number} · ${created.length} lines saved`
      );
      setLines([blankLine()]);
      setHeader((h) => ({ ...h, narration: "" }));
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <AccountsShell>
      <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)]">
        {t("contracts.title")}
      </h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        {locale === "hi"
          ? "एक कॉन्ट्रैक्ट नंबर पर कई आइटम / कैटेगरी — qty या ₹ लॉक"
          : "Many items / categories under one contract number — qty or ₹ lock"}
      </p>

      {showRate ? (
        <form
          onSubmit={onCreate}
          className="mt-4 grid max-w-4xl gap-3 rounded-2xl border border-[var(--line)] bg-white p-5 sm:grid-cols-2"
        >
          <p className="sm:col-span-2 text-xs font-bold uppercase text-[var(--ink-muted)]">
            {t("contracts.new")}
          </p>
          <select
            className="tt-select"
            value={header.supplierId}
            onChange={(e) =>
              setHeader({ ...header, supplierId: e.target.value })
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
          <select
            className="tt-select"
            value={header.lockMode}
            onChange={(e) =>
              setHeader({
                ...header,
                lockMode: e.target.value as ContractLockMode,
              })
            }
          >
            <option value="qty">
              {locale === "hi" ? "Qty लॉक (किग्रा/पीस)" : "Qty lock (kg/pcs)"}
            </option>
            <option value="value">
              {locale === "hi" ? "₹ लॉक (मूल्य)" : "₹ lock (value)"}
            </option>
          </select>
          <div>
            <label className="tt-label">{t("common.validFrom")}</label>
            <input
              type="date"
              className="tt-input"
              value={header.validFrom}
              onChange={(e) =>
                setHeader({ ...header, validFrom: e.target.value })
              }
              required
            />
          </div>
          <div>
            <label className="tt-label">{t("common.validTo")}</label>
            <input
              type="date"
              className="tt-input"
              value={header.validTo}
              onChange={(e) =>
                setHeader({ ...header, validTo: e.target.value })
              }
            />
          </div>
          <input
            className="tt-input sm:col-span-2"
            placeholder={t("common.narration")}
            value={header.narration}
            onChange={(e) =>
              setHeader({ ...header, narration: e.target.value })
            }
          />

          <div className="sm:col-span-2 space-y-3">
            <p className="text-xs font-bold uppercase text-[var(--ink-muted)]">
              {locale === "hi" ? "लाइनें" : "Lines"}
            </p>
            {lines.map((line, idx) => (
              <div
                key={line.id}
                className="grid gap-2 rounded-xl border border-[var(--line)] p-3 sm:grid-cols-6"
              >
                <select
                  className="tt-select sm:col-span-2"
                  value={line.scope}
                  onChange={(e) => {
                    const scope = e.target.value as ContractScope;
                    setLines((cur) =>
                      cur.map((l, i) =>
                        i === idx ? { ...l, scope } : l
                      )
                    );
                  }}
                >
                  <option value="product">{t("contracts.itemLevel")}</option>
                  <option value="category">
                    {t("contracts.categoryLevel")}
                  </option>
                </select>
                {line.scope === "category" ? (
                  <select
                    className="tt-select sm:col-span-2"
                    value={line.categoryId}
                    onChange={(e) =>
                      setLines((cur) =>
                        cur.map((l, i) =>
                          i === idx
                            ? { ...l, categoryId: e.target.value }
                            : l
                        )
                      )
                    }
                  >
                    {(db?.categories ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name[locale] || c.name.en}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    className="tt-select sm:col-span-2"
                    value={line.productKey}
                    onChange={(e) =>
                      setLines((cur) =>
                        cur.map((l, i) =>
                          i === idx
                            ? { ...l, productKey: e.target.value }
                            : l
                        )
                      )
                    }
                    required
                  >
                    <option value="">{t("contracts.pickItem")}…</option>
                    {catalog.map((c) => (
                      <option
                        key={`${c.productId}-${c.variationId ?? ""}-${c.colorId ?? ""}`}
                        value={`${c.productId}|${c.variationId ?? ""}`}
                      >
                        {c.sku} · {c.name}
                      </option>
                    ))}
                  </select>
                )}
                <NumberField
                  className="tt-input"
                  min={0}
                  step="0.01"
                  placeholder={t("contracts.rate")}
                  value={line.rate}
                  emptyAs={null}
                  onValueChange={(v) =>
                    setLines((cur) =>
                      cur.map((l, i) =>
                        i === idx
                          ? { ...l, rate: v === "" ? "" : String(v) }
                          : l
                      )
                    )
                  }
                  required
                />
                {header.lockMode === "value" ? (
                  <NumberField
                    className="tt-input"
                    min={0}
                    step="0.01"
                    placeholder={locale === "hi" ? "₹ मूल्य" : "₹ value"}
                    value={line.contractedValue}
                    emptyAs={null}
                    onValueChange={(v) =>
                      setLines((cur) =>
                        cur.map((l, i) =>
                          i === idx
                            ? {
                                ...l,
                                contractedValue: v === "" ? "" : String(v),
                              }
                            : l
                        )
                      )
                    }
                    required
                  />
                ) : (
                  <NumberField
                    className="tt-input"
                    min={0}
                    step="0.01"
                    placeholder={t("contracts.contractQty")}
                    value={line.contractedQty}
                    emptyAs={null}
                    onValueChange={(v) =>
                      setLines((cur) =>
                        cur.map((l, i) =>
                          i === idx
                            ? {
                                ...l,
                                contractedQty: v === "" ? "" : String(v),
                              }
                            : l
                        )
                      )
                    }
                    required
                  />
                )}
                <button
                  type="button"
                  className="tt-btn tt-btn-outline text-xs"
                  disabled={lines.length <= 1}
                  onClick={() =>
                    setLines((cur) => cur.filter((_, i) => i !== idx))
                  }
                >
                  {locale === "hi" ? "हटाएँ" : "Remove"}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={() => setLines((cur) => [...cur, blankLine()])}
            >
              {locale === "hi" ? "+ लाइन" : "+ Add line"}
            </button>
          </div>

          {error ? (
            <p className="sm:col-span-2 text-sm text-[var(--danger)]">{error}</p>
          ) : null}
          {msg ? (
            <p className="sm:col-span-2 text-sm text-[var(--ok)]">{msg}</p>
          ) : null}
          <button type="submit" className="tt-btn tt-btn-dark sm:col-span-2">
            {t("common.save")}
          </button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">
          {t("contracts.staffViewHint")}
        </p>
      )}

      <div className="mt-4 print:hidden">
        <ExportButtons options={exportOptions} disabled={!contracts.length} />
      </div>

      <div className="mt-6 space-y-4">
        {groups.map((g) => {
          const sup = db?.parties.find(
            (p) => p.id === g.lines[0]?.supplierId
          );
          const qtyLeftSum = g.lines.reduce(
            (s, c) => s + contractQtyLeft(c),
            0
          );
          const valueLeftSum = g.lines.reduce(
            (s, c) => s + contractValueLeft(c),
            0
          );
          return (
            <div key={g.number} className="tt-panel overflow-x-auto">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
                <div>
                  <p className="font-mono font-semibold">{g.number}</p>
                  <p className="text-sm text-[var(--ink-muted)]">
                    {sup?.name || "—"} · {g.lines.length}{" "}
                    {locale === "hi" ? "लाइन" : "lines"} ·{" "}
                    {contractLockMode(g.lines[0])} lock
                  </p>
                </div>
                <p className="text-sm font-semibold text-[var(--brand-deep)]">
                  {locale === "hi" ? "बाकी" : "Left"}: {qtyLeftSum.toFixed(2)}{" "}
                  {showRate
                    ? `· ${formatInr(valueLeftSum, locale)}`
                    : null}
                </p>
              </div>
              <table className="tt-table min-w-[860px]">
                <thead>
                  <tr>
                    <th>{t("contracts.scope")}</th>
                    <th>{t("common.item")}</th>
                    {showRate ? <th>{t("contracts.rate")}</th> : null}
                    <th>{t("contracts.contractQty")}</th>
                    <th>{t("contracts.used")}</th>
                    <th>{t("contracts.qtyLeft")}</th>
                    {showRate ? <th>₹ left</th> : null}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {g.lines.map((c) => {
                    const left = contractQtyLeft(c);
                    const open = isContractOpen(c);
                    return (
                      <tr key={c.id} className={!c.active ? "opacity-50" : ""}>
                        <td className="capitalize">{c.scope}</td>
                        <td className="text-sm">{c.itemLabel}</td>
                        {showRate ? (
                          <td>
                            {formatInr(c.rate, locale)}/
                            {unitLabel(c.unit, locale)}
                          </td>
                        ) : null}
                        <td>
                          {c.contractedQty} {unitLabel(c.unit, locale)}
                          {contractLockMode(c) === "value" && showRate ? (
                            <span className="block text-xs text-[var(--ink-muted)]">
                              {formatInr(c.contractedValue || 0, locale)}
                            </span>
                          ) : null}
                        </td>
                        <td>{c.usedQty}</td>
                        <td
                          className={`font-semibold ${
                            left <= 0 ? "text-[var(--danger)]" : ""
                          }`}
                        >
                          {left} {unitLabel(c.unit, locale)}
                          {!open ? (
                            <span className="ml-1 text-xs text-[var(--ink-muted)]">
                              ({locale === "hi" ? "बंद" : "closed"})
                            </span>
                          ) : null}
                        </td>
                        {showRate ? (
                          <td className="font-semibold">
                            {formatInr(contractValueLeft(c), locale)}
                          </td>
                        ) : null}
                        <td>
                          {showRate ? (
                            <button
                              type="button"
                              className="text-xs text-[var(--brand)]"
                              onClick={() => {
                                upsertSupplierContract({
                                  ...c,
                                  active: !c.active,
                                });
                                refresh();
                              }}
                            >
                              {c.active
                                ? t("contracts.deactivate")
                                : t("contracts.activate")}
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
        {!contracts.length ? (
          <p className="p-4 text-sm text-[var(--ink-muted)]">
            {t("common.empty")}
          </p>
        ) : null}
      </div>
    </AccountsShell>
  );
}
