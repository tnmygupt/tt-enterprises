"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { orderNextAction } from "@/lib/admin-queues";
import { inRange } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { getProofItems, proofPaidTotal, proofRemaining } from "@/lib/proofs";
import { paymentAmountDue } from "@/lib/upi";
import {
  canCancelOrderStatus,
  cancelOrder,
  checkCapability,
  markOrderDispatched,
  orderHasLr,
  updateOrderStatus,
  verifyPayment,
} from "@/lib/store/db";
import type { Order, OrderStatus, Voucher } from "@/lib/types";
import { notifyOrderWhatsApp } from "@/lib/whatsapp";

type FilterKey =
  | "all"
  | "estimate"
  | "need_bill"
  | "need_voucher"
  | "need_verify"
  | "need_lr"
  | "full_truck"
  | "dispatched"
  | "delivered";

function isOpenWorkOrder(o: Order): boolean {
  return (
    o.status === "estimate" ||
    o.status === "confirmed" ||
    o.status === "payment_pending" ||
    Boolean(o.paymentProof && !o.paymentProof.verified)
  );
}

function orderNeedsSaleVoucher(o: Order, vouchers: Voucher[]): boolean {
  return (
    o.status !== "cancelled" &&
    o.actualBillAmount != null &&
    !vouchers.some(
      (v) => v.linkedOrderId === o.id && v.type === "sale" && !v.voided
    )
  );
}

function matchesFilter(
  o: Order,
  filter: FilterKey,
  vouchers: Voucher[]
): boolean {
  switch (filter) {
    case "all":
      return true;
    case "estimate":
      return o.status === "estimate";
    case "need_bill":
      return (
        (o.status === "estimate" || o.status === "confirmed") &&
        o.actualBillAmount == null
      );
    case "need_voucher":
      return orderNeedsSaleVoucher(o, vouchers);
    case "need_verify":
      return Boolean(o.paymentProof && !o.paymentProof.verified);
    case "need_lr":
      return o.status === "dispatched" && !orderHasLr(o);
    case "full_truck":
      return o.fullTruckRequested && o.status !== "cancelled";
    case "dispatched":
      return o.status === "dispatched";
    case "delivered":
      return o.status === "delivered";
    default:
      return true;
  }
}

const ACTION_BTN = "tt-btn tt-btn-outline px-2 py-1.5 text-xs font-bold";
const ACTION_BTN_DARK = "tt-btn tt-btn-dark px-2 py-1.5 text-xs font-bold";

