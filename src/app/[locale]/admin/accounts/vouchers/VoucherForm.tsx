"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FilePick } from "@/components/FilePick";
import { NumberField } from "@/components/NumberField";
import {
  CreatePartyModal,
  CreateProductModal,
} from "@/components/QuickCreateModals";
import { PackingSlipWeighmentGrid } from "@/components/PackingSlipWeighmentGrid";
import { SearchSelect } from "@/components/SearchSelect";
import { ACCT, SALE_CHARGE_PRESETS, allocateOldestFirst,
  assertPeriodOpen,
  cashBankAccounts,
  openInvoicesForParty,
  partyBalance,
  unallocatedAdvance,
} from "@/lib/accounting";
import {
  catalogRowValue,
  deriveSecondaryQty,
  inventoryRows,
  secondaryPerBundle,
  voucherLineAmount,
} from "@/lib/inventory";
import { applyCatalogToVoucherLine } from "@/lib/voucher-line-catalog";
import { fileToDataUrl, useDb, useSession } from "@/lib/hooks";
import { StaffBillDiscountFields } from "@/components/StaffBillDiscountFields";
import {
  applyBillDiscounts,
  orderDiscountReceiptLabel,
  pickBestOrderDiscount,
  type ManualDiscountKind,
} from "@/lib/schemes";
import { matchVoucherFormHotkey } from "@/lib/accounts-hotkeys";
import { assertPriorMonthAudited } from "@/lib/month-close-policy";
import { attachPackingSlip, canViewFinancials, checkCapability, createVoucher } from "@/lib/store/db";
import type { PackingSlip, PartyType, VoucherLine, VoucherType } from "@/lib/types";
import { formatInr, isSqftUnit, ratePerPacket, ratePerPiece, resolveSqftPack, roundMoney, roundOffRupees, unitLabel } from "@/lib/pricing";
import {
  applySlipKgToVoucherLines,
  assertSaleSlipComplete,
  buildDraftSlipFromSaleLines,
  buildVoucherPackingSlipPdfDataUrl,
  voucherLinesToOrderLines,
} from "@/lib/voucher-packing-slip";
import {
  blankChargeLine,
  blankLine,
  isChargeLine,
  isEmptyItemLine,
  lastEmptyItemIndex,
  lastItemLineIndex,
  mergeFilledItemLine,
  withTrailingBlankItem,
} from "./helpers";

