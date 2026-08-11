"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import type { AppSettings, BankAccountDetails } from "@/lib/types";
import { formatInr } from "@/lib/pricing";
import {
  UPI_MAX_AMOUNT_DEFAULT,
  buildUpiPayUrl,
  chooseQrMode,
  hasBankDetails,
  listPayableAccounts,
} from "@/lib/upi";

type Props = {
  settings: AppSettings;
  /** Amount prefilled in UPI QR / shown as "pay now" (partial or remaining). */
  amount: number;
  orderNumber: string;
  locale: "en" | "hi";
  /** Full balance still owed on the order (for part-payment context). */
  remainingBalance?: number;
};

export function PaymentInstructions({
  settings,
  amount,
  orderNumber,
  locale,
  remainingBalance,
}: Props) {
  const accounts = useMemo(() => listPayableAccounts(settings), [settings]);
  const [pickedId, setPickedId] = useState<string>("");
  const active =
    accounts.find((a) => a.id === pickedId) || accounts[0] || null;
  const cap =
    settings.upiMaxAmount && settings.upiMaxAmount > 0
      ? settings.upiMaxAmount
      : UPI_MAX_AMOUNT_DEFAULT;
  const payNow = Math.max(0, Math.round(amount * 100) / 100);
  const balance =
    remainingBalance != null
      ? Math.max(0, Math.round(remainingBalance * 100) / 100)
      : payNow;
  const isPartial = balance > 0 && payNow > 0 && payNow < balance - 0.009;

  if (!accounts.length) {
    const helpPhone = settings.phone || settings.phone2 || "";
    return (
      <div className="rounded-2xl border border-dashed border-[var(--line)] bg-[var(--surface-2)] p-4 text-sm text-[var(--ink-muted)]">
        <p className="font-semibold text-[var(--ink)]">
          {locale === "hi"
            ? "भुगतान विवरण के लिए संपर्क करें"
            : "Contact us for payment details"}
        </p>
        <p className="mt-1">
          {locale === "hi"
            ? `ऑर्डर ${orderNumber} के लिए भुगतान जानकारी हमारी टीम आपको भेज देगी।`
            : `Our team will share payment details for order ${orderNumber}.`}
        </p>
        {helpPhone ? (
          <a
            href={`tel:${helpPhone}`}
            className="mt-2 inline-block font-bold text-[var(--brand-deep)] underline"
          >
            {helpPhone}
          </a>
        ) : null}
      </div>
    );
  }

  return (
    <div className="tt-panel space-y-4 border-2 border-[var(--brand)]/35 p-4">
      <div>
        <h3 className="text-base font-bold text-[var(--brand-deep)]">
          {locale === "hi" ? "भुगतान करें" : "Pay now"}
        </h3>
        <p className="mt-1 text-2xl font-bold text-[var(--brand-deep)] tabular-nums">
          {formatInr(payNow, locale)}
        </p>
        {isPartial ? (
          <p className="mt-1 text-xs font-semibold text-[var(--ink-muted)]">
            {locale === "hi"
              ? `पार्ट पेमेंट · बाकी कुल ${formatInr(balance, locale)}`
              : `Part payment · balance due ${formatInr(balance, locale)}`}
          </p>
        ) : balance > payNow ? (
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {locale === "hi"
              ? `बाकी ${formatInr(balance, locale)}`
              : `Balance due ${formatInr(balance, locale)}`}
          </p>
        ) : null}
        {settings.paymentNote ? (
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {settings.paymentNote}
          </p>
        ) : null}
      </div>

      {accounts.length > 1 ? (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {locale === "hi" ? "खाता चुनें" : "Choose account"}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            {accounts.map((a) => {
              const isActive = active?.id === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setPickedId(a.id || "")}
                  className={`tt-chip ${isActive ? "tt-chip-active" : ""}`}
                >
                  {a.label || a.bankName || "Account"}
                  {a.isDefault && !isActive ? (
                    <span className="tt-chip-count">
                      {locale === "hi" ? "डिफ़ॉल्ट" : "Default"}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {active ? (
        <AccountPanel
          account={active}
          amount={payNow}
          orderNumber={orderNumber}
          settings={settings}
          locale={locale}
          cap={cap}
        />
      ) : null}
    </div>
  );
}

function AccountPanel({
  account,
  amount,
  orderNumber,
  settings,
  locale,
  cap,
}: {
  account: BankAccountDetails;
  amount: number;
  orderNumber: string;
  settings: AppSettings;
  locale: "en" | "hi";
  cap: number;
}) {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const decision = chooseQrMode(account, amount, settings);
  const upiUrl =
    decision.mode === "upi_amount"
      ? buildUpiPayUrl({
          upiId: account.upiId || "",
          payeeName: account.upiPayeeName || settings.companyName,
          amount,
          note: orderNumber,
        })
      : null;
  const showBank = hasBankDetails(account);

  useEffect(() => {
    let cancelled = false;
    if (!upiUrl) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQrDataUrl("");
      return;
    }
    QRCode.toDataURL(upiUrl, {
      width: 220,
      margin: 2,
      errorCorrectionLevel: "M",
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl("");
      });
    return () => {
      cancelled = true;
    };
  }, [upiUrl]);

  return (
    <div className="space-y-4">
      {decision.mode === "upi_amount" ? (
        <div className="space-y-3 border-t border-[var(--line)] pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            UPI QR
          </p>
          <p className="text-sm font-semibold">
            UPI ID: <span className="font-mono">{account.upiId}</span>
          </p>
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt="UPI QR"
              className="mx-auto rounded-lg border border-[var(--line)] bg-white p-2"
              width={220}
              height={220}
            />
          ) : (
            <p className="text-xs text-[var(--ink-muted)]">Generating QR…</p>
          )}
          <p className="text-center text-xs text-[var(--ink-muted)]">
            {locale === "hi"
              ? "स्कैन करें — रकम QR में पहले से भरी है"
              : "Scan with any UPI app — amount is already filled"}
          </p>
          {upiUrl ? (
            <a
              href={upiUrl}
              className="tt-btn tt-btn-dark inline-flex w-full justify-center text-base font-bold"
            >
              {locale === "hi" ? "UPI ऐप खोलें" : "Open UPI app"}
            </a>
          ) : null}
        </div>
      ) : null}

      {decision.mode === "static" ? (
        <div className="space-y-3 border-t border-[var(--line)] pt-4">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {locale === "hi" ? "QR स्कैन करें" : "Scan the QR"}
          </p>
          {decision.reason === "over_upi_limit" ? (
            <p className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink)]">
              {locale === "hi"
                ? `यह बिल UPI की एक-ट्रांज़ैक्शन सीमा (${formatInr(cap, locale)}) से ज़्यादा है। नीचे दिए QR को स्कैन करें और रकम खुद डालें, या NEFT/RTGS करें।`
                : `Bill exceeds the UPI per-txn limit (${formatInr(cap, locale)}). Scan the QR below and enter the amount manually, or transfer by NEFT/RTGS.`}
            </p>
          ) : null}
          {account.staticQrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={account.staticQrDataUrl}
              alt={
                locale === "hi"
                  ? "अपलोड किया गया QR"
                  : "Uploaded payment QR"
              }
              className="mx-auto rounded-lg border border-[var(--line)] bg-white p-2"
              style={{ maxWidth: 260, maxHeight: 260 }}
            />
          ) : null}
          <p className="text-center text-xs text-[var(--ink-muted)]">
            {locale === "hi"
              ? "रकम स्कैन के बाद अपने UPI ऐप में डालें।"
              : "Enter the amount in your UPI app after scanning."}
          </p>
        </div>
      ) : null}

      {decision.mode === "none" && decision.reason === "over_upi_limit" ? (
        <div className="space-y-2 border-t border-[var(--line)] pt-4">
          <p className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-xs text-[var(--ink)]">
            {locale === "hi"
              ? `यह बिल UPI की सीमा (${formatInr(cap, locale)}) से ज़्यादा है। कृपया नीचे दिए बैंक खाते में NEFT/RTGS/IMPS करें।`
              : `Bill exceeds the UPI limit (${formatInr(cap, locale)}). Please transfer via NEFT/RTGS/IMPS to the bank account below.`}
          </p>
        </div>
      ) : null}

      {showBank ? (
        <div className="space-y-2 border-t border-[var(--line)] pt-4 text-sm">
          <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {locale === "hi" ? "बैंक खाता" : "Bank account"}
            {account.label ? (
              <span className="ml-2 text-[10px] font-semibold text-[var(--brand-deep,var(--brand))]">
                · {account.label}
              </span>
            ) : null}
          </p>
          <dl className="grid gap-1.5">
            <Row
              k={locale === "hi" ? "नाम" : "Name"}
              v={account.accountName}
            />
            <Row
              k={locale === "hi" ? "अकाउंट नं." : "A/C no."}
              v={account.accountNumber}
              copyable
              mono
            />
            <Row k="IFSC" v={account.ifsc.toUpperCase()} copyable mono />
            <Row
              k={locale === "hi" ? "बैंक" : "Bank"}
              v={account.bankName}
            />
            {account.branch?.trim() ? (
              <Row
                k={locale === "hi" ? "ब्रांच" : "Branch"}
                v={account.branch}
              />
            ) : null}
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function Row({
  k,
  v,
  mono,
  copyable,
}: {
  k: string;
  v: string;
  mono?: boolean;
  copyable?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-[var(--ink-muted)]">{k}</dt>
      <dd
        className={`text-right font-medium ${mono ? "font-mono tracking-wide" : ""}`}
      >
        {v}
        {copyable && v ? (
          <button
            type="button"
            className="ml-2 text-[11px] font-semibold text-[var(--brand)] underline underline-offset-2"
            onClick={() => {
              void navigator.clipboard?.writeText(v);
            }}
          >
            Copy
          </button>
        ) : null}
      </dd>
    </div>
  );
}
