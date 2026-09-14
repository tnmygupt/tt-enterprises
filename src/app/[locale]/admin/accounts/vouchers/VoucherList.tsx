"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { FilePick } from "@/components/FilePick";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { ExportButtons } from "@/components/ExportButtons";
import { fileToDataUrl, useDb, useSession } from "@/lib/hooks";
import { staffMustHideVoucherRupees } from "@/lib/owner-sensitive";
import { formatInr } from "@/lib/pricing";
import {
  attachPackingSlip,
  canViewFinancials,
  voidVoucher,
} from "@/lib/store/db";
import type { Voucher, VoucherType } from "@/lib/types";
import { buildVoucherPackingSlipPdfDataUrl } from "@/lib/voucher-packing-slip";
import { notifyPackingSlipWhatsApp, whatsappResultCopy } from "@/lib/whatsapp";
import { VOUCHER_TYPE_CHIPS } from "./helpers";

const PAGE = 100;

export function VoucherList({
  initialQ = "",
  onView,
  onOpenForm,
  onMsg,
  onError,
}: {
  initialQ?: string;
  onView: (id: string) => void;
  onOpenForm: (type: VoucherType) => void;
  onMsg: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const showPurchaseRates = session
    ? canViewFinancials(session.role)
    : false;
  const [listQ, setListQ] = useState(initialQ);
  const [typeFilter, setTypeFilter] = useState("");
  const [range, setRange] = useAdminDateRange("mtd");
  const [limit, setLimit] = useState(PAGE);

  const filtered = useMemo(() => {
    const all = [...(db?.vouchers ?? [])].sort(
      (a, b) =>
        b.date.localeCompare(a.date) ||
        b.createdAt.localeCompare(a.createdAt) ||
        b.number.localeCompare(a.number)
    );
    const qq = listQ.trim().toLowerCase();
    return all.filter((v) => {
      if (typeFilter && v.type !== typeFilter) return false;
      if (v.date < range.from || v.date > range.to) return false;
      if (!qq) return true;
      const party = db?.parties.find((p) => p.id === v.partyId);
      return `${v.number} ${v.type} ${v.narration ?? ""} ${party?.name ?? ""}`
        .toLowerCase()
        .includes(qq);
    });
  }, [db, listQ, typeFilter, range.from, range.to]);

  const listed = filtered.slice(0, limit);

  const voucherExportOptions = useMemo(
    () => ({
      title: t("accounts.vouchers"),
      subtitle: `${range.from} → ${range.to}`,
      filename: `vouchers-${range.from}-${range.to}.pdf`,
      columns: ["No.", "Date", "Type", "Party", "Total", "Outstanding"],
      rows: listed
        .filter((v) => !v.voided)
        .map((v) => {
          const party =
            db?.parties.find((p) => p.id === v.partyId)?.name || "—";
          const hideAmt = staffMustHideVoucherRupees(
            v.type,
            showPurchaseRates
          );
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
    [db, listed, locale, range.from, range.to, showPurchaseRates, t]
  );

  const amountOf = (v: Voucher) => {
    const hide = staffMustHideVoucherRupees(v.type, showPurchaseRates);
    return hide ? "••••" : formatInr(v.total, locale);
  };

  return (
    <>
      <AccountsPageHeader
        title={t("accounts.vouchers")}
        hint={t("accounts.voucherListHint")}
        actions={
          <>
          <ExportButtons options={voucherExportOptions} />
          <Link href="/admin/orders/new" className="tt-btn tt-btn-dark">
            {t("accounts.newSale")}
          </Link>
          <button
            type="button"
            className="tt-btn tt-btn-outline"
            onClick={() => onOpenForm("sale")}
          >
            {t("accounts.saleVoucher")}
          </button>
          <button
            type="button"
            className="tt-btn tt-btn-outline"
            onClick={() => onOpenForm("credit_note")}
          >
            {t("accounts.postReturn")}
          </button>
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
              if (v) onOpenForm(v);
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
          </>
        }
      />

      <div className="mt-6 flex flex-wrap gap-2">
        {VOUCHER_TYPE_CHIPS.filter(
          (c) =>
            showPurchaseRates ||
            (c.type !== "purchase" &&
              c.type !== "payment" &&
              c.type !== "debit_note")
        ).map((c) => (
          <button
            key={c.type || "all"}
            type="button"
            className={`tt-btn ${typeFilter === c.type ? "tt-btn-dark" : "tt-btn-outline"}`}
            onClick={() => setTypeFilter(c.type)}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <input
          className="tt-input min-w-[200px]"
          placeholder={t("accounts.filterVouchers")}
          value={listQ}
          onChange={(e) => setListQ(e.target.value)}
        />
        <DateRangeBar value={range} onChange={setRange} />
      </div>

      <div className="tt-acct-cards mt-3 sm:hidden">
        {listed.map((v) => {
          const party = db?.parties.find((p) => p.id === v.partyId);
          return (
            <button
              key={v.id}
              type="button"
              className={`tt-panel tt-acct-card ${v.voided ? "opacity-50" : ""}`}
              onClick={() => onView(v.id)}
            >
              <p className="font-mono text-sm font-semibold text-[var(--brand-deep)]">
                {v.number}
              </p>
              <p className="text-xs capitalize text-[var(--ink-muted)]">
                {v.date} · {v.type.replace("_", " ")}
                {party ? ` · ${party.name}` : ""}
              </p>
              <p className="mt-1 text-sm font-semibold tabular-nums">
                {amountOf(v)}
              </p>
            </button>
          );
        })}
      </div>

      <div className="tt-panel tt-acct-table-wrap mt-3 hidden sm:block">
        <table className="tt-table min-w-[900px]">
          <thead>
            <tr>
              <th>{t("accounts.colNo")}</th>
              <th>{t("accounts.colDate")}</th>
              <th>{t("accounts.colType")}</th>
              <th>{t("accounts.colParty")}</th>
              <th>{t("accounts.colTotal")}</th>
              <th>{t("accounts.outstanding")}</th>
              <th>{t("accounts.packingSlip")}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {listed.map((v) => {
              const party = db?.parties.find((p) => p.id === v.partyId);
              const hideAmt = staffMustHideVoucherRupees(
                v.type,
                showPurchaseRates
              );
              return (
                <tr
                  key={v.id}
                  className={v.voided ? "opacity-50 line-through" : ""}
                >
                  <td>
                    <button
                      type="button"
                      className="font-mono text-sm font-semibold text-[var(--brand-deep)] underline"
                      onClick={() => onView(v.id)}
                    >
                      {v.number}
                    </button>
                  </td>
                  <td>{v.date}</td>
                  <td className="capitalize">{v.type.replace("_", " ")}</td>
                  <td>{party?.name || "—"}</td>
                  <td>{hideAmt ? "••••" : formatInr(v.total, locale)}</td>
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
                                const pdf = buildVoucherPackingSlipPdfDataUrl(
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
                                attachPackingSlip(v.id, { dataUrl: pdf, name });
                                refresh();
                                const a = document.createElement("a");
                                a.href = pdf;
                                a.download = name;
                                a.click();
                                onMsg(`Packing slip regenerated · ${name}`);
                              } catch (err) {
                                onError(
                                  err instanceof Error ? err.message : "Failed"
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
                              const partyRow = db?.parties.find(
                                (p) => p.id === v.partyId
                              );
                              const linkedOrder = v.linkedOrderId
                                ? db?.orders.find((o) => o.id === v.linkedOrderId)
                                : undefined;
                              const phone =
                                partyRow?.phone || linkedOrder?.phone || "";
                              if (!db || !phone) {
                                onError(t("common.whatsappNoPhone"));
                                return;
                              }
                              void notifyPackingSlipWhatsApp({
                                phone,
                                partyName:
                                  partyRow?.name ||
                                  linkedOrder?.userName ||
                                  "Customer",
                                voucherNumber: v.number,
                                settings: db.settings,
                                locale,
                                orderNumber: linkedOrder?.orderNumber,
                                orderId: linkedOrder?.id || v.linkedOrderId,
                                audience: "customer",
                                packingSlipDataUrl: v.packingSlipDataUrl,
                                packingSlipName: v.packingSlipName,
                                discountAmount: linkedOrder?.schemeDiscount,
                                discountLabel: linkedOrder?.schemeDiscountLabel,
                                billAmount: linkedOrder?.actualBillAmount,
                                order: linkedOrder,
                              }).then((result) => {
                                onError("");
                                const base = whatsappResultCopy(result, {
                                  sent: t("common.whatsappSent"),
                                  opened: t("common.whatsappOpened"),
                                  fail: t("common.whatsappSendFailed"),
                                  noPhone: t("common.whatsappNoPhone"),
                                });
                                onMsg(
                                  result.ok && result.attached
                                    ? `${base} ${t("common.whatsappPackingHint")}`
                                    : base
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
                              const pdf = buildVoucherPackingSlipPdfDataUrl(
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
                              attachPackingSlip(v.id, { dataUrl: pdf, name });
                              refresh();
                              const a = document.createElement("a");
                              a.href = pdf;
                              a.download = name;
                              a.click();
                              onMsg(`Packing slip generated · ${name}`);
                            } catch (err) {
                              onError(
                                err instanceof Error ? err.message : "Failed"
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
                        <FilePick
                          kind="photoOrPdf"
                          compact
                          className="min-w-[11rem]"
                          onPick={async (files) => {
                            const f = files[0];
                            if (!f) return;
                            try {
                              const dataUrl = await fileToDataUrl(f);
                              attachPackingSlip(v.id, {
                                dataUrl,
                                name: f.name,
                              });
                              refresh();
                            } catch (err) {
                              onError(
                                err instanceof Error ? err.message : "Failed"
                              );
                            }
                          }}
                        />
                      ) : (
                        "—"
                      )
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {!v.voided && session ? (
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

      {!listed.length ? (
        <AccountsEmpty
          message={t("accounts.emptyVouchers")}
          href="/admin/accounts/vouchers?new=receipt"
          cta={t("accounts.emptyVouchersCta")}
        />
      ) : null}

      {filtered.length > limit ? (
        <button
          type="button"
          className="tt-btn tt-btn-outline mt-3"
          onClick={() => setLimit((n) => n + PAGE)}
        >
          {t("accounts.loadMore")} · {filtered.length - limit} left
        </button>
      ) : null}
    </>
  );
}
