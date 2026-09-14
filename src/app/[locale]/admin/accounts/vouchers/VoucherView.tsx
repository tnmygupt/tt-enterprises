"use client";

import { Link } from "@/i18n/routing";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { invoiceSettlementLines } from "@/lib/accounting";
import { staffMustHideVoucherRupees } from "@/lib/owner-sensitive";
import { formatInr } from "@/lib/pricing";
import { voidVoucher } from "@/lib/store/db";
import type { AppDatabase } from "@/lib/store/db";
import type { Locale, Voucher } from "@/lib/types";

export function VoucherView({
  voucher,
  db,
  locale,
  showPurchaseRates,
  sessionId,
  onClose,
  onVoided,
  onError,
}: {
  voucher: Voucher;
  db: AppDatabase;
  locale: Locale;
  showPurchaseRates: boolean;
  sessionId: string;
  onClose: () => void;
  onVoided: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const hideAmt = staffMustHideVoucherRupees(
    voucher.type,
    showPurchaseRates
  );
  const settlements =
    voucher.type === "sale" || voucher.type === "purchase"
      ? invoiceSettlementLines(
          voucher.id,
          db.vouchers,
          db.billAllocations ?? []
        )
      : [];
  const appliedFrom =
    voucher.type === "receipt" || voucher.type === "payment"
      ? (db.billAllocations ?? []).filter(
          (a) => a.receiptOrPaymentVoucherId === voucher.id && a.amount > 0.009
        )
      : [];

  return (
    <div className="tt-panel mt-6 space-y-4 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-[var(--ink-muted)]">
            Voucher
          </p>
          <h2 className="tt-display text-3xl text-[var(--brand-deep)]">
            {voucher.number}
          </h2>
          <p className="mt-1 text-sm capitalize text-[var(--ink-muted)]">
            {voucher.type.replace("_", " ")} · {voucher.date}
            {voucher.voided ? " · VOIDED" : ""}
          </p>
        </div>
        <button type="button" className="tt-btn tt-btn-outline" onClick={onClose}>
          Close
        </button>
      </div>
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[var(--ink-muted)]">Party</dt>
          <dd className="font-medium">
            {db.parties.find((p) => p.id === voucher.partyId)?.name || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-[var(--ink-muted)]">Total</dt>
          <dd className="font-semibold tabular-nums">
            {hideAmt ? "••••" : formatInr(voucher.total, locale)}
          </dd>
        </div>
        {voucher.roundOff != null &&
        Math.abs(voucher.roundOff) >= 0.005 &&
        !hideAmt ? (
          <div>
            <dt className="text-[var(--ink-muted)]">Round off</dt>
            <dd className="tabular-nums">
              {voucher.roundOff > 0 ? "+" : ""}
              {formatInr(voucher.roundOff, locale)}
            </dd>
          </div>
        ) : null}
        {voucher.narration ? (
          <div className="sm:col-span-2">
            <dt className="text-[var(--ink-muted)]">Narration</dt>
            <dd>{voucher.narration}</dd>
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
            {voucher.lines.map((l) => (
              <tr key={l.id}>
                <td>{l.itemLabel}</td>
                <td className="tabular-nums">{l.qty}</td>
                <td className="tabular-nums">{l.secondaryQty ?? "—"}</td>
                <td className="tabular-nums">
                  {hideAmt ? "••••" : formatInr(l.rate, locale)}
                </td>
                <td className="tabular-nums">
                  {hideAmt ? "••••" : formatInr(l.amount, locale)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {voucher.packingSlipDataUrl ? (
        <a
          href={voucher.packingSlipDataUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-block font-semibold text-[var(--brand-deep)] underline"
        >
          {voucher.packingSlipName || "Open packing slip PDF"}
        </a>
      ) : null}
      {settlements.length ? (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {locale === "hi" ? "इस बिल को चुकाया" : "Settled by"}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {settlements.map((s) => (
              <li key={`${s.kind}-${s.voucherId}`} className="flex justify-between gap-3">
                <span>
                  <VoucherNumberLink id={s.voucherId} number={s.number} />
                  <span className="ml-2 text-[var(--ink-muted)]">
                    {s.date} · {s.kind.replace("_", " ")}
                  </span>
                </span>
                <span className="tabular-nums font-semibold">
                  {hideAmt ? "••••" : formatInr(s.amount, locale)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : voucher.type === "sale" || voucher.type === "purchase" ? (
        <p className="text-sm text-[var(--ink-muted)]">
          {locale === "hi"
            ? "अभी कोई रसीद या नोट नहीं।"
            : "No receipts or notes applied yet."}
        </p>
      ) : null}
      {appliedFrom.length ? (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {locale === "hi" ? "बिलों पर लगाया" : "Applied to bills"}
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {appliedFrom.map((a) => {
              const inv = db.vouchers.find((v) => v.id === a.invoiceVoucherId);
              return (
                <li key={a.id} className="flex justify-between gap-3">
                  <VoucherNumberLink
                    id={a.invoiceVoucherId}
                    number={inv?.number || a.invoiceVoucherId}
                  />
                  <span className="tabular-nums font-semibold">
                    {formatInr(a.amount, locale)}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      {voucher.linkedOrderId ? (
        <Link
          href={`/admin/orders?q=${encodeURIComponent(voucher.linkedOrderId)}`}
          className="block text-sm font-semibold text-[var(--brand-deep)] underline"
        >
          Linked order
        </Link>
      ) : null}
      {!voucher.voided ? (
        <button
          type="button"
          className="tt-btn tt-btn-outline text-[var(--danger)]"
          onClick={() => {
            if (!confirm(`Void ${voucher.number}?`)) return;
            try {
              voidVoucher(voucher.id, sessionId);
              onVoided(`Voided ${voucher.number}`);
            } catch (err) {
              onError(err instanceof Error ? err.message : "Void failed");
            }
          }}
        >
          Void voucher
        </button>
      ) : null}
    </div>
  );
}
