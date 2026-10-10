"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { NumberField } from "@/components/NumberField";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import {
  allocateOldestFirst,
  openInvoicesForParty,
  unallocatedAdvance,
} from "@/lib/accounting";
import { getAdminQueues } from "@/lib/admin-queues";
import { useCloudLive, useDb, useSession } from "@/lib/hooks";
import { orderVerifyAmount } from "@/lib/owner-daily-summary";
import { formatInr, roundMoney } from "@/lib/pricing";
import { getProofItems } from "@/lib/proofs";
import { listPayableAccounts } from "@/lib/upi";
import {
  applyReceiptAllocations,
  checkCapability,
  rejectWalletDeposit,
  verifyPayment,
  verifyWalletDeposit,
} from "@/lib/store/db";
import type { AppDatabase } from "@/lib/store/db";
import type { Order, Voucher } from "@/lib/types";

function receiptAllocMap(
  receiptId: string,
  db: AppDatabase
): Record<string, number> {
  const existing: Record<string, number> = {};
  for (const a of db.billAllocations ?? []) {
    if (a.receiptOrPaymentVoucherId !== receiptId) continue;
    existing[a.invoiceVoucherId] = roundMoney(
      (existing[a.invoiceVoucherId] || 0) + a.amount
    );
  }
  return existing;
}

type ReceiptProofMeta = {
  payRef?: string;
  utr?: string;
  orderNumber?: string;
};

function receiptProofMeta(db: AppDatabase, receipt: Voucher): ReceiptProofMeta {
  const order = db.orders.find((o) => o.id === receipt.linkedOrderId);
  const items = getProofItems(order?.paymentProof);
  const item =
    items.find((i) => i.id === receipt.linkedPaymentProofItemId) || items[0];
  return {
    payRef: item?.payRef,
    utr: item?.note,
    orderNumber: order?.orderNumber,
  };
}

