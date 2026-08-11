"use client";

import { FormEvent, Suspense, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { NumberField } from "@/components/NumberField";
import {
  CreatePartyModal,
  CreateProductModal,
} from "@/components/QuickCreateModals";
import { PackingSlipWeighmentGrid } from "@/components/PackingSlipWeighmentGrid";
import { SearchSelect } from "@/components/SearchSelect";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import {
  ACCT,
  SALE_CHARGE_PRESETS,
  allocateOldestFirst,
  cashBankAccounts,
  openInvoicesForParty,
  partyBalance,
  unallocatedAdvance,
} from "@/lib/accounting";
import { resolveOpenContract } from "@/lib/contracts";
import {
  catalogRowValue,
  deriveSecondaryQty,
  inventoryRows,
  parseCatalogRowValue,
  secondaryPerBundle,
  voucherLineAmount,
} from "@/lib/inventory";
import { fileToDataUrl, useDb, useSession } from "@/lib/hooks";
import { formatInr, roundMoney, roundOffRupees, unitLabel } from "@/lib/pricing";
import {
  attachPackingSlip,
  canViewFinancials,
  createVoucher,
  checkCapability,
  voidVoucher,
} from "@/lib/store/db";
import type { PackingSlip, PartyType, VoucherLine, VoucherType } from "@/lib/types";
import {
  applySlipKgToVoucherLines,
  assertSaleSlipComplete,
  buildDraftSlipFromSaleLines,
  buildVoucherPackingSlipPdfDataUrl,
} from "@/lib/voucher-packing-slip";
import { notifyPackingSlipWhatsApp } from "@/lib/whatsapp";

function blankLine(): VoucherLine {
  return {
    id: `vl_${crypto.randomUUID()}`,
    itemLabel: "",
    qty: 1,
    rate: 0,
    amount: 0,
    taxPercent: 0,
  };
}

function blankChargeLine(preset: {
  accountId: string;
  label: string;
}): VoucherLine {
  return {
    id: `vl_${crypto.randomUUID()}`,
    itemLabel: preset.label,
    accountId: preset.accountId,
    qty: 1,
    secondaryQty: 1,
    rate: 0,
    amount: 0,
    taxPercent: 0,
  };
}

function isChargeLine(l: VoucherLine): boolean {
  return !!l.accountId && !l.productId;
}

function VouchersInner({
  onFormOpenChange,
}: {
  onFormOpenChange?: (open: boolean) => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const search = useSearchParams();
  const { session } = useSession();
  const { db, refresh } = useDb();
  const initialNew = (search.get("new") as VoucherType | null) || null;

  const [showForm, setShowForm] = useState<VoucherType | null>(initialNew);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState(new Date().toISOString().slice(0, 10));
  const [partyId, setPartyId] = useState(search.get("party") || "");
  const [narration, setNarration] = useState("");
  const [cashAccountId, setCashAccountId] = useState<string>(ACCT.cash);
  const [lines, setLines] = useState<VoucherLine[]>([blankLine()]);
  const [packingFile, setPackingFile] = useState<File | null>(null);
  const [linkedInvoiceId, setLinkedInvoiceId] = useState("");
  const [allowOverCredit, setAllowOverCredit] = useState(false);
  const [allocMap, setAllocMap] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [listQ, setListQ] = useState(search.get("q") || "");
  const [showPartyModal, setShowPartyModal] = useState(false);
  const [productModalLine, setProductModalLine] = useState<number | null>(
    null
  );
  const [saleSlip, setSaleSlip] = useState<PackingSlip | null>(null);
  const [viewId, setViewId] = useState<string | null>(search.get("id"));

  useEffect(() => {
    // URL query drives initial form state — intentional sync
    /* eslint-disable react-hooks/set-state-in-effect */
    const p = search.get("party");
    if (p) setPartyId(p);
    const n = search.get("new") as VoucherType | null;
    if (n) {
      setShowForm(n);
      setViewId(null);
    }
    const qq = search.get("q");
    if (qq) setListQ(qq);
    const id = search.get("id");
    if (id) {
      setViewId(id);
      setShowForm(null);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [search]);

  useEffect(() => {
    onFormOpenChange?.(!!showForm);
  }, [showForm, onFormOpenChange]);

  // Rebuild draft packing slip when sale lines / party change
  useEffect(() => {
    if (showForm !== "sale" || !db) {
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
  }, [
    showForm,
    db,
    partyId,
    // Rebuild when item identity / bundles change
    lines
      .map(
        (l) =>
          `${l.productId}|${l.variationId}|${l.colorId}|${l.qty}|${l.accountId || ""}`
      )
      .join(";"),
  ]);

  const viewing = useMemo(
    () =>
      viewId && db
        ? db.vouchers.find((v) => v.id === viewId) || null
        : null,
    [db, viewId]
  );

  const listedVouchers = useMemo(() => {
    const all = db?.vouchers ?? [];
    const qq = listQ.trim().toLowerCase();
    if (!qq) return all;
    return all.filter((v) => {
      const party = db?.parties.find((p) => p.id === v.partyId);
      return `${v.number} ${v.type} ${v.narration ?? ""} ${party?.name ?? ""}`
        .toLowerCase()
        .includes(qq);
    });
  }, [db, listQ]);

  const catalogItems = useMemo(
    () => (db ? inventoryRows(db) : []),
    [db]
  );

  const parties = useMemo(() => {
    if (!db || !showForm) return [];
    if (
      showForm === "sale" ||
      showForm === "receipt" ||
      showForm === "credit_note"
    ) {
      return db.parties.filter((p) => p.active && p.type === "customer");
    }
    if (
      showForm === "purchase" ||
      showForm === "payment" ||
      showForm === "debit_note"
    ) {
      return db.parties.filter((p) => p.active && p.type === "supplier");
    }
    return db.parties.filter((p) => p.active);
  }, [db, showForm]);

  const openBills = useMemo(() => {
    if (!db || !partyId) return [];
    if (showForm === "receipt" || showForm === "credit_note") {
      return openInvoicesForParty(
        partyId,
        db.vouchers,
        db.billAllocations ?? [],
        date,
        "sale"
      );
    }
    if (showForm === "payment" || showForm === "debit_note") {
      return openInvoicesForParty(
        partyId,
        db.vouchers,
        db.billAllocations ?? [],
        date,
        "purchase"
      );
    }
    return [];
  }, [db, partyId, showForm, date]);

  const paymentAmount =
    showForm === "receipt" || showForm === "payment"
      ? roundMoney(lines[0]?.rate || 0)
      : 0;

  // FIFO: oldest bill first; leftover stays as advance / on-account
  useEffect(() => {
    if (showForm !== "receipt" && showForm !== "payment") return;
    if (!(paymentAmount > 0) || !openBills.length) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAllocMap({});
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAllocMap(allocateOldestFirst(openBills, paymentAmount));
  }, [showForm, partyId, paymentAmount, openBills]);

  const advanceAmount = useMemo(
    () =>
      showForm === "receipt" || showForm === "payment"
        ? unallocatedAdvance(paymentAmount, allocMap)
        : 0,
    [showForm, paymentAmount, allocMap]
  );

  const partyClosing = useMemo(() => {
    if (!db || !partyId) return null;
    const party = db.parties.find((p) => p.id === partyId);
    if (!party) return null;
    return partyBalance(party, db.ledgerEntries, date);
  }, [db, partyId, date]);

  useEffect(() => {
    if (!linkedInvoiceId || !db) return;
    if (showForm !== "credit_note" && showForm !== "debit_note") return;
    const inv = db.vouchers.find((v) => v.id === linkedInvoiceId);
    if (!inv) return;
    // Pre-fill from linked invoice — intentional sync
    /* eslint-disable react-hooks/set-state-in-effect */
    setPartyId(inv.partyId || "");
    setLines(
      inv.lines.map((l) => ({
        ...l,
        id: `vl_${crypto.randomUUID()}`,
      }))
    );
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [linkedInvoiceId, db, showForm]);

  const totals = useMemo(() => {
    const withAmt = lines.map((l) => ({
      ...l,
      amount: voucherLineAmount(l),
    }));
    const itemAmt = roundMoney(
      withAmt
        .filter((l) => !isChargeLine(l))
        .reduce((s, l) => s + l.amount, 0)
    );
    const chargeAmt = roundMoney(
      withAmt.filter((l) => isChargeLine(l)).reduce((s, l) => s + l.amount, 0)
    );
    const subtotal = roundMoney(itemAmt + chargeAmt);
    const taxAmount = roundMoney(
      withAmt.reduce(
        (s, l) => s + l.amount * ((l.taxPercent ?? 0) / 100),
        0
      )
    );
    const exactTotal = roundMoney(subtotal + taxAmount);
    const total = roundOffRupees(exactTotal);
    const roundOff = roundMoney(total - exactTotal);
    return {
      itemAmt,
      chargeAmt,
      subtotal,
      taxAmount,
      exactTotal,
      roundOff,
      total,
    };
  }, [lines]);

  const catalogOptions = useMemo(() => {
    const rows =
      showForm === "sale"
        ? catalogItems.filter((c) => c.stock > 0)
        : catalogItems;
    return rows.map((c) => ({
      value: catalogRowValue(c),
      label: `${c.sku} · ${c.name} (${c.stock} bdl / ${c.stockSecondary} ${c.unit})`,
      searchText: `${c.sku} ${c.name}`,
    }));
  }, [catalogItems, showForm]);

  const partyOptions = useMemo(
    () =>
      parties.map((p) => ({
        value: p.id,
        label: p.name,
        searchText: `${p.name} ${p.phone ?? ""} ${p.gstin ?? ""}`,
      })),
    [parties]
  );

  // Purchase rates & amounts are owner-only (staff see quantities, not cost)
  const showPurchaseRates = session
    ? canViewFinancials(session.role)
    : false;

  const voucherExportOptions = useMemo(
    () => ({
      title: t("accounts.vouchers"),
      subtitle: new Date().toLocaleDateString(locale === "hi" ? "hi-IN" : "en-IN"),
      filename: `vouchers-${new Date().toISOString().slice(0, 10)}.pdf`,
      columns: ["No.", "Date", "Type", "Party", "Total", "Outstanding"],
      rows: (db?.vouchers ?? [])
        .filter((v) => !v.voided)
        .map((v) => {
          const party =
            db?.parties.find((p) => p.id === v.partyId)?.name || "—";
          const hideAmt =
            (v.type === "purchase" || v.type === "debit_note") &&
            !showPurchaseRates;
          return [
            v.number,
            v.date,
            v.type.replace("_", " "),
            party,
            hideAmt ? "••••" : formatInr(v.total, locale),
            v.type === "sale" || v.type === "purchase"
              ? hideAmt
                ? "••••"
                : formatInr(v.outstanding ?? v.total, locale)
              : "—",
          ];
        }),
    }),
    [db, locale, showPurchaseRates, t]
  );

  if (!session || !checkCapability(session, db?.users, "manage_accounts")) {
    return <AdminAccessDenied />;
  }

  const openForm = (type: VoucherType) => {
    // Purchase cost, supplier payments and debit notes stay owner-only
    if (
      (type === "purchase" || type === "payment" || type === "debit_note") &&
      !canViewFinancials(session.role)
    ) {
      setError("Only the owner can enter purchase rates and supplier payments");
      return;
    }
    setShowForm(type);
    setPartyId(search.get("party") || "");
    setNarration("");
    setDueDate(new Date().toISOString().slice(0, 10));
    setLines([blankLine()]);
    setPackingFile(null);
    setLinkedInvoiceId("");
    setAllowOverCredit(false);
    setAllocMap({});
    setError("");
    setMsg("");
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!showForm || !session || !db) return;
    setError("");
    try {
      let workingLines = lines
        .map((l) => ({
          ...l,
          itemLabel: l.itemLabel.trim() || showForm,
          amount: voucherLineAmount(l),
        }))
        .filter((l) => l.amount > 0 || showForm === "journal" || (showForm === "sale" && l.qty > 0));

      let filledSaleSlip: PackingSlip | null = null;
      if (showForm === "sale") {
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
      }

      let packingSlipDataUrl: string | undefined;
      let packingSlipName: string | undefined;
      // Purchase / debit note: optional bill photo upload
      if (
        packingFile &&
        (showForm === "purchase" || showForm === "debit_note")
      ) {
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
        showForm === "receipt" || showForm === "payment"
          ? unallocatedAdvance(roundMoney(workingLines[0]?.rate || 0), allocMap)
          : 0;
      const narrationWithAdvance =
        advanceLeft > 0.009
          ? `${narration.trim() ? `${narration.trim()} · ` : ""}Advance ${formatInr(advanceLeft, locale)} on-account`
          : narration;

      const saved = createVoucher({
        type: showForm,
        date,
        dueDate:
          showForm === "sale" || showForm === "purchase" ? dueDate : undefined,
        partyId: partyId || undefined,
        narration: narrationWithAdvance,
        lines: workingLines,
        cashAccountId:
          showForm === "receipt" || showForm === "payment"
            ? cashAccountId
            : undefined,
        linkedInvoiceId:
          showForm === "credit_note" ? linkedInvoiceId : undefined,
        linkedPurchaseId:
          showForm === "debit_note" ? linkedInvoiceId : undefined,
        packingSlipDataUrl,
        packingSlipName,
        createdBy: session.id,
        allocations:
          showForm === "receipt" || showForm === "payment"
            ? allocations
            : undefined,
        allowOverCredit: showForm === "sale" ? allowOverCredit : undefined,
        skipInventory:
          showForm === "receipt" ||
          showForm === "payment" ||
          showForm === "journal",
      });

      // Sale: PDF from the filled packing slip
      if (showForm === "sale") {
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
          setMsg(`Voucher saved · packing slip ${name} generated`);
        } catch (slipErr) {
          setMsg(
            `Voucher saved · packing slip skipped: ${
              slipErr instanceof Error ? slipErr.message : "Failed"
            }`
          );
        }
      } else {
        setMsg(locale === "hi" ? "वाउचर सेव हो गया" : "Voucher saved");
      }
      setShowForm(null);
      setPackingFile(null);
      setSaleSlip(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    }
  };

  const stockForm =
    showForm === "sale" ||
    showForm === "purchase" ||
    showForm === "credit_note" ||
    showForm === "debit_note";

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--ink)]">
            {t("accounts.vouchers")}
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            Everyday New sale is an order + packing slip. This page is for
            free-form vouchers and money entries.
          </p>
        </div>
        {!showForm ? (
          <div className="flex flex-wrap gap-2">
            <ExportButtons options={voucherExportOptions} />
            <Link href="/admin/orders/new" className="tt-btn tt-btn-dark">
              New sale
            </Link>
            <Link
              href="/admin/accounts/vouchers?new=sale"
              className="tt-btn tt-btn-outline"
              onClick={(e) => {
                e.preventDefault();
                openForm("sale");
              }}
            >
              Sale voucher
            </Link>
            <Link
              href="/admin/accounts/vouchers?new=credit_note"
              className="tt-btn tt-btn-outline"
              onClick={(e) => {
                e.preventDefault();
                openForm("credit_note");
              }}
            >
              {t("accounts.postReturn")}
            </Link>
            <Link
              href="/admin/accounts/party-statement?type=customer"
              className="tt-btn tt-btn-outline"
            >
              {t("accounts.customerLedger")}
            </Link>
            <select
              className="tt-select max-w-[200px]"
              defaultValue=""
              onChange={(e) => {
                const v = e.target.value as VoucherType;
                if (v) openForm(v);
                e.target.value = "";
              }}
            >
              <option value="">{t("accounts.newVoucher")}…</option>
              {showPurchaseRates ? (
                <option value="purchase">{t("accounts.newPurchase")}</option>
              ) : null}
              <option value="receipt">{t("accounts.newReceipt")}</option>
              {showPurchaseRates ? (
                <option value="payment">{t("accounts.newPayment")}</option>
              ) : null}
              <option value="credit_note">{t("accounts.postReturn")}</option>
              {showPurchaseRates ? (
                <option value="debit_note">{t("accounts.debitNote")}</option>
              ) : null}
            </select>
          </div>
        ) : null}
      </div>
      {msg ? <p className="mt-3 text-sm text-[var(--ok)]">{msg}</p> : null}

      {showForm ? (
        <form
          onSubmit={onSubmit}
          className="tt-panel mt-5 space-y-5 p-5 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] pb-3">
            <h2 className="text-lg font-semibold capitalize text-[var(--brand-deep)]">
              {showForm === "credit_note"
                ? t("accounts.postReturn")
                : showForm.replace("_", " ")}
            </h2>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={() => setShowForm(null)}
            >
              {t("common.cancel")}
            </button>
          </div>

          {(showForm === "credit_note" || showForm === "debit_note") && (
            <div>
              <label className="tt-label">
                {showForm === "credit_note"
                  ? t("accounts.linkInvoice")
                  : t("accounts.linkPurchase")}
              </label>
              <select
                className="tt-select"
                value={linkedInvoiceId}
                onChange={(e) => setLinkedInvoiceId(e.target.value)}
                required
              >
                <option value="">{t("common.select")}</option>
                {(db?.vouchers ?? [])
                  .filter(
                    (v) =>
                      !v.voided &&
                      v.type ===
                        (showForm === "credit_note" ? "sale" : "purchase")
                  )
                  .map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.number} · {v.date}
                      {showForm === "debit_note" && !showPurchaseRates
                        ? ""
                        : ` · ${formatInr(v.total, locale)}`}
                    </option>
                  ))}
              </select>
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
            </div>
            {showForm === "sale" || showForm === "purchase" ? (
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
                {showForm === "sale" ||
                showForm === "purchase" ||
                showForm === "receipt" ||
                showForm === "payment" ||
                showForm === "credit_note" ||
                showForm === "debit_note" ? (
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
                required={showForm !== "journal"}
              />
            </div>
            {showForm === "receipt" || showForm === "payment" ? (
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

          {showForm === "sale" ? (
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
              {lines.map((l, i) => {
                const charge = isChargeLine(l);
                const product =
                  !charge && l.productId && db
                    ? db.products.find((p) => p.id === l.productId)
                    : undefined;
                const hideRates =
                  (showForm === "purchase" || showForm === "debit_note") &&
                  !showPurchaseRates;

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
                        <div>
                          <label className="tt-label">Tax %</label>
                          <NumberField
                            className="tt-input"
                            emptyAs={null}
                            value={l.taxPercent ?? 0}
                            onValueChange={(v) => {
                              const next = [...lines];
                              next[i] = {
                                ...l,
                                taxPercent: typeof v === "number" ? v : 0,
                              };
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
                          {formatInr(voucherLineAmount(l), locale)}
                        </strong>
                      </div>
                    </div>
                  );
                }

                const applyCatalog = (val: string) => {
                  const next = [...lines];
                  if (!val) {
                    next[i] = {
                      ...l,
                      productId: undefined,
                      variationId: undefined,
                      colorId: undefined,
                      unit: undefined,
                      accountId: undefined,
                    };
                    setLines(next);
                    return;
                  }
                  const {
                    productId,
                    variationId,
                    colorId,
                  } = parseCatalogRowValue(val);
                  const item = catalogItems.find(
                    (c) =>
                      c.productId === productId &&
                      (c.variationId ?? "") === (variationId || "") &&
                      (c.colorId ?? "") === (colorId || "")
                  );
                  if (
                    showForm === "sale" &&
                    item &&
                    !(item.stock > 0)
                  ) {
                    setError(`Out of stock: ${item.name}`);
                    return;
                  }
                  const prod = db?.products.find((p) => p.id === productId);
                  const variation = prod?.variations.find(
                    (v) => v.id === variationId
                  );
                  const contract =
                    showForm === "purchase" && partyId
                      ? resolveOpenContract(
                          db?.supplierContracts ?? [],
                          db?.products ?? [],
                          partyId,
                          productId,
                          date,
                          { variationId: variationId || undefined }
                        )
                      : undefined;
                  const rate =
                    contract?.rate ??
                    variation?.rate ??
                    prod?.baseRate ??
                    l.rate;
                  const qty = l.qty || 1;
                  const unit = prod?.unit;
                  const secondaryQty = prod
                    ? deriveSecondaryQty(prod, qty, variationId || undefined)
                    : qty;
                  const updated = {
                    ...l,
                    productId,
                    variationId: variationId || undefined,
                    colorId: colorId || undefined,
                    accountId: undefined,
                    itemLabel: item?.name || l.itemLabel,
                    unit,
                    qty,
                    secondaryQty,
                    rate,
                    amount: 0,
                  };
                  updated.amount = voucherLineAmount(updated);
                  next[i] = updated;
                  setLines(next);
                };

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
                            showForm === "sale"
                              ? "Search in-stock item…"
                              : "Search item…"
                          }
                          emptyLabel="Manual / no stock link"
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
                          required
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
                            updated.amount = voucherLineAmount(updated);
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
                            ({l.unit ? unitLabel(l.unit, locale) : "kg/pcs"})
                          </span>
                        </label>
                        {showForm === "sale" ? (
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
                              const secondaryQty =
                                typeof v === "number" ? v : 0;
                              const updated = {
                                ...l,
                                secondaryQty,
                                amount: 0,
                              };
                              updated.amount = voucherLineAmount(updated);
                              const next = [...lines];
                              next[i] = updated;
                              setLines(next);
                            }}
                          />
                        )}
                        {product && l.unit === "kg" && showForm !== "sale" ? (
                          <p className="mt-0.5 text-[10px] text-[var(--ink-muted)]">
                            ≈{secondaryPerBundle(product, l.variationId)} kg/bdl
                          </p>
                        ) : null}
                      </div>
                      <div className="lg:col-span-1">
                        <label className="tt-label">Rate</label>
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
                              updated.amount = voucherLineAmount(updated);
                              const next = [...lines];
                              next[i] = updated;
                              setLines(next);
                            }}
                          />
                        )}
                      </div>
                      <div className="lg:col-span-1">
                        <label className="tt-label">Tax %</label>
                        <NumberField
                          className="tt-input"
                          emptyAs={null}
                          value={l.taxPercent ?? 0}
                          onValueChange={(v) => {
                            const next = [...lines];
                            next[i] = {
                              ...l,
                              taxPercent: typeof v === "number" ? v : 0,
                            };
                            setLines(next);
                          }}
                        />
                      </div>
                    </div>
                    <div className="mt-2 flex justify-end text-sm tabular-nums">
                      <span className="text-[var(--ink-muted)]">Amount · </span>
                      <strong className="ml-1">
                        {hideRates
                          ? "••••"
                          : formatInr(voucherLineAmount(l), locale)}
                      </strong>
                    </div>
                  </div>
                );
              })}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="tt-btn tt-btn-outline"
                  onClick={() => setLines([...lines, blankLine()])}
                >
                  + Add item
                </button>
                {(showForm === "sale" || showForm === "credit_note") &&
                  SALE_CHARGE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="tt-btn tt-btn-outline"
                      onClick={() =>
                        setLines([...lines, blankChargeLine(p)])
                      }
                    >
                      + {p.label}
                    </button>
                  ))}
              </div>
              {showForm === "sale" ? (
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
              ) : showForm === "purchase" || showForm === "debit_note" ? (
                <div>
                  <label className="tt-label">
                    Bill / packing photo (optional)
                  </label>
                  <input
                    type="file"
                    accept="image/*,.pdf"
                    className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-[var(--brand-soft)] file:px-3 file:py-2 file:text-sm file:font-semibold file:text-[var(--brand-deep)]"
                    onChange={(e) =>
                      setPackingFile(e.target.files?.[0] ?? null)
                    }
                  />
                </div>
              ) : null}
            </div>
          )}

          {(showForm === "receipt" || showForm === "payment") && (
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
                        itemLabel: showForm,
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
              {partyId && (showForm === "receipt" || showForm === "payment") ? (
                <p className="text-sm text-[var(--ink-muted)]">
                  {showForm === "payment" ? "Supplier payable" : "Receivable"}{" "}
                  closing:{" "}
                  <strong className="tabular-nums text-[var(--ink)]">
                    {showForm === "payment" && !showPurchaseRates
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
                        setAllocMap(
                          allocateOldestFirst(openBills, paymentAmount)
                        )
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
                            {showForm === "payment" && !showPurchaseRates
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
                                  [row.voucher.id]:
                                    typeof v === "number" ? v : 0,
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
                      {showForm === "payment"
                        ? " (reduces supplier payable)"
                        : " (customer credit)"}
                      .
                    </p>
                  ) : null}
                </div>
              ) : partyId &&
                (showForm === "receipt" || showForm === "payment") &&
                paymentAmount > 0 ? (
                <p className="rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-sm text-[var(--brand-deep)]">
                  No open bills — full {formatInr(paymentAmount, locale)} posts
                  as <strong>advance / on-account</strong>.
                </p>
              ) : null}
            </div>
          )}

          {!(
            (showForm === "purchase" || showForm === "debit_note") &&
            !showPurchaseRates
          ) ? (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl bg-[var(--surface-2)] px-4 py-3 text-sm">
              {(showForm === "sale" || showForm === "credit_note") &&
              totals.chargeAmt > 0 ? (
                <>
                  <span>
                    Items{" "}
                    <strong className="tabular-nums">
                      {formatInr(totals.itemAmt, locale)}
                    </strong>
                  </span>
                  <span>
                    Charges{" "}
                    <strong className="tabular-nums">
                      {formatInr(totals.chargeAmt, locale)}
                    </strong>
                  </span>
                </>
              ) : (
                <span>
                  Subtotal{" "}
                  <strong className="tabular-nums">
                    {formatInr(totals.subtotal, locale)}
                  </strong>
                </span>
              )}
              <span>
                Tax{" "}
                <strong className="tabular-nums">
                  {formatInr(totals.taxAmount, locale)}
                </strong>
              </span>
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
          ) : (
            <p className="text-xs text-[var(--ink-muted)]">
              {locale === "hi"
                ? "खरीद रेट / राशि केवल मालिक देख सकता है"
                : "Purchase rates & amounts are owner-only"}
            </p>
          )}
          <div className="tt-sticky-bar flex flex-wrap items-center justify-between gap-3">
            {error ? (
              <p className="text-sm text-[var(--danger)]">{error}</p>
            ) : (showForm === "purchase" || showForm === "debit_note") &&
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
            <button type="submit" className="tt-btn tt-btn-dark min-w-[8rem]">
              {t("common.save")}
            </button>
          </div>
        </form>
      ) : null}

      {showForm ? null : viewing ? (
        <div className="tt-panel mt-6 space-y-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-[var(--ink-muted)]">
                Voucher
              </p>
              <h2 className="tt-display text-3xl text-[var(--brand-deep)]">
                {viewing.number}
              </h2>
              <p className="mt-1 text-sm capitalize text-[var(--ink-muted)]">
                {viewing.type.replace("_", " ")} · {viewing.date}
                {viewing.voided ? " · VOIDED" : ""}
              </p>
            </div>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={() => setViewId(null)}
            >
              Close
            </button>
          </div>
          <dl className="grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-[var(--ink-muted)]">Party</dt>
              <dd className="font-medium">
                {db?.parties.find((p) => p.id === viewing.partyId)?.name || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-[var(--ink-muted)]">Total</dt>
              <dd className="font-semibold tabular-nums">
                {(viewing.type === "purchase" ||
                  viewing.type === "debit_note") &&
                !showPurchaseRates
                  ? "••••"
                  : formatInr(viewing.total, locale)}
              </dd>
            </div>
            {viewing.roundOff != null &&
            Math.abs(viewing.roundOff) >= 0.005 &&
            !(
              (viewing.type === "purchase" || viewing.type === "debit_note") &&
              !showPurchaseRates
            ) ? (
              <div>
                <dt className="text-[var(--ink-muted)]">Round off</dt>
                <dd className="tabular-nums">
                  {viewing.roundOff > 0 ? "+" : ""}
                  {formatInr(viewing.roundOff, locale)}
                </dd>
              </div>
            ) : null}
            {viewing.narration ? (
              <div className="sm:col-span-2">
                <dt className="text-[var(--ink-muted)]">Narration</dt>
                <dd>{viewing.narration}</dd>
              </div>
            ) : null}
          </dl>
          <div className="overflow-x-auto">
            <table className="tt-table min-w-[480px]">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Qty</th>
                  <th>Kg/Pcs</th>
                  <th>Rate</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {viewing.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.itemLabel}</td>
                    <td className="tabular-nums">{l.qty}</td>
                    <td className="tabular-nums">{l.secondaryQty ?? "—"}</td>
                    <td className="tabular-nums">
                      {(viewing.type === "purchase" ||
                        viewing.type === "debit_note") &&
                      !showPurchaseRates
                        ? "••••"
                        : formatInr(l.rate, locale)}
                    </td>
                    <td className="tabular-nums">
                      {(viewing.type === "purchase" ||
                        viewing.type === "debit_note") &&
                      !showPurchaseRates
                        ? "••••"
                        : formatInr(l.amount, locale)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {viewing.packingSlipDataUrl ? (
            <a
              href={viewing.packingSlipDataUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-block font-semibold text-[var(--brand-deep)] underline"
            >
              {viewing.packingSlipName || "Open packing slip PDF"}
            </a>
          ) : null}
          {!viewing.voided ? (
            <button
              type="button"
              className="tt-btn tt-btn-outline text-[var(--danger)]"
              onClick={() => {
                if (!confirm(`Void ${viewing.number}?`)) return;
                try {
                  voidVoucher(viewing.id, session?.id || "system");
                  setMsg(`Voided ${viewing.number}`);
                  setViewId(null);
                  refresh();
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Void failed");
                }
              }}
            >
              Void voucher
            </button>
          ) : null}
        </div>
      ) : null}

      {showForm || viewing ? null : (
        <>
          <div className="mt-6 flex flex-wrap gap-3">
            <input
              className="tt-input min-w-[200px]"
              placeholder="Filter vouchers…"
              value={listQ}
              onChange={(e) => setListQ(e.target.value)}
            />
          </div>

          <div className="tt-panel mt-3 overflow-x-auto">
            <table className="tt-table min-w-[900px]">
              <thead>
                <tr>
                  <th>No.</th>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Party</th>
                  <th>Total</th>
                  <th>{t("accounts.outstanding")}</th>
                  <th>{t("accounts.packingSlip")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {listedVouchers.map((v) => {
                  const party = db?.parties.find((p) => p.id === v.partyId);
                  return (
                    <tr
                      key={v.id}
                      className={v.voided ? "opacity-50 line-through" : ""}
                    >
                      <td>
                        <button
                          type="button"
                          className="font-mono text-sm font-semibold text-[var(--brand-deep)] underline"
                          onClick={() => setViewId(v.id)}
                        >
                          {v.number}
                        </button>
                      </td>
                      <td>{v.date}</td>
                      <td className="capitalize">{v.type.replace("_", " ")}</td>
                      <td>{party?.name || "—"}</td>
                      <td>
                        {(v.type === "purchase" || v.type === "debit_note") &&
                        !showPurchaseRates
                          ? "••••"
                          : formatInr(v.total, locale)}
                      </td>
                      <td>
                        {v.type === "sale" || v.type === "purchase"
                          ? v.type === "purchase" && !showPurchaseRates
                            ? "••••"
                            : formatInr(v.outstanding ?? v.total, locale)
                          : "—"}
                      </td>
                      <td className="text-sm">
                        {v.type === "sale" ? (
                          v.packingSlipDataUrl ? (
                            <div className="flex flex-col gap-1">
                              <a
                                href={v.packingSlipDataUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="font-semibold text-[var(--brand)]"
                              >
                                {v.packingSlipName || "View PDF"}
                              </a>
                              <button
                                type="button"
                                className="text-left text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--brand)]"
                                onClick={() => {
                                  if (!db) return;
                                  try {
                                    const pdf =
                                      buildVoucherPackingSlipPdfDataUrl(
                                        v,
                                        {
                                          products: db.products,
                                          parties: db.parties,
                                          users: db.users,
                                          settings: db.settings,
                                        },
                                        "en"
                                      );
                                    const name = `${v.number}-packing-slip.pdf`;
                                    attachPackingSlip(v.id, {
                                      dataUrl: pdf,
                                      name,
                                    });
                                    refresh();
                                    const a = document.createElement("a");
                                    a.href = pdf;
                                    a.download = name;
                                    a.click();
                                    setMsg(`Packing slip regenerated · ${name}`);
                                  } catch (err) {
                                    setError(
                                      err instanceof Error
                                        ? err.message
                                        : "Failed"
                                    );
                                  }
                                }}
                              >
                                Regenerate
                              </button>
                              <button
                                type="button"
                                className="text-left text-xs font-semibold text-[var(--ink-muted)] hover:text-[var(--brand)]"
                                onClick={() => {
                                  const party = db?.parties.find(
                                    (p) => p.id === v.partyId
                                  );
                                  const linkedOrder = v.linkedOrderId
                                    ? db?.orders.find(
                                        (o) => o.id === v.linkedOrderId
                                      )
                                    : undefined;
                                  const phone =
                                    party?.phone || linkedOrder?.phone || "";
                                  if (!db || !phone) {
                                    setError(t("common.whatsappNoPhone"));
                                    return;
                                  }
                                  void notifyPackingSlipWhatsApp({
                                    phone,
                                    partyName:
                                      party?.name ||
                                      linkedOrder?.userName ||
                                      "Customer",
                                    voucherNumber: v.number,
                                    settings: db.settings,
                                    locale,
                                    orderNumber: linkedOrder?.orderNumber,
                                    orderId:
                                      linkedOrder?.id || v.linkedOrderId,
                                    audience: "customer",
                                    packingSlipDataUrl: v.packingSlipDataUrl,
                                    packingSlipName: v.packingSlipName,
                                  }).then((ok) => {
                                    setError("");
                                    setMsg(
                                      ok
                                        ? `${t("common.whatsappOpened")} ${t("common.whatsappPackingHint")}`
                                        : t("common.whatsappNoPhone")
                                    );
                                  });
                                }}
                              >
                                {t("common.sendPackingSlipWa")}
                              </button>
                            </div>
                          ) : !v.voided ? (
                            <button
                              type="button"
                              className="font-semibold text-[var(--brand)]"
                              onClick={() => {
                                if (!db) return;
                                try {
                                  const pdf =
                                    buildVoucherPackingSlipPdfDataUrl(
                                      v,
                                      {
                                        products: db.products,
                                        parties: db.parties,
                                        users: db.users,
                                        settings: db.settings,
                                      },
                                      "en"
                                    );
                                  const name = `${v.number}-packing-slip.pdf`;
                                  attachPackingSlip(v.id, {
                                    dataUrl: pdf,
                                    name,
                                  });
                                  refresh();
                                  const a = document.createElement("a");
                                  a.href = pdf;
                                  a.download = name;
                                  a.click();
                                  setMsg(`Packing slip generated · ${name}`);
                                } catch (err) {
                                  setError(
                                    err instanceof Error
                                      ? err.message
                                      : "Failed"
                                  );
                                }
                              }}
                            >
                              Generate PDF
                            </button>
                          ) : (
                            "—"
                          )
                        ) : v.type === "purchase" ? (
                          v.packingSlipDataUrl ? (
                            <a
                              href={v.packingSlipDataUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="font-semibold text-[var(--brand)]"
                            >
                              {v.packingSlipName || "View"}
                            </a>
                          ) : !v.voided ? (
                            <label className="cursor-pointer text-[var(--brand)]">
                              {t("accounts.uploadPackingSlip")}
                              <input
                                type="file"
                                accept="image/*,.pdf"
                                className="hidden"
                                onChange={async (e) => {
                                  const f = e.target.files?.[0];
                                  if (!f) return;
                                  const dataUrl = await fileToDataUrl(f);
                                  attachPackingSlip(v.id, {
                                    dataUrl,
                                    name: f.name,
                                  });
                                  refresh();
                                }}
                              />
                            </label>
                          ) : (
                            "—"
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {!v.voided ? (
                          <button
                            type="button"
                            className="inline-flex min-h-11 items-center px-2 text-sm text-[var(--danger)]"
                            onClick={() => {
                              if (
                                !confirm(
                                  locale === "hi"
                                    ? "वाउचर वॉइड करें?"
                                    : "Void this voucher?"
                                )
                              )
                                return;
                              voidVoucher(v.id, session.id);
                              refresh();
                            }}
                          >
                            {t("accounts.void")}
                          </button>
                        ) : (
                          "Voided"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {showPartyModal ? (
        <CreatePartyModal
          defaultType={
            showForm === "purchase" ||
            showForm === "payment" ||
            showForm === "debit_note"
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
            if (showForm === "sale") {
              const stock = product.variations.find((v) => v.id === variationId)
                ?.stock;
              const matrixStock =
                product.colors[0] && variationId
                  ? product.stockMatrix?.[
                      `${variationId}__${product.colors[0].id}`
                    ]
                  : undefined;
              const avail =
                matrixStock ??
                stock ??
                product.stock ??
                0;
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
            const secondaryQty = deriveSecondaryQty(
              product,
              qty,
              variationId
            );
            const rate = variation?.rate ?? product.baseRate ?? 0;
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
            updated.amount = voucherLineAmount(updated);
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

export default function AccountsVouchersPage() {
  return (
    <Suspense
      fallback={
        <AccountsShell>
          <p>Loading…</p>
        </AccountsShell>
      }
    >
      <VouchersPageWithShell />
    </Suspense>
  );
}

function VouchersPageWithShell() {
  const search = useSearchParams();
  const initialNew = (search.get("new") as VoucherType | null) || null;
  // Mirror form open state for shell focusMode — shell can't read inner state
  const [focusMode, setFocusMode] = useState(!!initialNew);

  useEffect(() => {
    const n = search.get("new");
    // URL drives focus mode — intentional sync
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (n) setFocusMode(true);
  }, [search]);

  return (
    <AccountsShell focusMode={focusMode}>
      <VouchersInner onFormOpenChange={setFocusMode} />
    </AccountsShell>
  );
}