function OrderQueueActions({
  o,
  locale,
  t,
  canManage,
  canVerify,
  session,
  db,
  refresh,
  stacked,
}: {
  o: Order;
  locale: "en" | "hi";
  t: ReturnType<typeof useTranslations>;
  canManage: boolean;
  canVerify: boolean;
  session: { id: string } | null;
  db: ReturnType<typeof useDb>["db"];
  refresh: () => void;
  stacked?: boolean;
}) {
  const items = getProofItems(o.paymentProof);
  const first = items[0];
  const rem = proofRemaining(o.paymentProof, paymentAmountDue(o));
  return (
    <div className={stacked ? "flex flex-col gap-2 text-sm" : "flex flex-wrap gap-2"}>
      <Link href={`/orders/${o.id}`} className={ACTION_BTN}>
        {locale === "hi" ? "खोलें" : "Open"}
      </Link>
      {canManage ? (
        <Link href={`/admin/orders/${o.id}/packing-slip`} className={ACTION_BTN}>
          {locale === "hi" ? "पैकिंग" : "Packing"}
        </Link>
      ) : null}
      {orderNeedsSaleVoucher(o, db?.vouchers ?? []) ? (
        <Link href={`/orders/${o.id}`} className={ACTION_BTN_DARK}>
          {locale === "hi" ? "बुक में डालें" : "Post to books"}
        </Link>
      ) : null}
      {first?.url ? (
        <a href={first.url} target="_blank" rel="noreferrer" className={ACTION_BTN}>
          {locale === "hi"
            ? items.length > 1
              ? `प्रूफ (${items.length})`
              : "प्रूफ देखें"
            : items.length > 1
              ? `Proofs (${items.length})`
              : "View proof"}
        </a>
      ) : null}
      {o.paymentProof && !o.paymentProof.verified ? (
        <p className="text-[10px] text-[var(--ink-muted)] tabular-nums">
          {formatInr(proofPaidTotal(o.paymentProof), locale)}
          {" / "}
          {formatInr(paymentAmountDue(o), locale)}
          {rem > 0 ? (locale === "hi" ? " बाकी" : " left") : ""}
        </p>
      ) : null}
      {o.paymentProof?.verified ? (
        <span
          className="inline-flex items-center justify-center rounded-lg px-2 py-1.5 text-xs font-bold text-white"
          style={{ background: "var(--ok)" }}
        >
          {locale === "hi" ? "✓ वेरिफाइड" : "✓ Verified"}
        </span>
      ) : o.paymentProof && canVerify ? (
        <button
          type="button"
          className={ACTION_BTN_DARK}
          onClick={() => {
            if (!session) return;
            if (
              rem > 0 &&
              !confirm(
                locale === "hi"
                  ? `अभी ${formatInr(rem, locale)} बाकी है। Force-verify करें?`
                  : `${formatInr(rem, locale)} still outstanding. Force-verify anyway?`
              )
            ) {
              return;
            }
            if (
              rem <= 0 &&
              !confirm(
                locale === "hi" ? "पेमेंट वेरिफाई करें?" : "Mark payment as verified?"
              )
            ) {
              return;
            }
            try {
              verifyPayment(o.id, session.id, { force: rem > 0 });
            } catch (err) {
              window.alert(err instanceof Error ? err.message : "Verify failed");
              return;
            }
            if (db) {
              void notifyOrderWhatsApp({
                order: {
                  ...o,
                  status: "payment_verified",
                  paymentProof: { ...o.paymentProof!, verified: true },
                },
                status: "payment_verified",
                settings: db.settings,
                users: db.users,
                locale,
              });
            }
            refresh();
          }}
        >
          {locale === "hi" ? "वेरिफाई" : "Verify"}
        </button>
      ) : null}
      {canManage && o.status === "estimate" ? (
        <button
          type="button"
          className={ACTION_BTN}
          onClick={() => {
            updateOrderStatus(o.id, "confirmed", "Confirmed by admin");
            if (db) {
              void notifyOrderWhatsApp({
                order: { ...o, status: "confirmed" },
                status: "confirmed",
                settings: db.settings,
                users: db.users,
                locale,
              });
            }
            refresh();
          }}
        >
          {locale === "hi" ? "कन्फर्म" : "Confirm"}
        </button>
      ) : null}
      {canManage && o.status === "payment_verified" ? (
        <button
          type="button"
          className={ACTION_BTN_DARK}
          onClick={() => {
            try {
              markOrderDispatched(o.id);
            } catch (err) {
              alert(err instanceof Error ? err.message : "Cannot dispatch");
              return;
            }
            if (db) {
              void notifyOrderWhatsApp({
                order: { ...o, status: "dispatched" },
                status: "dispatched",
                settings: db.settings,
                users: db.users,
                locale,
                extraNote: locale === "hi" ? "LR अपलोड बाकी" : "LR upload pending",
              });
            }
            refresh();
          }}
        >
          {locale === "hi" ? "डिस्पैच" : "Dispatch"}
        </button>
      ) : null}
      {(o.status === "dispatched" && !orderHasLr(o)) ||
      (canManage && o.status === "payment_verified") ? (
        <Link href={`/orders/${o.id}`} className={ACTION_BTN}>
          {locale === "hi" ? "LR → डिलीवर" : "LR → delivered"}
        </Link>
      ) : null}
      {canManage && o.status === "dispatched" && orderHasLr(o) ? (
        <button
          type="button"
          className={ACTION_BTN}
          onClick={() => {
            try {
              updateOrderStatus(o.id, "delivered" as OrderStatus, "Marked delivered");
            } catch (err) {
              alert(err instanceof Error ? err.message : "Cannot mark delivered");
              return;
            }
            if (db) {
              void notifyOrderWhatsApp({
                order: { ...o, status: "delivered" },
                status: "delivered",
                settings: db.settings,
                users: db.users,
                locale,
              });
            }
            refresh();
          }}
        >
          {locale === "hi" ? "डिलीवर" : "Delivered"}
        </button>
      ) : null}
      {canManage && canCancelOrderStatus(o.status) ? (
        <button
          type="button"
          className="text-left text-xs font-semibold text-[var(--danger)]"
          onClick={() => {
            if (!session) return;
            if (!confirm(t("common.cancelOrderConfirm"))) return;
            try {
              cancelOrder(o.id, session.id, "Cancelled by admin");
              if (db) {
                void notifyOrderWhatsApp({
                  order: { ...o, status: "cancelled" },
                  status: "cancelled",
                  settings: db.settings,
                  users: db.users,
                  locale,
                });
              }
              refresh();
            } catch (err) {
              alert(err instanceof Error ? err.message : "Cannot cancel");
            }
          }}
        >
          {t("common.cancelOrder")}
        </button>
      ) : null}
    </div>
  );
}