export default function PaymentsDeskPage() {
  const t = useTranslations("accounts");
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const live = useCloudLive();
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [applyId, setApplyId] = useState("");
  const [applyAmts, setApplyAmts] = useState<Record<string, string>>({});

  const canVerify = !!session && checkCapability(session, db, "verify_payment");
  const canWallet = !!session && checkCapability(session, db, "manage_wallet");
  const canBooks = !!session && checkCapability(session, db, "manage_accounts");

  const queues = useMemo(() => getAdminQueues(db), [db]);
  const wallets = useMemo(
    () =>
      (db?.walletDeposits ?? []).filter(
        (d) => d.status === "pending_verify" || d.status === "awaiting_proof"
      ),
    [db]
  );
  const banks = useMemo(
    () => (db ? listPayableAccounts(db.settings) : []),
    [db]
  );

  const leftoverReceipts = useMemo(() => {
    if (!db) return [];
    const today = new Date().toISOString().slice(0, 10);
    return db.vouchers
      .filter((v) => v.type === "receipt" && !v.voided && v.partyId)
      .map((v) => {
        const allocated = receiptAllocMap(v.id, db);
        return {
          voucher: v,
          leftover: unallocatedAdvance(v.total, allocated),
          allocated,
        };
      })
      .filter((x) => x.leftover > 0.05)
      .sort(
        (a, b) =>
          b.voucher.date.localeCompare(a.voucher.date) ||
          b.voucher.number.localeCompare(a.voucher.number)
      )
      .slice(0, 20)
      .map((row) => {
        const open = openInvoicesForParty(
          row.voucher.partyId!,
          db.vouchers,
          db.billAllocations ?? [],
          today,
          "sale",
          db.orders
        );
        return { ...row, open };
      });
  }, [db]);

  if (!session || (!canVerify && !canWallet && !canBooks)) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const onVerifyOrder = (id: string, force: boolean) => {
    if (!session) return;
    setBusy(id);
    setMsg("");
    try {
      verifyPayment(id, session.id, { force });
      setMsg(t("payVerified"));
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("payFailed"));
    } finally {
      setBusy("");
    }
  };

  const onVerifyWallet = (id: string) => {
    if (!session) return;
    setBusy(id);
    setMsg("");
    try {
      verifyWalletDeposit(id, session.id);
      setMsg(t("payWalletOk"));
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("payFailed"));
    } finally {
      setBusy("");
    }
  };

  const onRejectWallet = (id: string) => {
    if (!session) return;
    const reason =
      window.prompt(
        locale === "hi" ? "रिजेक्ट का कारण?" : "Reject reason?"
      ) || "";
    setBusy(id);
    try {
      rejectWalletDeposit(id, session.id, reason);
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("payFailed"));
    } finally {
      setBusy("");
    }
  };

  const openApply = (receiptId: string, leftover: number, openBills: { voucher: { id: string }; outstanding: number }[]) => {
    const suggested = allocateOldestFirst(openBills, leftover);
    const next: Record<string, string> = {};
    for (const [id, amt] of Object.entries(suggested)) {
      if (amt > 0.009) next[id] = String(amt);
    }
    setApplyAmts(next);
    setApplyId(receiptId);
  };

  const onApply = (receiptId: string) => {
    if (!session) return;
    setBusy(receiptId);
    setMsg("");
    try {
      applyReceiptAllocations(
        receiptId,
        Object.entries(applyAmts).map(([invoiceVoucherId, raw]) => ({
          invoiceVoucherId,
          amount: Number(raw) || 0,
        })),
        session.id
      );
      setMsg(t("payApplied"));
      setApplyId("");
      setApplyAmts({});
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("payFailed"));
    } finally {
      setBusy("");
    }
  };

  return (
    <AccountsShell>
      <AccountsPageHeader
        title={t("payTitle")}
        hint={t("payHint")}
        extra={
          <p className="flex items-center gap-2 text-xs font-semibold text-[var(--ink-muted)]">
            <span
              aria-hidden
              className={`inline-block h-2 w-2 rounded-full ${
                live === "on"
                  ? "bg-emerald-600"
                  : live === "connecting"
                    ? "bg-amber-500"
                    : "bg-[var(--ink-muted)]"
              }`}
            />
            {live === "on"
              ? t("payLiveOn")
              : live === "connecting"
                ? t("payLiveWait")
                : t("payLiveOff")}
          </p>
        }
        actions={
          <>
            <Link href="/admin/accounts/brs" className="tt-btn tt-btn-outline">
              {t("brsTitle")}
            </Link>
            <Link href="/admin/accounts/receivables" className="tt-btn tt-btn-outline">
              {t("moneyToCollect")}
            </Link>
            <Link href="/admin/whatsapp" className="tt-btn tt-btn-outline">
              {t("whatsappDesk")}
            </Link>
          </>
        }
      />

      {banks.length ? (
        <div className="mt-5 tt-panel p-4 text-sm">
          <p className="font-semibold">{t("payCollectHow")}</p>
          <p className="mt-1 text-[var(--ink-muted)]">{t("payCollectHint")}</p>
          <ul className="mt-2 space-y-1">
            {banks.map((b) => (
              <li key={b.upiId + b.accountNumber}>
                <span className="font-medium">{b.label || b.bankName}</span>
                {b.upiId ? ` · UPI ${b.upiId}` : ""}
                {b.accountNumber
                  ? ` · ${b.accountNumber} / ${b.ifsc || ""}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {msg ? (
        <p className="mt-3 text-sm text-[var(--brand-deep)]">{msg}</p>
      ) : null}

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {t("payOrderProofs")} · {queues.needVerifyPayment.length}
      </h2>
      <ul className="mt-2 space-y-2">
        {queues.needVerifyPayment.map((o) => (
          <OrderProofCard
            key={o.id}
            order={o}
            locale={locale}
            busy={busy === o.id}
            canVerify={canVerify}
            onVerify={() =>
              onVerifyOrder(o.id, orderVerifyAmount(o).remaining > 0.05)
            }
            t={t}
          />
        ))}
      </ul>
      {!queues.needVerifyPayment.length ? (
        <AccountsEmpty message={t("payNoneOrders")} />
      ) : null}

      {(canBooks || canVerify) ? (
        <>
          <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {t("payApplyTitle")} · {leftoverReceipts.length}
          </h2>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">{t("payApplyHint")}</p>
          <ul className="mt-2 space-y-2">
            {leftoverReceipts.map((row) => {
              const party = db?.parties.find((p) => p.id === row.voucher.partyId);
              const meta: ReceiptProofMeta = db
                ? receiptProofMeta(db, row.voucher)
                : {};
              const open = applyId === row.voucher.id;
              return (
                <li key={row.voucher.id} className="tt-panel p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold">
                        <VoucherNumberLink
                          id={row.voucher.id}
                          number={row.voucher.number}
                        />
                        {meta.orderNumber ? ` · ${meta.orderNumber}` : ""}
                      </p>
                      <p className="text-sm text-[var(--ink-muted)]">
                        {party?.name || row.voucher.partyId} · {t("payApplyReceipt")}{" "}
                        {formatInr(row.voucher.total, locale)} · {t("payApplyLeftover")}{" "}
                        {formatInr(row.leftover, locale)}
                      </p>
                      {meta.payRef || meta.utr ? (
                        <p className="mt-1 font-mono text-xs text-[var(--brand-deep)]">
                          {meta.payRef ? `${t("payUpiNote")} ${meta.payRef}` : ""}
                          {meta.payRef && meta.utr ? " · " : ""}
                          {meta.utr ? `${t("payUtr")} ${meta.utr}` : ""}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="tt-btn tt-btn-outline"
                      onClick={() =>
                        open
                          ? setApplyId("")
                          : openApply(row.voucher.id, row.leftover, row.open)
                      }
                    >
                      {open ? t("payApplyHide") : t("payApplyBtn")}
                    </button>
                  </div>
                  {open ? (
                    <div className="mt-3 space-y-2 border-t border-[var(--line)] pt-3">
                      {row.open.length ? (
                        <ul className="space-y-2">
                          {row.open.map((bill) => (
                            <li
                              key={bill.voucher.id}
                              className="flex flex-wrap items-center justify-between gap-2 text-sm"
                            >
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={
                                    (Number(applyAmts[bill.voucher.id]) || 0) >
                                    0.009
                                  }
                                  onChange={(e) => {
                                    setApplyAmts((prev) => ({
                                      ...prev,
                                      [bill.voucher.id]: e.target.checked
                                        ? String(
                                            Math.min(
                                              bill.outstanding,
                                              row.leftover
                                            )
                                          )
                                        : "",
                                    }));
                                  }}
                                />
                                <VoucherNumberLink
                                  id={bill.voucher.id}
                                  number={bill.voucher.number}
                                />
                                <span className="text-[var(--ink-muted)]">
                                  {bill.voucher.date} · {t("payDue")}{" "}
                                  {formatInr(bill.outstanding, locale)}
                                </span>
                              </label>
                              <NumberField
                                className="tt-input w-28"
                                emptyAs={null}
                                value={applyAmts[bill.voucher.id] ?? ""}
                                onValueChange={(v) =>
                                  setApplyAmts((prev) => ({
                                    ...prev,
                                    [bill.voucher.id]: v === "" ? "" : String(v),
                                  }))
                                }
                              />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-[var(--ink-muted)]">
                          {t("payOnAccount")}
                        </p>
                      )}
                      <button
                        type="button"
                        className="tt-btn tt-btn-dark"
                        disabled={busy === row.voucher.id || !row.open.length}
                        onClick={() => onApply(row.voucher.id)}
                      >
                        {t("payApplyBtn")}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
          {!leftoverReceipts.length ? (
            <AccountsEmpty message={t("payApplyNone")} />
          ) : null}
        </>
      ) : null}

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {t("payWallet")} · {wallets.length}
      </h2>
      <ul className="mt-2 space-y-2">
        {wallets.map((d) => (
          <li key={d.id} className="tt-panel p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="font-semibold">
                  {formatInr(d.amount, locale)} · {d.status}
                </p>
                <p className="text-sm text-[var(--ink-muted)]">
                  {db?.users.find((u) => u.id === d.userId)?.name || d.userId}
                </p>
              </div>
              {canWallet ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="tt-btn tt-btn-dark"
                    disabled={busy === d.id}
                    onClick={() => onVerifyWallet(d.id)}
                  >
                    {t("payVerify")}
                  </button>
                  <button
                    type="button"
                    className="tt-btn tt-btn-outline"
                    disabled={busy === d.id}
                    onClick={() => onRejectWallet(d.id)}
                  >
                    {t("payReject")}
                  </button>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {!wallets.length ? (
        <AccountsEmpty message={t("payNoneWallet")} />
      ) : null}
    </AccountsShell>
  );
}

function OrderProofCard({
  order,
  locale,
  busy,
  canVerify,
  onVerify,
  t,
}: {
  order: Order;
  locale: "en" | "hi";
  busy: boolean;
  canVerify: boolean;
  onVerify: () => void;
  t: (key: string) => string;
}) {
  const amt = orderVerifyAmount(order);
  const items = getProofItems(order.paymentProof);
  const thisPart = items[items.length - 1]?.amount ?? amt.paid;
  const partPaid = amt.paid > 0.05 && amt.remaining > 0.05;
  const paid = amt.paid > 0.05 && amt.remaining <= 0.05;

  return (
    <li className="tt-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/admin/orders?q=${encodeURIComponent(order.orderNumber)}`}
              className="font-semibold text-[var(--brand-deep)] underline"
            >
              {order.orderNumber}
            </Link>
            {partPaid ? (
              <span className="rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--brand-deep)]">
                {t("payPartPaid")}
              </span>
            ) : null}
            {paid ? (
              <span className="rounded-full bg-[var(--ok)]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--ok)]">
                {t("payPaid")}
              </span>
            ) : null}
          </div>
          <dl className="mt-2 space-y-0.5 text-sm">
            <div className="flex gap-3">
              <dt className="text-[var(--ink-muted)]">{t("payDue")}</dt>
              <dd className="tabular-nums font-semibold">
                {formatInr(amt.due, locale)}
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="text-[var(--ink-muted)]">{t("payThisPart")}</dt>
              <dd className="tabular-nums font-semibold">
                {formatInr(thisPart, locale)}
              </dd>
            </div>
            <div className="flex gap-3">
              <dt className="text-[var(--ink-muted)]">{t("payStillLeft")}</dt>
              <dd
                className={`tabular-nums font-semibold ${
                  amt.remaining > 0.05 ? "text-[var(--danger)]" : ""
                }`}
              >
                {formatInr(amt.remaining, locale)}
              </dd>
            </div>
          </dl>
          <p className="mt-1 text-xs text-[var(--ink-muted)]">
            {t("payIn")} {formatInr(amt.paid, locale)} · {items.length}{" "}
            {t("payFiles")}
          </p>
          {items.length ? (
            <ul className="mt-2 space-y-1 text-xs">
              {items.map((it) => (
                <li key={it.id}>
                  {it.payRef ? (
                    <span className="font-mono font-semibold text-[var(--brand-deep)]">
                      {it.payRef}
                    </span>
                  ) : (
                    <span className="text-[var(--ink-muted)]">—</span>
                  )}
                  {typeof it.amount === "number" && it.amount > 0
                    ? ` · ${formatInr(it.amount, locale)}`
                    : ""}
                  {it.note ? ` · ${t("payUtr")} ${it.note}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {canVerify ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="tt-btn tt-btn-dark"
              disabled={busy}
              onClick={onVerify}
            >
              {amt.remaining > 0.05 ? t("payForce") : t("payVerify")}
            </button>
          </div>
        ) : null}
      </div>
    </li>
  );
}