export function VoucherForm({
  type,
  initialPartyId,
  onCancel,
  onSaved,
}: {
  type: VoucherType;
  initialPartyId?: string;
  onCancel: () => void;
  onSaved: (msg: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const lineAmt = (l: VoucherLine) =>
    voucherLineAmount(
      l,
      l.productId ? db?.products.find((p) => p.id === l.productId) : undefined
    );
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [partyId, setPartyId] = useState(initialPartyId || "");
  const [narration, setNarration] = useState("");
  const [cashAccountId, setCashAccountId] = useState<string>(ACCT.cash);
  const [lines, setLines] = useState<VoucherLine[]>([blankLine()]);
  const [packingFile, setPackingFile] = useState<File | null>(null);
  const [linkedInvoiceId, setLinkedInvoiceId] = useState("");
  const [allowOverCredit, setAllowOverCredit] = useState(false);
  const [allocMap, setAllocMap] = useState<Record<string, number>>({});
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [showPartyModal, setShowPartyModal] = useState(false);
  const [productModalLine, setProductModalLine] = useState<number | null>(null);
  const [focusLineId, setFocusLineId] = useState<string | null>(null);
  const [focusNonce, setFocusNonce] = useState(0);
  const lineCatalogRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [saleSlip, setSaleSlip] = useState<PackingSlip | null>(null);
  const [discKind, setDiscKind] = useState<ManualDiscountKind | "">("");
  const [discValue, setDiscValue] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const addLineRef = useRef<() => void>(() => {});

  const dateWarning = useMemo(() => {
    if (!db || !date) return "";
    try {
      assertPeriodOpen(date, db.settings);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    try {
      assertPriorMonthAudited(date, db);
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
    return "";
  }, [db, date]);

  const lineIdentity = lines
    .map(
      (l) =>
        `${l.productId}|${l.variationId}|${l.colorId}|${l.qty}|${l.accountId || ""}`
    )
    .join(";");

  useEffect(() => {
    if (type !== "sale" || !db) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSaleSlip(null);
      return;
    }
    const party = partyId
      ? db.parties.find((p) => p.id === partyId)
      : undefined;
    const next = buildDraftSlipFromSaleLines({
      lines,
      products: db.products,
      party,
      users: db.users,
      previous: saleSlip,
    });
    setSaleSlip(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preserve weighments via previous
  }, [type, db, partyId, lineIdentity]);

  const catalogItems = useMemo(() => (db ? inventoryRows(db) : []), [db]);

  const parties = useMemo(() => {
    if (!db) return [];
    if (type === "sale" || type === "receipt" || type === "credit_note") {
      return db.parties.filter((p) => p.active && p.type === "customer");
    }
    if (type === "purchase" || type === "payment" || type === "debit_note") {
      return db.parties.filter((p) => p.active && p.type === "supplier");
    }
    return db.parties.filter((p) => p.active);
  }, [db, type]);

  const openBills = useMemo(() => {
    if (!db || !partyId) return [];
    if (type === "receipt" || type === "credit_note") {
      return openInvoicesForParty(
        partyId,
        db.vouchers,
        db.billAllocations ?? [],
        date,
        "sale",
        db.orders
      );
    }
    if (type === "payment" || type === "debit_note") {
      return openInvoicesForParty(
        partyId,
        db.vouchers,
        db.billAllocations ?? [],
        date,
        "purchase"
      );
    }
    return [];
  }, [db, partyId, type, date]);

  const paymentAmount =
    type === "receipt" || type === "payment"
      ? roundMoney(lines[0]?.rate || 0)
      : 0;

  useEffect(() => {
    if (type !== "receipt" && type !== "payment") return;
    if (!(paymentAmount > 0) || !openBills.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAllocMap({});
      return;
    }
    setAllocMap(allocateOldestFirst(openBills, paymentAmount));
  }, [type, partyId, paymentAmount, openBills]);

  const advanceAmount = useMemo(
    () =>
      type === "receipt" || type === "payment"
        ? unallocatedAdvance(paymentAmount, allocMap)
        : 0,
    [type, paymentAmount, allocMap]
  );

  const partyClosing = useMemo(() => {
    if (!db || !partyId) return null;
    const party = db.parties.find((p) => p.id === partyId);
    if (!party) return null;
    return partyBalance(party, db.ledgerEntries, date);
  }, [db, partyId, date]);

  useEffect(() => {
    if (!linkedInvoiceId || !db) return;
    if (type !== "credit_note" && type !== "debit_note") return;
    const inv = db.vouchers.find((v) => v.id === linkedInvoiceId);
    if (!inv) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setPartyId(inv.partyId || "");
    setLines(
      inv.lines.map((l) => ({
        ...l,
        id: `vl_${crypto.randomUUID()}`,
      }))
    );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [linkedInvoiceId, db, type]);

  const saleDiscount = useMemo(() => {
    if (type !== "sale" || !db) {
      return {
        applied: applyBillDiscounts({ goodsSubtotal: 0 }),
        schemeLabel: "",
        goodsSubtotal: 0,
      };
    }
    const withAmt = lines.map((l) => ({
      ...l,
      amount: lineAmt(l),
    }));
    const goodsSubtotal = roundMoney(
      withAmt
        .filter((l) => l.productId)
        .reduce((s, l) => s + l.amount, 0)
    );
    const party = partyId
      ? db.parties.find((p) => p.id === partyId)
      : undefined;
    const dealer = party?.linkedUserId
      ? db.users.find((u) => u.id === party.linkedUserId)
      : undefined;
    const orderLines = voucherLinesToOrderLines(withAmt, db.products);
    const best =
      dealer && orderLines.length
        ? pickBestOrderDiscount(
            db.schemes,
            dealer.assignedSchemeIds,
            orderLines,
            db.products
          )
        : null;
    const applied = applyBillDiscounts({
      goodsSubtotal,
      schemeAmount: best?.amount ?? 0,
      manualKind: discKind,
      manualValue: Number(discValue) || 0,
    });
    return {
      applied,
      schemeLabel: best ? orderDiscountReceiptLabel(best, locale) : "",
      goodsSubtotal,
    };
  }, [type, db, lines, partyId, discKind, discValue, locale]);

  const totals = useMemo(() => {
    const withAmt = lines.map((l) => ({
      ...l,
      amount: lineAmt(l),
    }));
    const itemAmt = roundMoney(
      withAmt.filter((l) => !isChargeLine(l)).reduce((s, l) => s + l.amount, 0)
    );
    const chargeAmt = roundMoney(
      withAmt.filter((l) => isChargeLine(l)).reduce((s, l) => s + l.amount, 0)
    );
    const discount = type === "sale" ? saleDiscount.applied.total : 0;
    const subtotal = roundMoney(itemAmt + chargeAmt - discount);
    const taxAmount = roundMoney(
      withAmt.reduce((s, l) => s + l.amount * ((l.taxPercent ?? 0) / 100), 0)
    );
    const exactTotal = roundMoney(subtotal + taxAmount);
    const total = roundOffRupees(exactTotal);
    const roundOff = roundMoney(total - exactTotal);
    return {
      itemAmt,
      chargeAmt,
      discount,
      subtotal,
      taxAmount,
      exactTotal,
      roundOff,
      total,
    };
  }, [lines, type, saleDiscount.applied.total]);

  const catalogOptions = useMemo(() => {
    const rows = type === "sale" ? catalogItems.filter((c) => c.stock > 0) : catalogItems;
    return rows.map((c) => ({
      value: catalogRowValue(c),
      label: `${c.sku} · ${c.name} (${c.stock} bdl / ${c.stockSecondary} ${c.unit})`,
      searchText: `${c.sku} ${c.name}`,
    }));
  }, [catalogItems, type]);

  const partyOptions = useMemo(
    () =>
      parties.map((p) => ({
        value: p.id,
        label: p.name,
        searchText: `${p.name} ${p.phone ?? ""} ${p.gstin ?? ""}`,
      })),
    [parties]
  );

  const showPurchaseRates = session ? canViewFinancials(session.role) : false;

  useEffect(() => {
    if (!focusLineId) return;
    lineCatalogRefs.current[focusLineId]?.focus();
  }, [focusLineId, focusNonce]);

  const catalogFillOpts = {
    catalogItems,
    products: db?.products ?? [],
    type,
    partyId,
    date,
    contracts: db?.supplierContracts,
  };

  const applyLineCatalog = (index: number, val: string) => {
    const current = lines[index];
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
    const next = [...lines];
    next[index] = result.line;
    setLines(result.cleared ? next : withTrailingBlankItem(next));
  };

  const quickAddCatalog = (val: string) => {
    if (!val) return;
    const idx = lastEmptyItemIndex(lines);
    const source = idx >= 0 ? lines[idx]! : blankLine();
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
    setLines(mergeFilledItemLine(lines, result.line));
  };

  const addBlankItemLine = () => {
    const idx = lastEmptyItemIndex(lines);
    if (idx >= 0) {
      setFocusLineId(lines[idx]!.id);
      setFocusNonce((n) => n + 1);
      return;
    }
    const blank = blankLine();
    setLines([...lines, blank]);
    setFocusLineId(blank.id);
    setFocusNonce((n) => n + 1);
  };
  addLineRef.current = addBlankItemLine;

  const onLastItemFieldEnter = (index: number) => {
    if (index !== lastItemLineIndex(lines)) return;
    const row = lines[index];
    if (!row || isEmptyItemLine(row)) return;
    addBlankItemLine();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = matchVoucherFormHotkey(e);
      if (!action) return;
      e.preventDefault();
      e.stopPropagation();
      if (action === "save") formRef.current?.requestSubmit();
      if (action === "add-line") addLineRef.current();
      if (action === "remove-line") {
        setLines((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !db) return;
    setError("");
    setSaving(true);
    try {
      let workingLines: VoucherLine[] = lines
        .filter((l) => !isEmptyItemLine(l))
        .map((l) => ({
          ...l,
          itemLabel: l.itemLabel.trim() || type,
          amount: lineAmt(l),
          taxPercent: 0,
        }))
        .filter(
          (l) =>
            l.amount > 0 || type === "journal" || (type === "sale" && l.qty > 0)
        );

      let filledSaleSlip: PackingSlip | null = null;
      if (type === "sale") {
        const stockCount = workingLines.filter(
          (l) => (!l.accountId || !!l.productId) && l.qty > 0
        ).length;
        if (stockCount > 0) {
          if (!saleSlip) {
            throw new Error("Add items then fill the packing slip weighments");
          }
          assertSaleSlipComplete(saleSlip);
          workingLines = applySlipKgToVoucherLines(workingLines, saleSlip);
          filledSaleSlip = saleSlip;
        }
        const goodsSubtotal = roundMoney(
          workingLines
            .filter((l) => l.productId)
            .reduce((s, l) => s + l.amount, 0)
        );
        const party = partyId
          ? db.parties.find((p) => p.id === partyId)
          : undefined;
        const dealer = party?.linkedUserId
          ? db.users.find((u) => u.id === party.linkedUserId)
          : undefined;
        const orderLines = voucherLinesToOrderLines(workingLines, db.products);
        const best =
          dealer && orderLines.length
            ? pickBestOrderDiscount(
                db.schemes,
                dealer.assignedSchemeIds,
                orderLines,
                db.products
              )
            : null;
        const applied = applyBillDiscounts({
          goodsSubtotal,
          schemeAmount: best?.amount ?? 0,
          manualKind: discKind,
          manualValue: Number(discValue) || 0,
        });
        if (applied.total > 0) {
          const off = roundMoney(applied.total);
          workingLines = [
            ...workingLines,
            {
              id: `vl_${crypto.randomUUID()}`,
              itemLabel: locale === "hi" ? "बिल छूट" : "Bill discount",
              accountId: ACCT.sales,
              qty: 1,
              secondaryQty: 1,
              rate: -off,
              amount: -off,
              taxPercent: 0,
            },
          ];
        }
      }

      let packingSlipDataUrl: string | undefined;
      let packingSlipName: string | undefined;
      if (packingFile && (type === "purchase" || type === "debit_note")) {
        packingSlipDataUrl = await fileToDataUrl(packingFile);
        packingSlipName = packingFile.name;
      }
      const allocations = Object.entries(allocMap)
        .filter(([, amt]) => amt > 0)
        .map(([invoiceVoucherId, amount]) => ({
          invoiceVoucherId,
          amount: roundMoney(amount),
        }));

      const advanceLeft =
        type === "receipt" || type === "payment"
          ? unallocatedAdvance(roundMoney(workingLines[0]?.rate || 0), allocMap)
          : 0;
      const narrationWithAdvance =
        advanceLeft > 0.009
          ? `${narration.trim() ? `${narration.trim()} · ` : ""}Advance ${formatInr(advanceLeft, locale)} on-account`
          : narration;

      const saved = createVoucher({
        type,
        date,
        dueDate: type === "sale" || type === "purchase" ? dueDate : undefined,
        partyId: partyId || undefined,
        narration: narrationWithAdvance,
        lines: workingLines,
        cashAccountId:
          type === "receipt" || type === "payment" ? cashAccountId : undefined,
        linkedInvoiceId: type === "credit_note" ? linkedInvoiceId : undefined,
        linkedPurchaseId: type === "debit_note" ? linkedInvoiceId : undefined,
        packingSlipDataUrl,
        packingSlipName,
        createdBy: session.id,
        allocations:
          type === "receipt" || type === "payment" ? allocations : undefined,
        allowOverCredit: type === "sale" ? allowOverCredit : undefined,
        skipInventory:
          type === "receipt" || type === "payment" || type === "journal",
      });

      let savedMsg =
        locale === "hi" ? "वाउचर सेव हो गया" : "Voucher saved";
      if (type === "sale") {
        try {
          const pdf = buildVoucherPackingSlipPdfDataUrl(
            saved,
            {
              products: db.products,
              parties: db.parties,
              users: db.users,
              settings: db.settings,
            },
            "en",
            filledSaleSlip
          );
          const name = `${saved.number}-packing-slip.pdf`;
          attachPackingSlip(saved.id, { dataUrl: pdf, name });
          const a = document.createElement("a");
          a.href = pdf;
          a.download = name;
          a.click();
          savedMsg = `Voucher saved · packing slip ${name} generated`;
        } catch (slipErr) {
          savedMsg = `Voucher saved · packing slip skipped: ${
            slipErr instanceof Error ? slipErr.message : "Failed"
          }`;
        }
      }
      refresh();
      onSaved(savedMsg);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  const stockForm =
    type === "sale" ||
    type === "purchase" ||
    type === "credit_note" ||
    type === "debit_note";

  return (
    <>
      <form
        ref={formRef}
        onSubmit={onSubmit}
        className="tt-panel mt-5 space-y-5 p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
          <h2 className="text-lg font-semibold capitalize text-[var(--brand-deep)]">
            {type === "credit_note"
              ? t("accounts.postReturn")
              : type.replace("_", " ")}
          </h2>
          <button
            type="button"
            className="tt-btn tt-btn-outline"
            onClick={onCancel}
          >
            {t("common.cancel")}
          </button>
        </div>

        {(type === "credit_note" || type === "debit_note") && (
          <div>
            <label className="tt-label">
              {type === "credit_note"
                ? t("accounts.linkInvoice")
                : t("accounts.linkPurchase")}
            </label>
            <SearchSelect
              value={linkedInvoiceId}
              onChange={setLinkedInvoiceId}
              required
              placeholder={
                locale === "hi" ? "इनवॉइस खोजें…" : "Search invoice…"
              }
              options={(db?.vouchers ?? [])
                .filter(
                  (v) =>
                    !v.voided &&
                    v.type === (type === "credit_note" ? "sale" : "purchase")
                )
                .map((v) => {
                  const party =
                    db?.parties.find((p) => p.id === v.partyId)?.name || "";
                  const amt =
                    type === "debit_note" && !showPurchaseRates
                      ? ""
                      : formatInr(v.total, locale);
                  return {
                    value: v.id,
                    label: [v.number, v.date, party, amt]
                      .filter(Boolean)
                      .join(" · "),
                    searchText: `${v.number} ${v.date} ${party}`,
                  };
                })}
            />
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="tt-label">{t("common.date")}</label>
            <input
              type="date"
              className="tt-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
            {dateWarning ? (
              <p className="mt-1 text-xs font-medium text-[var(--danger)]">
                {dateWarning}
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
                {locale === "hi"
                  ? "Ctrl+S सेव · Ctrl+Enter लाइन · Alt+Delete हटाएँ"
                  : "Ctrl+S save · Ctrl+Enter add line · Alt+Delete remove"}
              </p>
            )}
          </div>
          {type === "sale" || type === "purchase" ? (
            <div>
              <label className="tt-label">{t("accounts.dueDate")}</label>
              <input
                type="date"
                className="tt-input"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                required
              />
            </div>
          ) : null}
          <div>
            <div className="mb-1 flex items-center justify-between gap-2">
              <label className="tt-label mb-0">{t("common.party")}</label>
              {type === "sale" ||
              type === "purchase" ||
              type === "receipt" ||
              type === "payment" ||
              type === "credit_note" ||
              type === "debit_note" ? (
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-deep)] underline"
                  onClick={() => setShowPartyModal(true)}
                >
                  + New party
                </button>
              ) : null}
            </div>
            <SearchSelect
              options={partyOptions}
              value={partyId}
              onChange={(v) => {
                setPartyId(v);
                setAllocMap({});
              }}
              placeholder="Search party…"
              emptyLabel="Select party…"
              required={type !== "journal"}
            />
          </div>
          {type === "receipt" || type === "payment" ? (
            <div>
              <label className="tt-label">Cash / Bank</label>
              <select
                className="tt-select"
                value={cashAccountId}
                onChange={(e) => setCashAccountId(e.target.value)}
              >
                {cashBankAccounts(db?.accounts ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name.en}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="tt-label">{t("common.narration")}</label>
              <input
                className="tt-input"
                value={narration}
                onChange={(e) => setNarration(e.target.value)}
              />
            </div>
          )}
        </div>
        {stockForm ? (
          <p className="text-xs text-[var(--ink-muted)]">
            {locale === "hi"
              ? "राशि = रेट × किग्रा/पीस। प्रत्येक लाइन पर रेट एडिट करें।"
              : "Amount = rate × kg/pcs. Edit the rate on each line."}
          </p>
        ) : null}

        {type === "sale" ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={allowOverCredit}
              onChange={(e) => setAllowOverCredit(e.target.checked)}
            />
            {t("accounts.allowOverCredit")}
          </label>
        ) : null}

        {stockForm && (
          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              Line items
            </p>
            <div className="sticky top-0 z-20 rounded-xl border border-[var(--brand)]/30 bg-white/95 p-3 shadow-sm backdrop-blur">
              <label className="tt-label" htmlFor="voucher-quick-add">
                {t("accounts.quickAddItem")}
              </label>
              <SearchSelect
                id="voucher-quick-add"
                options={catalogOptions}
                value=""
                onChange={quickAddCatalog}
                placeholder={
                  type === "sale"
                    ? "Search in-stock item…"
                    : "Search item…"
                }
                allowClear={false}
                keepFocusOnPick
              />
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {t("accounts.quickAddItemHint")}
              </p>
            </div>
            {lines.map((l, i) => {
              const charge = isChargeLine(l);
              const product =
                !charge && l.productId && db
                  ? db.products.find((p) => p.id === l.productId)
                  : undefined;
              const hideRates =
                (type === "purchase" || type === "debit_note") &&
                !showPurchaseRates;
              const filledItemCount = lines.filter(
                (x) => !isChargeLine(x) && !isEmptyItemLine(x)
              ).length;

              if (charge) {
                return (
                  <div
                    key={l.id}
                    className="rounded-xl border border-[var(--brand)]/30 bg-[var(--brand-soft)]/40 p-3"
                  >
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-[var(--brand-deep)]">
                        Charge · {l.itemLabel || "Recovery"}
                      </span>
                      <button
                        type="button"
                        className="inline-flex min-h-11 items-center px-2 text-sm text-[var(--danger)]"
                        onClick={() =>
                          setLines(lines.filter((x) => x.id !== l.id))
                        }
                      >
                        Remove
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="tt-label">Label</label>
                        <input
                          className="tt-input"
                          value={l.itemLabel}
                          onChange={(e) => {
                            const next = [...lines];
                            next[i] = { ...l, itemLabel: e.target.value };
                            setLines(next);
                          }}
                          required
                        />
                      </div>
                      <div>
                        <label className="tt-label">Amount (₹)</label>
                        <NumberField
                          className="tt-input"
                          emptyAs={null}
                          value={l.rate}
                          onValueChange={(v) => {
                            const rate = typeof v === "number" ? v : 0;
                            const updated = {
                              ...l,
                              qty: 1,
                              secondaryQty: 1,
                              rate,
                              amount: rate,
                            };
                            const next = [...lines];
                            next[i] = updated;
                            setLines(next);
                          }}
                        />
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end text-sm tabular-nums">
                      <span className="text-[var(--ink-muted)]">
                        Billed to customer ·{" "}
                      </span>
                      <strong className="ml-1">
                        {formatInr(lineAmt(l), locale)}
                      </strong>
                    </div>
                  </div>
                );
              }

              const applyCatalog = (val: string) => applyLineCatalog(i, val);

              return (
                <div
                  key={l.id}
                  className="rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 p-3"
                >
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[var(--ink-muted)]">
                      Item {i + 1}
                    </span>
                    <button
                      type="button"
                      className="inline-flex min-h-11 items-center px-2 text-sm text-[var(--danger)]"
                      onClick={() =>
                        setLines(lines.filter((x) => x.id !== l.id))
                      }
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-12">
                    <div className="lg:col-span-4">
                      <div className="mb-1 flex items-center justify-between gap-2">
                        <label className="tt-label mb-0">Catalog item</label>
                        <button
                          type="button"
                          className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-deep)] underline"
                          onClick={() => setProductModalLine(i)}
                        >
                          + New item
                        </button>
                      </div>
                      <SearchSelect
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
                        onChange={applyCatalog}
                        placeholder={
                          type === "sale"
                            ? "Search in-stock item…"
                            : "Search item…"
                        }
                        emptyLabel="Manual / no stock link"
                        autoFocus={l.id === focusLineId}
                        inputRef={(el) => {
                          lineCatalogRefs.current[l.id] = el;
                        }}
                      />
                    </div>
                    <div className="lg:col-span-3">
                      <label className="tt-label">Label</label>
                      <input
                        className="tt-input"
                        value={l.itemLabel}
                        onChange={(e) => {
                          const next = [...lines];
                          next[i] = { ...l, itemLabel: e.target.value };
                          setLines(next);
                        }}
                        required={!isEmptyItemLine(l) || filledItemCount === 0}
                      />
                    </div>
                    <div className="lg:col-span-1">
                      <label className="tt-label">{t("common.bundles")}</label>
                      <NumberField
                        className="tt-input"
                        integer
                        emptyAs={null}
                        value={l.qty}
                        onValueChange={(v) => {
                          const qty = typeof v === "number" ? v : 0;
                          const prod = l.productId
                            ? db?.products.find((p) => p.id === l.productId)
                            : undefined;
                          const secondaryQty = prod
                            ? deriveSecondaryQty(prod, qty, l.variationId)
                            : l.secondaryQty ?? qty;
                          const updated = {
                            ...l,
                            qty,
                            secondaryQty,
                            amount: 0,
                          };
                          updated.amount = lineAmt(updated);
                          const next = [...lines];
                          next[i] = updated;
                          setLines(next);
                        }}
                      />
                    </div>
                    <div className="lg:col-span-2">
                      <label className="tt-label">
                        Kg / Pcs
                        <span className="ml-1 font-normal normal-case tracking-normal text-[var(--ink-muted)]">
                          (
                          {isSqftUnit(l.unit)
                            ? locale === "hi"
                              ? "पीस"
                              : "pcs"
                            : l.unit
                              ? unitLabel(l.unit, locale)
                              : "kg/pcs"}
                          )
                        </span>
                      </label>
                      {type === "sale" ? (
                        <p className="flex min-h-11 items-center text-sm tabular-nums text-[var(--ink-muted)]">
                          {l.secondaryQty != null && l.secondaryQty > 0
                            ? l.secondaryQty
                            : "From packing slip ↓"}
                        </p>
                      ) : (
                        <NumberField
                          className="tt-input"
                          value={l.secondaryQty ?? ""}
                          emptyAs={null}
                          onValueChange={(v) => {
                            const secondaryQty = typeof v === "number" ? v : 0;
                            const updated = {
                              ...l,
                              secondaryQty,
                              amount: 0,
                            };
                            updated.amount = lineAmt(updated);
                            const next = [...lines];
                            next[i] = updated;
                            setLines(next);
                          }}
                          onKeyDown={
                            hideRates
                              ? (e) => {
                                  if (e.key !== "Enter") return;
                                  e.preventDefault();
                                  onLastItemFieldEnter(i);
                                }
                              : undefined
                          }
                        />
                      )}
                      {product && l.unit === "kg" && type !== "sale" ? (
                        <p className="mt-0.5 text-[10px] text-[var(--ink-muted)]">
                          ≈{secondaryPerBundle(product, l.variationId)} kg/bdl
                        </p>
                      ) : null}
                    </div>
                    <div className="lg:col-span-1">
                      <label className="tt-label">
                        {isSqftUnit(l.unit) ? "₹ / sqft" : "Rate"}
                      </label>
                      {hideRates ? (
                        <p className="flex min-h-11 items-center text-sm text-[var(--ink-muted)]">
                          ••••
                        </p>
                      ) : (
                        <NumberField
                          className="tt-input"
                          emptyAs={null}
                          value={l.rate}
                          onValueChange={(v) => {
                            const rate = typeof v === "number" ? v : 0;
                            const updated = { ...l, rate, amount: 0 };
                            updated.amount = lineAmt(updated);
                            const next = [...lines];
                            next[i] = updated;
                            setLines(next);
                          }}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter") return;
                            e.preventDefault();
                            onLastItemFieldEnter(i);
                          }}
                        />
                      )}
                      {!hideRates &&
                      product &&
                      isSqftUnit(l.unit) &&
                      l.rate > 0 ? (
                        <p className="mt-0.5 text-[10px] text-[var(--ink-muted)]">
                          {(() => {
                            const spec = resolveSqftPack(
                              product,
                              l.variationId
                                ? product.variations.find(
                                    (v) => v.id === l.variationId
                                  )
                                : undefined
                            );
                            return `${formatInr(ratePerPiece(l.rate, spec.lengthFt, spec.widthFt), locale)}/pc · ${formatInr(ratePerPacket(l.rate, spec.lengthFt, spec.widthFt, spec.pcsPerPacket), locale)}/pkt`;
                          })()}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end text-sm tabular-nums">
                    <span className="text-[var(--ink-muted)]">Amount · </span>
                    <strong className="ml-1">
                      {hideRates
                        ? "••••"
                        : formatInr(lineAmt(l), locale)}
                    </strong>
                  </div>
                </div>
              );
            })}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                onClick={addBlankItemLine}
              >
                + {t("accounts.addItem")}
              </button>
              {(type === "sale" || type === "credit_note") &&
                SALE_CHARGE_PRESETS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className="tt-btn tt-btn-outline"
                    onClick={() => setLines([...lines, blankChargeLine(p)])}
                  >
                    + {p.label}
                  </button>
                ))}
            </div>
            {type === "sale" ? (
              <StaffBillDiscountFields
                goodsSubtotal={saleDiscount.goodsSubtotal}
                schemeAmount={saleDiscount.applied.schemeAmount}
                schemeLabel={saleDiscount.schemeLabel}
                kind={discKind}
                value={discValue}
                onKindChange={setDiscKind}
                onValueChange={setDiscValue}
                locale={locale}
                allowManual={checkCapability(session, db, "view_financials")}
              />
            ) : null}
            {type === "sale" ? (
              <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface-2)]/40 p-3">
                <p className="text-sm font-semibold text-[var(--brand-deep)]">
                  2. Fill packing slip (required before save)
                </p>
                {saleSlip ? (
                  <PackingSlipWeighmentGrid
                    slip={saleSlip}
                    onChange={setSaleSlip}
                    locale={locale}
                  />
                ) : (
                  <p className="text-sm text-[var(--ink-muted)]">
                    Add catalog items and bundles above to open the weighment
                    grid.
                  </p>
                )}
              </div>
            ) : type === "purchase" || type === "debit_note" ? (
              <FilePick
                kind="photoOrPdf"
                value={packingFile}
                onChange={(files) => setPackingFile(files[0] ?? null)}
                label="Bill / packing photo (optional)"
              />
            ) : null}
          </div>
        )}

        {(type === "receipt" || type === "payment") && (
          <div className="space-y-3">
            <div>
              <label className="tt-label">{t("common.amount")}</label>
              <NumberField
                className="tt-input max-w-xs"
                value={lines[0]?.rate || ""}
                emptyAs={null}
                onValueChange={(v) => {
                  const rate = typeof v === "number" ? v : 0;
                  setLines([
                    {
                      id: lines[0]?.id || `vl_${crypto.randomUUID()}`,
                      itemLabel: type,
                      qty: 1,
                      rate,
                      amount: rate,
                      taxPercent: 0,
                    },
                  ]);
                }}
                required
              />
            </div>
            <input
              className="tt-input"
              placeholder="Narration"
              value={narration}
              onChange={(e) => setNarration(e.target.value)}
            />
            {partyId && (type === "receipt" || type === "payment") ? (
              <p className="text-sm text-[var(--ink-muted)]">
                {type === "payment" ? "Supplier payable" : "Receivable"} closing:{" "}
                <strong className="tabular-nums text-[var(--ink)]">
                  {type === "payment" && !showPurchaseRates
                    ? "••••"
                    : formatInr(partyClosing ?? 0, locale)}
                </strong>
                {" · "}
                Open bills: {openBills.length}
              </p>
            ) : null}
            {partyId && openBills.length ? (
              <div className="overflow-x-auto rounded-xl border border-[var(--line)] p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {t("accounts.allocateBills")}
                    <span className="ml-2 text-xs font-normal text-[var(--ink-muted)]">
                      Auto: oldest → newest
                    </span>
                  </p>
                  <button
                    type="button"
                    className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-deep)] underline"
                    onClick={() =>
                      setAllocMap(allocateOldestFirst(openBills, paymentAmount))
                    }
                  >
                    Re-allocate FIFO
                  </button>
                </div>
                <table className="tt-table mt-2 min-w-[560px]">
                  <thead>
                    <tr>
                      <th>{t("common.bill")}</th>
                      <th>Date</th>
                      <th>{t("accounts.outstanding")}</th>
                      <th>{t("common.allocate")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {openBills.map((row) => (
                      <tr key={row.voucher.id}>
                        <td className="font-mono text-sm">
                          {row.voucher.number}
                        </td>
                        <td className="text-sm">{row.voucher.date}</td>
                        <td>
                          {type === "payment" && !showPurchaseRates
                            ? "••••"
                            : formatInr(row.outstanding, locale)}
                        </td>
                        <td>
                          <NumberField
                            className="tt-input w-28"
                            min={0}
                            max={row.outstanding}
                            emptyAs={null}
                            value={allocMap[row.voucher.id] ?? ""}
                            onValueChange={(v) =>
                              setAllocMap({
                                ...allocMap,
                                [row.voucher.id]: typeof v === "number" ? v : 0,
                              })
                            }
                            onBlur={() => {
                              const cur = allocMap[row.voucher.id] ?? 0;
                              const clamped = Math.max(
                                0,
                                Math.min(row.outstanding, cur)
                              );
                              if (clamped !== cur) {
                                setAllocMap({
                                  ...allocMap,
                                  [row.voucher.id]: clamped,
                                });
                              }
                            }}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {advanceAmount > 0.009 ? (
                  <p className="mt-3 rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-sm text-[var(--brand-deep)]">
                    Excess {formatInr(advanceAmount, locale)} treated as{" "}
                    <strong>advance / on-account</strong>
                    {type === "payment"
                      ? " (reduces supplier payable)"
                      : " (customer credit)"}
                    .
                  </p>
                ) : null}
              </div>
            ) : partyId &&
              (type === "receipt" || type === "payment") &&
              paymentAmount > 0 ? (
              <p className="rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-sm text-[var(--brand-deep)]">
                No open bills — full {formatInr(paymentAmount, locale)} posts as{" "}
                <strong>advance / on-account</strong>.
              </p>
            ) : null}
          </div>
        )}

        {(type === "purchase" || type === "debit_note") && !showPurchaseRates ? (
          <p className="text-xs text-[var(--ink-muted)]">
            {locale === "hi"
              ? "खरीद रेट / राशि केवल मालिक देख सकता है"
              : "Purchase rates & amounts are owner-only"}
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-[var(--surface-2)] px-4 py-3 text-sm">
            {(type === "sale" || type === "credit_note") &&
            (totals.chargeAmt > 0 || (totals.discount || 0) > 0) ? (
              <>
                <span>
                  Items{" "}
                  <strong className="tabular-nums">
                    {formatInr(totals.itemAmt, locale)}
                  </strong>
                </span>
                {totals.chargeAmt > 0 ? (
                  <span>
                    Charges{" "}
                    <strong className="tabular-nums">
                      {formatInr(totals.chargeAmt, locale)}
                    </strong>
                  </span>
                ) : null}
                {(totals.discount || 0) > 0 ? (
                  <span className="text-[var(--ok)]">
                    {locale === "hi" ? "बिल छूट" : "Bill discount"}{" "}
                    <strong className="tabular-nums">
                      −{formatInr(totals.discount, locale)}
                    </strong>
                  </span>
                ) : null}
              </>
            ) : (
              <span>
                Subtotal{" "}
                <strong className="tabular-nums">
                  {formatInr(totals.subtotal, locale)}
                </strong>
              </span>
            )}
            {Math.abs(totals.roundOff) >= 0.005 ? (
              <span>
                Round off{" "}
                <strong className="tabular-nums">
                  {totals.roundOff > 0 ? "+" : ""}
                  {formatInr(totals.roundOff, locale)}
                </strong>
              </span>
            ) : null}
            <span className="text-base">
              Total{" "}
              <strong className="tabular-nums text-[var(--brand-deep)]">
                {formatInr(totals.total, locale)}
              </strong>
            </span>
          </div>
        )}
        <div className="tt-sticky-bar flex flex-wrap items-center justify-between gap-3">
          {error ? (
            <p className="text-sm text-[var(--danger)]">{error}</p>
          ) : (type === "purchase" || type === "debit_note") &&
            !showPurchaseRates ? (
            <span />
          ) : (
            <span className="text-sm text-[var(--ink-muted)]">
              Total{" "}
              <strong className="tabular-nums text-[var(--brand-deep)]">
                {formatInr(totals.total, locale)}
              </strong>
            </span>
          )}
          <button
            type="submit"
            className="tt-btn tt-btn-dark min-w-[8rem]"
            disabled={saving}
          >
            {saving ? t("accounts.saving") : t("common.save")}
          </button>
        </div>
      </form>

      {showPartyModal ? (
        <CreatePartyModal
          defaultType={
            type === "purchase" || type === "payment" || type === "debit_note"
              ? "supplier"
              : ("customer" as PartyType)
          }
          onClose={() => setShowPartyModal(false)}
          onCreated={(party) => {
            setPartyId(party.id);
            setAllocMap({});
          }}
        />
      ) : null}

      {productModalLine != null ? (
        <CreateProductModal
          onClose={() => setProductModalLine(null)}
          onCreated={(product, variationId) => {
            const i = productModalLine;
            if (type === "sale") {
              const stock = product.variations.find((v) => v.id === variationId)
                ?.stock;
              const matrixStock =
                product.colors[0] && variationId
                  ? product.stockMatrix?.[
                      `${variationId}__${product.colors[0].id}`
                    ]
                  : undefined;
              const avail = matrixStock ?? stock ?? product.stock ?? 0;
              if (!(avail > 0)) {
                setError(
                  "New item has 0 stock — add opening stock or receive goods before selling"
                );
                setProductModalLine(null);
                return;
              }
            }
            const variation = product.variations.find(
              (v) => v.id === variationId
            );
            const qty = lines[i]?.qty || 1;
            const secondaryQty = deriveSecondaryQty(product, qty, variationId);
            const rate = isSqftUnit(product.unit)
              ? resolveSqftPack(product, variation).ratePerSqft
              : variation?.rate ?? product.baseRate ?? 0;
            const updated: VoucherLine = {
              ...(lines[i] || blankLine()),
              productId: product.id,
              variationId,
              colorId: product.colors[0]?.id,
              itemLabel: product.name.en,
              unit: product.unit,
              qty,
              secondaryQty,
              rate,
              amount: 0,
              accountId: undefined,
            };
            updated.amount = lineAmt(updated);
            const next = [...lines];
            next[i] = updated;
            setLines(next);
            setProductModalLine(null);
          }}
        />
      ) : null}
    </>
  );
}
