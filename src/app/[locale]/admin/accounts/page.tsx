"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import {
  allOpenPayables,
  allOpenReceivables,
  leftoverReceipts,
  creditBlockedOrders,
  overdueAmount,
  overdueOpenReceivables,
  overLimitCustomers,
  runBooksHealthCheck,
} from "@/lib/accounting";
import { bankBooksTotal, cashInHand } from "@/lib/bank-accounts";
import { getAdminQueues } from "@/lib/admin-queues";
import { monthCloseStamp } from "@/lib/owner-monthly-audit";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import {
  canViewFinancials,
  checkCapability,
  listUnpricedGoodsReceipts,
} from "@/lib/store/db";

/** Primary taps — sale, stock in, money, statement. */
const DO_NOW: {
  href: string;
  labelKey: string;
  term: string;
  ownerOnly?: boolean;
}[] = [
  {
    href: "/admin/orders/new",
    labelKey: "newSale",
    term: "F8",
  },
  {
    href: "/admin/accounts/goods-received",
    labelKey: "goodsReceived",
    term: "F9",
  },
  {
    href: "/admin/accounts/vouchers?new=receipt",
    labelKey: "moneyReceived",
    term: "F6",
  },
  {
    href: "/admin/accounts/payments",
    labelKey: "paymentDesk",
    term: "UPI",
  },
  {
    href: "/admin/accounts/expenses",
    labelKey: "logExpense",
    term: "Alt+E",
  },
  {
    href: "/admin/accounts/party-statement",
    labelKey: "statement",
    term: "Alt+S",
  },
  {
    href: "/admin/accounts/receivables?overdue=1",
    labelKey: "overdue",
    term: "Due",
  },
  {
    href: "/admin/accounts/production",
    labelKey: "production",
    term: "BOM",
  },
  {
    href: "/admin/accounts/vouchers?new=payment",
    labelKey: "moneyPaid",
    term: "F5",
    ownerOnly: true,
  },
  {
    href: "/admin/accounts/needs-pricing",
    labelKey: "needsPricing",
    term: "Alt+N",
    ownerOnly: true,
  },
];

const MORE: {
  href: string;
  labelKey: string;
  ownerOnly?: boolean;
}[] = [
  { href: "/admin/accounts/vouchers?new=sale", labelKey: "saleVoucher" },
  { href: "/admin/accounts/brs", labelKey: "brs" },
  { href: "/admin/accounts/journal", labelKey: "journal" },
  { href: "/admin/accounts/match-statement", labelKey: "matchStatement" },
  { href: "/admin/accounts/inventory", labelKey: "stock" },
  { href: "/admin/accounts/production", labelKey: "production" },
  { href: "/admin/accounts/cash-bank", labelKey: "cashBankBook" },
  { href: "/admin/accounts/daybook", labelKey: "daybook" },
  { href: "/admin/accounts/vouchers", labelKey: "allEntries" },
  { href: "/admin/accounts/purchases", labelKey: "purchaseBills", ownerOnly: true },
  { href: "/admin/accounts/openings", labelKey: "openingBalances", ownerOnly: true },
  { href: "/admin/accounts/reports", labelKey: "reportsHub" },
  { href: "/admin/accounts/search", labelKey: "search" },
  { href: "/admin/help?tab=books", labelKey: "helpBooks" },
  { href: "/admin/accounts/controls/flow-audit", labelKey: "flowAudit" },
];

