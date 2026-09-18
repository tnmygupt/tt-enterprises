"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { EmptyState } from "@/components/admin/EmptyState";
import { FilterChips } from "@/components/admin/FilterChips";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { TableWrap } from "@/components/admin/TableWrap";
import { AdminShell } from "@/components/AdminShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import {
  orderNextActionHref,
  orderNextActionKey,
  orderNextActionLabelKey,
} from "@/lib/admin-queues";
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
    { key: "estimate", label: t("admin.queueEstimates") },
    { key: "need_bill", label: t("admin.queueNeedBill") },
    { key: "need_voucher", label: t("admin.queueNeedVoucher") },
    { key: "need_verify", label: t("admin.queueVerifyPay") },
    { key: "need_lr", label: t("admin.queueNeedLr") },
    { key: "full_truck", label: t("admin.queueFullTruck") },
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

  const filterCounts = useMemo(() => {
    const list = db?.orders ?? [];
    const vouchers = db?.vouchers ?? [];
    const countFor = (key: FilterKey) => {
      const isQueue =
        key === "estimate" ||
        key === "need_bill" ||
        key === "need_voucher" ||
        key === "need_verify" ||
        key === "need_lr" ||
        key === "full_truck";
      return list.filter((o) => {
        if (
          !isQueue &&
          !isOpenWorkOrder(o) &&
          !inRange(o.createdAt, range.from, range.to)
        ) {
          return false;
        }
        if (key === "all") return true;
        return matchesFilter(o, key, vouchers);
      }).length;
    };
    return {
      all: countFor("all"),
      estimate: countFor("estimate"),
      need_bill: countFor("need_bill"),
      need_voucher: countFor("need_voucher"),
      need_verify: countFor("need_verify"),
      need_lr: countFor("need_lr"),
      full_truck: countFor("full_truck"),
      dispatched: countFor("dispatched"),
      delivered: countFor("delivered"),
    } satisfies Record<FilterKey, number>;
  }, [db, range.from, range.to]);

  const nextLabel = (o: Order) =>
    t(`admin.${orderNextActionLabelKey(o)}` as "admin.nextActionOpen");

  const emptyCopy = !cloudReady
    ? t("common.loading")
    : !rows.length && hiddenByDate > 0
      ? t("admin.ordersOutsideHint", { hidden: hiddenByDate })
      : !rows.length && (db?.orders?.length ?? 0) === 0
        ? t("admin.ordersNoneCloud")
        : !rows.length && cancelledCount > 0 && filter === "estimate"
          ? t("admin.ordersCancelledHint", { count: cancelledCount })
          : !rows.length
            ? t("common.empty")
            : "";

  // Placed after every hook so the gate can never change the hook order
  if (!canViewOrders) {
    return <AdminAccessDenied title={t("admin.orders")} />;
  }

  return (
    <>
      <AdminPageHeader
        title={t("admin.orders")}
        hint={t("admin.ordersHint")}
        actions={
          <>
            {canManage ? (
              <Link href="/admin/orders/new" className="tt-btn tt-btn-dark">
                {t("admin.newOrder")}
              </Link>
            ) : null}
            <input
              className="tt-input max-w-xs"
              placeholder={t("common.search")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </>
        }
      />

      {queueFilter ? (
        <p className="mt-4 rounded-lg border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-950">
          {t("admin.ordersQueueHint")}
        </p>
      ) : (
        <DateRangeBar value={range} onChange={setRange} className="mt-4" />
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <FilterChips
          items={filters.map((f) => ({
            id: f.key,
            label: f.label,
            count: filterCounts[f.key],
            active: filter === f.key,
            href:
              f.key === "all"
                ? "/admin/orders"
                : `/admin/orders?filter=${f.key}`,
          }))}
        />
        <p className="text-xs text-[var(--ink-muted)]">
          {queueFilter
            ? t("admin.ordersPendingCount", { count: rows.length })
            : hiddenByDate
              ? `${t("admin.ordersInRange", { count: rows.length })} · ${t("admin.ordersOutside", { hidden: hiddenByDate })}`
              : t("admin.ordersInRange", { count: rows.length })}
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
              {nextLabel(o)}
            </p>
            <p className="mt-1 text-sm tabular-nums">
              {formatInr(o.estimatedTotal, locale)}
              {o.actualBillAmount != null
                ? ` · ${formatInr(o.actualBillAmount, locale)}`
                : ""}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={orderNextActionHref(o)}
                className="tt-btn tt-btn-dark min-h-11 px-3 text-sm font-bold"
              >
                {nextLabel(o)}
              </Link>
              <Link
                href={`/orders/${o.id}`}
                className="tt-btn tt-btn-outline min-h-11 px-3 text-sm font-bold"
              >
                {t("admin.openOrder")}
              </Link>
              {canManage &&
              orderNextActionKey(o) !== "confirmBill" &&
              orderNextActionKey(o) !== "uploadBill" ? (
                <Link
                  href={`/admin/orders/${o.id}/packing-slip`}
                  className="tt-btn tt-btn-outline min-h-11 px-3 text-sm font-bold"
                >
                  {t("admin.packingShort")}
                </Link>
              ) : null}
              {orderNeedsSaleVoucher(o, db?.vouchers ?? []) ? (
                <Link
                  href={`/orders/${o.id}`}
                  className="tt-btn tt-btn-dark min-h-11 px-3 text-sm font-bold"
                >
                  {t("admin.postToBooks")}
                </Link>
              ) : null}
            </div>
          </div>
        ))}
        {emptyCopy ? (
          <EmptyState
            message={emptyCopy}
            href={canManage ? "/admin/orders/new" : undefined}
            cta={canManage ? t("admin.newOrder") : undefined}
          />
        ) : null}
      </div>

      <TableWrap className="tt-panel mt-5 hidden sm:block">
        <table className="tt-table min-w-[980px]">
          <thead>
            <tr>
              <th>{t("admin.colOrder")}</th>
              <th>{t("admin.colCustomer")}</th>
              <th>{t("common.status")}</th>
              <th>{t("admin.colNext")}</th>
              <th>{t("admin.colEstimate")}</th>
              <th>{t("admin.colBill")}</th>
              <th>{t("admin.colTruck")}</th>
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
                      {t("admin.transport")}: {o.transport}
                    </div>
                  ) : null}
                </td>
                <td>
                  <StatusBadge
                    tone={
                      o.status === "cancelled"
                        ? "danger"
                        : o.status === "delivered"
                          ? "ok"
                          : "pending"
                    }
                  >
                    {t(`orderStatus.${o.status}` as "orderStatus.estimate")}
                  </StatusBadge>
                </td>
                <td className="max-w-[140px] text-sm text-[var(--ink-muted)]">
                  {nextLabel(o)}
                </td>
                <td className="tabular-nums">
                  {formatInr(o.estimatedTotal, locale)}
                </td>
                <td className="tabular-nums">
                  {o.actualBillAmount != null
                    ? formatInr(o.actualBillAmount, locale)
                    : "—"}
                </td>
                <td>{o.fullTruckRequested ? t("admin.yes") : "—"}</td>
                <td>
                  <div className="flex flex-col gap-2 text-sm">
                    <Link
                      href={orderNextActionHref(o)}
                      className="tt-btn tt-btn-dark min-h-11 px-3 text-sm font-bold"
                    >
                      {nextLabel(o)}
                    </Link>
                    <details className="rounded-lg border border-[var(--line)] px-2 py-1">
                      <summary className="cursor-pointer text-xs font-semibold text-[var(--ink-muted)]">
                        {t("common.actions")}
                      </summary>
                      <div className="mt-2 flex flex-col gap-2">
                    <Link
                      href={`/orders/${o.id}`}
                      className="tt-btn tt-btn-outline min-h-11 px-3 text-sm font-bold"
                    >
                      {t("admin.openOrder")}
                    </Link>
                    {canManage ? (
                      <Link
                        href={`/admin/orders/${o.id}/packing-slip`}
                        className="tt-btn tt-btn-outline min-h-11 px-3 text-sm font-bold"
                      >
                        {t("admin.packingShort")}
                      </Link>
                    ) : null}
                    {(() => {
                      const items = getProofItems(o.paymentProof);
                      const first = items[0];
                      if (!first?.url) return null;
                      return (
                        <a
                          href={first.url}
                          target="_blank"
                          rel="noreferrer"
                          className="tt-btn tt-btn-outline px-2 py-1.5 text-xs font-bold"
                        >
                      {items.length > 1
                        ? t("admin.proofsCount", { count: items.length })
                        : t("admin.viewProof")}
                        </a>
                      );
                    })()}
                    {o.paymentProof && !o.paymentProof.verified ? (
                      <p className="text-[10px] text-[var(--ink-muted)] tabular-nums">
                        {formatInr(proofPaidTotal(o.paymentProof), locale)}
                        {" / "}
                        {formatInr(paymentAmountDue(o), locale)}
                        {proofRemaining(o.paymentProof, paymentAmountDue(o)) >
                        0
                          ? ` ${t("admin.amountLeft")}`
                          : ""}
                      </p>
                    ) : null}
                    {o.paymentProof?.verified ? (
                      <span className="inline-flex items-center justify-center rounded-lg px-2 py-1.5 text-xs font-bold text-white"
                        style={{ background: "var(--ok)" }}
                      >
                        {t("admin.verified")}
                      </span>
                    ) : o.paymentProof && canVerify ? (
                      <button
                        type="button"
                        className="tt-btn tt-btn-dark px-2 py-1.5 text-xs font-bold"
                        onClick={() => {
                          if (!session) return;
                          const rem = proofRemaining(
                            o.paymentProof,
                            paymentAmountDue(o)
                          );
                          if (
                            rem > 0 &&
                            !confirm(
                              t("admin.forceVerifyConfirm", {
                                amount: formatInr(rem, locale),
                              })
                            )
                          ) {
                            return;
                          }
                          if (
                            rem <= 0 &&
                            !confirm(t("admin.markVerifiedConfirm"))
                          ) {
                            return;
                          }
                          try {
                            verifyPayment(o.id, session.id, {
                              force: rem > 0,
                            });
                          } catch (err) {
                            window.alert(
                              err instanceof Error
                                ? err.message
                                : t("admin.verifyFailed")
                            );
                            return;
                          }
                          if (db) {
                            void notifyOrderWhatsApp({
                              order: {
                                ...o,
                                status: "payment_verified",
                                paymentProof: {
                                  ...o.paymentProof!,
                                  verified: true,
                                },
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
                        {t("admin.verify")}
                      </button>
                    ) : null}
                    {canManage && o.status === "estimate" ? (
                      <button
                        type="button"
                        className="tt-btn tt-btn-outline px-2 py-1.5 text-xs font-bold"
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
                        {t("admin.confirmShort")}
                      </button>
                    ) : null}
                    {canManage && o.status === "payment_verified" ? (
                      <button
                        type="button"
                        className="tt-btn tt-btn-dark px-2 py-1.5 text-xs font-bold"
                        onClick={() => {
                          try {
                            markOrderDispatched(o.id);
                          } catch (err) {
                            alert(
                              err instanceof Error
                                ? err.message
                                : t("admin.cannotDispatch")
                            );
                            return;
                          }
                          if (db) {
                            void notifyOrderWhatsApp({
                              order: { ...o, status: "dispatched" },
                              status: "dispatched",
                              settings: db.settings,
                              users: db.users,
                              locale,
                              extraNote: t("admin.lrUploadPending"),
                            });
                          }
                          refresh();
                        }}
                      >
                        {t("admin.dispatch")}
                      </button>
                    ) : null}
                    {o.status === "dispatched" && !orderHasLr(o) ? (
                      <Link
                        href={`/orders/${o.id}`}
                        className="tt-btn tt-btn-outline px-2 py-1.5 text-xs font-bold"
                      >
                        {t("admin.lrToDelivered")}
                      </Link>
                    ) : null}
                    {canManage && o.status === "payment_verified" ? (
                      <Link
                        href={`/orders/${o.id}`}
                        className="tt-btn tt-btn-outline px-2 py-1.5 text-xs font-bold"
                      >
                        {t("admin.lrToDelivered")}
                      </Link>
                    ) : null}
                    {canManage &&
                    o.status === "dispatched" &&
                    orderHasLr(o) ? (
                      <button
                        type="button"
                        className="tt-btn tt-btn-outline px-2 py-1.5 text-xs font-bold"
                        onClick={() => {
                          try {
                            updateOrderStatus(
                              o.id,
                              "delivered" as OrderStatus,
                              "Marked delivered"
                            );
                          } catch (err) {
                            alert(
                              err instanceof Error
                                ? err.message
                                : t("admin.cannotDeliver")
                            );
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
                        {t("admin.markDelivered")}
                      </button>
                    ) : null}
                    {canManage && canCancelOrderStatus(o.status) ? (
                      <button
                        type="button"
                        className="text-left text-[var(--danger)]"
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
                            alert(
                              err instanceof Error
                                ? err.message
                                : "Cannot cancel"
                            );
                          }
                        }}
                      >
                        {t("common.cancelOrder")}
                      </button>
                    ) : null}
                      </div>
                    </details>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {emptyCopy ? (
          <EmptyState
            message={emptyCopy}
            href={canManage ? "/admin/orders/new" : undefined}
            cta={canManage ? t("admin.newOrder") : undefined}
          />
        ) : null}
      </TableWrap>
    </>
  );
}

export default function AdminOrdersPage() {
  const t = useTranslations();
  return (
    <AdminShell>
      <Suspense fallback={<p>{t("common.loading")}</p>}>
        <AdminOrdersInner />
      </Suspense>
    </AdminShell>
  );
}