function AdminOrdersInner() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const searchParams = useSearchParams();
  const rawFilter = searchParams.get("filter") || "all";
  const urlFilter: FilterKey = (
    [
      "all",
      "estimate",
      "need_bill",
      "need_voucher",
      "need_verify",
      "need_lr",
      "full_truck",
      "dispatched",
      "delivered",
    ] as FilterKey[]
  ).includes(rawFilter as FilterKey)
    ? (rawFilter as FilterKey)
    : "all";
  const [filter, setFilter] = useState<FilterKey>(urlFilter);
  const [q, setQ] = useState(searchParams.get("q") || "");
  const [range, setRange] = useAdminDateRange("today");
  const { db, refresh, cloudReady } = useDb();
  const { session } = useSession();
  const canManage = session && checkCapability(session, db, "manage_orders");
  const canVerify = session && checkCapability(session, db, "verify_payment");
  const canBill = session && checkCapability(session, db, "upload_bill");
  const canLr = session && checkCapability(session, db, "upload_lr");
  const canViewOrders = !!(canManage || canVerify || canBill || canLr);

  useEffect(() => {
    // URL query drives active filter — intentional sync
    /* eslint-disable react-hooks/set-state-in-effect */
    setFilter(urlFilter);
    const qq = searchParams.get("q");
    if (qq) setQ(qq);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [urlFilter, searchParams]);

  const filters: { key: FilterKey; label: string }[] = [
    { key: "all", label: t("common.all") },
    { key: "estimate", label: locale === "hi" ? "नए अनुमान" : "Estimates" },
    { key: "need_bill", label: locale === "hi" ? "बिल बाकी" : "Need bill" },
    {
      key: "need_voucher",
      label: locale === "hi" ? "बुक बाकी" : "Need voucher",
    },
    { key: "need_verify", label: locale === "hi" ? "पेमेंट जाँच" : "Verify pay" },
    {
      key: "need_lr",
      label: locale === "hi" ? "LR बाकी" : "Pending LR",
    },
    { key: "full_truck", label: locale === "hi" ? "फुल ट्रक" : "Full truck" },
    { key: "dispatched", label: t("orderStatus.dispatched") },
    { key: "delivered", label: t("orderStatus.delivered") },
  ];

  // Work-queue filters are open work — ignore date range so pending items always show
  const queueFilter =
    filter === "estimate" ||
    filter === "need_bill" ||
    filter === "need_voucher" ||
    filter === "need_verify" ||
    filter === "need_lr" ||
    filter === "full_truck";

  const rows = useMemo(() => {
    const list = db?.orders ?? [];
    return list.filter((o) => {
      if (
        !queueFilter &&
        !isOpenWorkOrder(o) &&
        !inRange(o.createdAt, range.from, range.to)
      ) {
        return false;
      }
      if (!matchesFilter(o, filter, db?.vouchers ?? [])) return false;
      if (!q.trim()) return true;
      const hay =
        `${o.orderNumber} ${o.userName} ${o.userEmail} ${o.phone ?? ""} ${o.gstOrAadhar ?? ""}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });
  }, [db, filter, q, queueFilter, range.from, range.to]);

  const hiddenByDate = useMemo(() => {
    if (queueFilter) return 0;
    return (db?.orders ?? []).filter(
      (o) => !isOpenWorkOrder(o) && !inRange(o.createdAt, range.from, range.to)
    ).length;
  }, [db, queueFilter, range.from, range.to]);

  const cancelledCount = useMemo(
    () => (db?.orders ?? []).filter((o) => o.status === "cancelled").length,
    [db]
  );

  // Placed after every hook so the gate can never change the hook order
  if (!canViewOrders) {
    return <AdminAccessDenied title={t("admin.orders")} />;
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t("admin.orders")}</h1>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {locale === "hi"
              ? "फ़िल्टर करें, खोजें, बिल / LR / पेमेंट हैंडल करें"
              : "Filter, search, handle bill / LR / payment"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canManage ? (
            <Link href="/admin/orders/new" className="tt-btn tt-btn-dark">
              {locale === "hi" ? "+ नया ऑर्डर" : "+ New order"}
            </Link>
          ) : null}
          <input
            className="tt-input max-w-xs"
            placeholder={t("common.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>

      {queueFilter ? (
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
          {locale === "hi"
            ? "कार्य कतार — सभी खुले ऑर्डर (तारीख फ़िल्टर बंद)"
            : "Work queue — all open orders (date filter off)"}
        </p>
      ) : (
        <DateRangeBar value={range} onChange={setRange} className="mt-4" />
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {filters.map((f) => (
            <Link
              key={f.key}
              href={
                f.key === "all"
                  ? "/admin/orders"
                  : `/admin/orders?filter=${f.key}`
              }
              className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${
                filter === f.key
                  ? "tt-selected bg-[var(--brand-deep)] text-white"
                  : "border border-[var(--line)] bg-white text-[var(--ink-muted)]"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <p className="text-xs text-[var(--ink-muted)]">
          {queueFilter
            ? locale === "hi"
              ? `${rows.length} लंबित`
              : `${rows.length} pending`
            : locale === "hi"
              ? `${rows.length} ऑर्डर इस अवधि में${hiddenByDate ? ` · ${hiddenByDate} बाहर` : ""}`
              : `${rows.length} in range${hiddenByDate ? ` · ${hiddenByDate} outside` : ""}`}
        </p>
      </div>

      <div className="mt-4 space-y-2 sm:hidden">
        {rows.map((o) => (
          <div key={o.id} className="tt-panel p-3">
            <div className="flex items-start justify-between gap-2">
              <Link
                href={`/orders/${o.id}`}
                className="font-mono text-sm font-semibold text-[var(--brand)]"
              >
                {o.orderNumber}
              </Link>
              <span className="tt-status shrink-0">
                {t(`orderStatus.${o.status}` as "orderStatus.estimate")}
              </span>
            </div>
            <p className="mt-1 text-sm font-medium">
              {o.checkoutName || o.userName}
            </p>
            <p className="text-xs text-[var(--ink-muted)]">
              {o.phone || o.userEmail}
              {" · "}
              {new Date(o.createdAt).toLocaleDateString(
                locale === "hi" ? "hi-IN" : "en-IN"
              )}
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              {orderNextAction(o)}
            </p>
            <p className="mt-1 text-sm tabular-nums">
              {formatInr(o.estimatedTotal, locale)}
              {o.actualBillAmount != null
                ? ` · ${formatInr(o.actualBillAmount, locale)}`
                : ""}
            </p>
            <div className="mt-3">
              <OrderQueueActions
                o={o}
                locale={locale}
                t={t}
                canManage={!!canManage}
                canVerify={!!canVerify}
                session={session}
                db={db}
                refresh={refresh}
              />
            </div>
          </div>
        ))}
        {!cloudReady ? (
          <p className="p-2 text-sm text-[var(--ink-muted)]">{t("common.loading")}</p>
        ) : !rows.length && hiddenByDate > 0 ? (
          <p className="p-2 text-sm text-[var(--ink-muted)]">
            {locale === "hi"
              ? `${hiddenByDate} ऑर्डर इस तारीख के बाहर हैं — 7 दिन या अनुमान खोलें`
              : `${hiddenByDate} order(s) outside this date — open 7 days or Estimates`}
          </p>
        ) : !rows.length && (db?.orders?.length ?? 0) === 0 ? (
          <p className="p-2 text-sm text-[var(--ink-muted)]">
            {locale === "hi"
              ? "क्लाउड से कोई ऑर्डर नहीं आया। पेज रीफ़्रेश करें या फिर से लॉगिन करें।"
              : "No orders loaded from cloud. Refresh or log in again."}
          </p>
        ) : !rows.length && cancelledCount > 0 && filter === "estimate" ? (
          <p className="p-2 text-sm text-[var(--ink-muted)]">
            {locale === "hi"
              ? `${cancelledCount} रद्द ऑर्डर हैं — All खोलें`
              : `${cancelledCount} cancelled order(s). Open All to see them.`}
          </p>
        ) : !rows.length ? (
          <p className="p-2 text-sm text-[var(--ink-muted)]">{t("common.empty")}</p>
        ) : null}
      </div>

      <div className="tt-panel mt-5 hidden overflow-x-auto sm:block">
        <table className="tt-table min-w-[980px]">
          <thead>
            <tr>
              <th>Order</th>
              <th>Customer</th>
              <th>{t("common.status")}</th>
              <th>{locale === "hi" ? "अगला कदम" : "Next"}</th>
              <th>Estimate</th>
              <th>Bill</th>
              <th>Truck</th>
              <th>{t("common.actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td>
                  <Link
                    href={`/orders/${o.id}`}
                    className="font-mono text-sm font-semibold text-[var(--brand)] hover:underline"
                  >
                    {o.orderNumber}
                  </Link>
                  <div className="text-xs text-[var(--ink-muted)]">
                    {new Date(o.createdAt).toLocaleDateString(
                      locale === "hi" ? "hi-IN" : "en-IN"
                    )}
                  </div>
                </td>
                <td>
                  <div className="font-medium">{o.checkoutName || o.userName}</div>
                  <div className="text-xs text-[var(--ink-muted)]">
                    {o.phone || o.userEmail}
                  </div>
                  {o.transport ? (
                    <div className="text-xs text-[var(--ink-muted)]">
                      Transport: {o.transport}
                    </div>
                  ) : null}
                </td>
                <td>
                  <span className="tt-status">
                    {t(`orderStatus.${o.status}` as "orderStatus.estimate")}
                  </span>
                </td>
                <td className="max-w-[140px] text-sm text-[var(--ink-muted)]">
                  {orderNextAction(o)}
                </td>
                <td className="tabular-nums">
                  {formatInr(o.estimatedTotal, locale)}
                </td>
                <td className="tabular-nums">
                  {o.actualBillAmount != null
                    ? formatInr(o.actualBillAmount, locale)
                    : "—"}
                </td>
                <td>{o.fullTruckRequested ? "Yes" : "—"}</td>
                <td>
                  <OrderQueueActions
                    o={o}
                    locale={locale}
                    t={t}
                    canManage={!!canManage}
                    canVerify={!!canVerify}
                    session={session}
                    db={db}
                    refresh={refresh}
                    stacked
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!cloudReady ? (
          <p className="p-6 text-sm text-[var(--ink-muted)]">{t("common.loading")}</p>
        ) : !rows.length && hiddenByDate > 0 ? (
          <p className="p-6 text-sm text-[var(--ink-muted)]">
            {locale === "hi"
              ? `${hiddenByDate} ऑर्डर इस तारीख के बाहर हैं — 7 दिन या अनुमान खोलें`
              : `${hiddenByDate} order(s) outside this date — open 7 days or Estimates`}
          </p>
        ) : !rows.length && (db?.orders?.length ?? 0) === 0 ? (
          <p className="p-6 text-sm text-[var(--ink-muted)]">
            {locale === "hi"
              ? "क्लाउड से कोई ऑर्डर नहीं आया। पेज रीफ़्रेश करें या फिर से लॉगिन करें।"
              : "No orders loaded from cloud. Refresh or log in again."}
          </p>
        ) : !rows.length && cancelledCount > 0 && filter === "estimate" ? (
          <p className="p-6 text-sm text-[var(--ink-muted)]">
            {locale === "hi"
              ? `${cancelledCount} रद्द ऑर्डर हैं — All खोलें`
              : `${cancelledCount} cancelled order(s). Open All to see them.`}
          </p>
        ) : !rows.length ? (
          <p className="p-6 text-sm text-[var(--ink-muted)]">{t("common.empty")}</p>
        ) : null}
      </div>
    </>
  );
}

export default function AdminOrdersPage() {
  const t = useTranslations();
  return (
    <AccountsShell>
      <Suspense fallback={<p>{t("common.loading")}</p>}>
        <AdminOrdersInner />
      </Suspense>
    </AccountsShell>
  );
}