export default function AccountsHomePage() {
  const t = useTranslations("accounts");
  const { session } = useSession();
  const { db } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;
  const today = new Date().toISOString().slice(0, 10);

  const stats = useMemo(() => {
    if (!db) return null;
    const salesToday = db.vouchers
      .filter((v) => v.type === "sale" && !v.voided && v.date === today)
      .reduce((s, v) => s + v.total, 0);
    const toCollect = allOpenReceivables(
      db.parties,
      db.vouchers,
      db.billAllocations ?? [],
      today,
      db.orders
    ).reduce((s, r) => s + r.outstanding, 0);
    const toPay = allOpenPayables(
      db.parties,
      db.vouchers,
      db.billAllocations ?? [],
      today
    ).reduce((s, r) => s + r.outstanding, 0);
    const needBill = getAdminQueues(db).needBill.length;
    const needVerify = getAdminQueues(db).needVerifyPayment.length;
    const needVoucher = db.orders.filter(
      (o) =>
        o.status !== "cancelled" &&
        o.actualBillAmount != null &&
        !db.vouchers.some(
          (v) => v.linkedOrderId === o.id && v.type === "sale" && !v.voided
        )
    ).length;
    const needPricing = listUnpricedGoodsReceipts(db).length;
    const leftover = leftoverReceipts(
      db.vouchers,
      db.billAllocations ?? []
    ).length;
    const posted = db.vouchers.filter((v) => !v.voided).length;
    const overdueRows = overdueOpenReceivables(
      db.parties,
      db.vouchers,
      db.billAllocations ?? [],
      today,
      db.orders
    );
    const queues = getAdminQueues(db);
    const health = runBooksHealthCheck({
      accounts: db.accounts,
      ledgerEntries: db.ledgerEntries,
      parties: db.parties,
      vouchers: db.vouchers,
      billAllocations: db.billAllocations,
      orders: db.orders,
      stockBatches: db.stockBatches,
      goodsReceipts: db.goodsReceipts,
      asOf: today,
    });
    const month = today.slice(0, 7);
    const monthClosed = !!monthCloseStamp(db.monthlyAudits, month);
    return {
      cash: cashInHand(db.accounts, db.ledgerEntries, today),
      bank: bankBooksTotal(db.accounts, db.ledgerEntries, today),
      salesToday,
      toCollect,
      toPay,
      needBill,
      needVerify,
      needVoucher,
      needPricing,
      leftover,
      posted,
      overdueAmt: overdueAmount(overdueRows),
      overdueCount: overdueRows.length,
      overLimit: overLimitCustomers(db.parties, db.ledgerEntries).length,
      blocked: creditBlockedOrders(db.orders).length,
      needLr: queues.needLr.length,
      fullTruck: queues.fullTruck.length,
      healthFails: health.failCount,
      monthClosed,
    };
  }, [db, today]);

  if (!session || !checkCapability(session, db, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const money: { labelKey: string; value: number; href: string }[] = [
    {
      labelKey: "cashInHand",
      value: stats?.cash ?? 0,
      href: "/admin/accounts/cash-bank",
    },
    {
      labelKey: "bankBalance",
      value: stats?.bank ?? 0,
      href: "/admin/accounts/cash-bank",
    },
    {
      labelKey: "moneyToCollect",
      value: stats?.toCollect ?? 0,
      href: "/admin/accounts/receivables",
    },
    {
      labelKey: "overdue",
      value: stats?.overdueAmt ?? 0,
      href: "/admin/accounts/receivables?overdue=1",
    },
    ...(isOwner
      ? [
          {
            labelKey: "moneyToPay",
            value: stats?.toPay ?? 0,
            href: "/admin/accounts/payables",
          },
        ]
      : [
          {
            labelKey: "salesToday",
            value: stats?.salesToday ?? 0,
            href: "/admin/accounts/daybook",
          },
        ]),
  ];

  const attention = [
    ...((stats?.needPricing ?? 0) > 0
      ? [
          {
            href: isOwner
              ? "/admin/accounts/needs-pricing"
              : "/admin/accounts/goods-received",
            labelKey: isOwner ? "goodsWaitingYourRate" : "goodsWaitingRate",
            value: stats?.needPricing ?? 0,
            tone: "warn" as const,
          },
        ]
      : []),
    ...((stats?.needVerify ?? 0) > 0
      ? [
          {
            href: "/admin/accounts/payments",
            labelKey: "payOrderProofs",
            value: stats?.needVerify ?? 0,
            tone: "danger" as const,
          },
        ]
      : []),
    ...((stats?.needBill ?? 0) > 0
      ? [
          {
            href: "/admin/orders?filter=need_bill",
            labelKey: "ordersWaitingBill",
            value: stats?.needBill ?? 0,
            tone: "warn" as const,
          },
        ]
      : []),
    ...((stats?.needVoucher ?? 0) > 0
      ? [
          {
            href: "/admin/orders?filter=need_voucher",
            labelKey: "billsNotPosted",
            value: stats?.needVoucher ?? 0,
            tone: "warn" as const,
          },
        ]
      : []),
    ...((stats?.leftover ?? 0) > 0
      ? [
          {
            href: "/admin/accounts/payments",
            labelKey: "leftoverReceipts",
            value: stats?.leftover ?? 0,
            tone: "warn" as const,
          },
        ]
      : []),
    ...((stats?.overdueCount ?? 0) > 0
      ? [
          {
            href: "/admin/accounts/receivables?overdue=1",
            labelKey: "overdue",
            value: stats?.overdueCount ?? 0,
            tone: "danger" as const,
          },
        ]
      : []),
    ...((stats?.overLimit ?? 0) > 0
      ? [
          {
            href: "/admin/accounts/receivables",
            labelKey: "overLimitDealers",
            value: stats?.overLimit ?? 0,
            tone: "danger" as const,
          },
        ]
      : []),
    ...((stats?.blocked ?? 0) > 0
      ? [
          {
            href: "/admin/orders?filter=need_bill",
            labelKey: "blockedOnCredit",
            value: stats?.blocked ?? 0,
            tone: "danger" as const,
          },
        ]
      : []),
    ...((stats?.needLr ?? 0) > 0
      ? [
          {
            href: "/admin/orders?filter=need_lr",
            labelKey: "lrPending",
            value: stats?.needLr ?? 0,
            tone: "warn" as const,
          },
        ]
      : []),
    ...((stats?.fullTruck ?? 0) > 0
      ? [
          {
            href: "/admin/orders?filter=full_truck",
            labelKey: "fullTruck",
            value: stats?.fullTruck ?? 0,
            tone: "warn" as const,
          },
        ]
      : []),
    ...((stats?.healthFails ?? 0) > 0
      ? [
          {
            href: "/admin/accounts/controls/health",
            labelKey: "healthFails",
            value: stats?.healthFails ?? 0,
            tone: "danger" as const,
          },
        ]
      : []),
    ...(!stats?.monthClosed && (stats?.posted ?? 0) > 0
      ? [
          {
            href: "/admin/owner/monthly-audit",
            labelKey: "monthCloseNeeded",
            value: 1,
            tone: "warn" as const,
          },
        ]
      : []),
  ];

  const doNow = DO_NOW.filter((a) => !a.ownerOnly || isOwner);
  const more = MORE.filter((a) => !a.ownerOnly || isOwner);
  const lockedThrough = db?.settings.lockedThroughDate;

  return (
    <AccountsShell>
      <AccountsPageHeader home title={t("homeTitle")} hint={t("homeHint")} />

      <div className="tt-panel mt-3 p-4 text-sm">
        <p className="font-semibold text-[var(--brand-deep)]">Which entry?</p>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[var(--ink-muted)]">
          <li>
            Selling a dealer order: <Link href="/admin/orders/new" className="font-semibold text-[var(--brand)]">/admin/orders/new</Link> (F8). The sale voucher is a secondary path.
          </li>
          <li>
            Stock in from a PO: <Link href="/admin/accounts/goods-received" className="font-semibold text-[var(--brand)]">GRN</Link> (F9), then bill.
          </li>
          <li>
            Money in / out: receipt (F6) and payment (F5). Journal (F7) is for transfers, not sales.
          </li>
        </ul>
      </div>

      {(stats?.posted ?? 0) === 0 ? (
        <div className="mt-3 rounded-lg border border-[var(--brand)] bg-[var(--brand-soft)] px-4 py-3">
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            {t("emptyBooksTitle")}
          </p>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {t("emptyBooksHint")}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/admin/orders/new" className="tt-btn tt-btn-dark">
              {t("emptyBooksSale")}
            </Link>
            <Link href="/admin/accounts/payments" className="tt-btn tt-btn-outline">
              {t("emptyBooksPay")}
            </Link>
            {isOwner ? (
              <Link
                href="/admin/accounts/openings"
                className="tt-btn tt-btn-outline"
              >
                {t("emptyBooksOpen")}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      {lockedThrough ? (
        <p className="mt-3 rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {t("periodLocked", { date: lockedThrough })}
          {" · "}
          <Link href="/admin/accounts/controls" className="underline">
            {t("navControls")}
          </Link>
        </p>
      ) : null}

      {attention.length ? (
        <>
          <h2 className="mt-6 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
            {t("needsAttention")}
          </h2>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {attention.map((a) => (
              <Link
                key={a.href}
                href={a.href}
                className={`tt-panel block p-4 transition hover:border-[var(--brand)] ${
                  a.tone === "danger" ? "tt-acct-attn" : "tt-acct-attn-warn"
                }`}
              >
                <p className="text-xs font-bold uppercase text-[var(--ink-muted)]">
                  {t(a.labelKey)}
                </p>
                <p className="mt-2 text-lg font-semibold tabular-nums text-[var(--brand-deep)]">
                  {a.value}
                </p>
              </Link>
            ))}
          </div>
        </>
      ) : null}

      <h2 className="mt-8 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {t("today")}
      </h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {money.map((c) => (
          <Link
            key={c.labelKey}
            href={c.href}
            className="tt-panel tt-acct-kpi"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              {t(c.labelKey)}
            </p>
            <p className="tt-acct-kpi-value">{formatInr(c.value)}</p>
          </Link>
        ))}
      </div>

      <h2 className="mt-8 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {t("doNow")}
      </h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {doNow.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="tt-panel flex min-h-[5.5rem] flex-col justify-center p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
          >
            <p className="text-lg font-semibold text-[var(--brand-deep)]">
              {t(a.labelKey)}
              {a.href === "/admin/accounts/needs-pricing" &&
              (stats?.needPricing ?? 0) > 0
                ? ` · ${stats?.needPricing}`
                : ""}
            </p>
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">{a.term}</p>
          </Link>
        ))}
      </div>

      <h2 className="mt-8 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {t("moreActions")}
      </h2>
      <div className="mt-2 flex flex-wrap gap-2">
        {more.map((a) => (
          <Link key={a.href} href={a.href} className="tt-btn tt-btn-outline">
            {t(a.labelKey)}
          </Link>
        ))}
      </div>

      <p className="mt-6 text-xs text-[var(--ink-muted)]">{t("autoBooksHint")}</p>
    </AccountsShell>
  );
}
