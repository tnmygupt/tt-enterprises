"use client";

import { useMemo } from "react";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { ACCT, accountBalance, allOpenReceivables } from "@/lib/accounting";
import { getAdminQueues } from "@/lib/admin-queues";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import {
  canViewFinancials,
  checkCapability,
  listUnpricedGoodsReceipts,
} from "@/lib/store/db";

/** Big tap targets — this gets used on a phone in the godown. */
const ACTIONS: {
  href: string;
  label: string;
  term: string;
  ownerOnly?: boolean;
}[] = [
  {
    href: "/admin/orders/new",
    label: "New sale",
    term: "F8 · Order → packing slip",
  },
  {
    href: "/admin/accounts/vouchers?new=sale",
    label: "Sale voucher",
    term: "Free-form bill",
  },
  {
    href: "/admin/accounts/goods-received",
    label: "Goods received",
    term: "F9 · Stock in",
  },
  {
    href: "/admin/accounts/needs-pricing",
    label: "Needs pricing",
    term: "Owner rates",
    ownerOnly: true,
  },
  {
    href: "/admin/accounts/vouchers?new=receipt",
    label: "Money received",
    term: "F6 · Receipt",
  },
  {
    href: "/admin/accounts/vouchers?new=payment",
    label: "Money paid",
    term: "F5 · Payment",
  },
  {
    href: "/admin/accounts/expenses",
    label: "Log expense",
    term: "Expense",
  },
  {
    href: "/admin/accounts/journal",
    label: "Journal",
    term: "F7 · Journal voucher",
  },
  {
    href: "/admin/accounts/party-statement",
    label: "Statement",
    term: "Party statement",
  },
  {
    href: "/admin/accounts/match-statement",
    label: "Match statement",
    term: "Cross-check",
  },
  {
    href: "/admin/accounts/inventory",
    label: "Stock",
    term: "Alt+F2 · Inventory",
  },
  {
    href: "/admin/accounts/cash-bank",
    label: "Cash & bank",
    term: "Alt+C · Cash book",
  },
  {
    href: "/admin/accounts/daybook",
    label: "Day book",
    term: "Alt+F1",
  },
  {
    href: "/admin/accounts/vouchers",
    label: "All entries",
    term: "Alt+V · Vouchers",
  },
  {
    href: "/admin/accounts/openings",
    label: "Opening balances",
    term: "From Tally",
    ownerOnly: true,
  },
  {
    href: "/admin/accounts/search",
    label: "Search",
    term: "Ctrl+K",
  },
  {
    href: "/admin/help",
    label: "Help · Books",
    term: "How-to guide",
  },
  {
    href: "/admin/accounts/controls/flow-audit",
    label: "Flow audit",
    term: "E2E checklist",
  },
];

export default function AccountsHomePage() {
  const { session } = useSession();
  const { db } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;
  const today = new Date().toISOString().slice(0, 10);

  const stats = useMemo(() => {
    if (!db) return null;
    const cash = db.accounts.find((a) => a.id === ACCT.cash);
    const bank = db.accounts.find((a) => a.id === ACCT.bank);
    const salesToday = db.vouchers
      .filter((v) => v.type === "sale" && !v.voided && v.date === today)
      .reduce((s, v) => s + v.total, 0);
    const purchaseToday = db.vouchers
      .filter((v) => v.type === "purchase" && !v.voided && v.date === today)
      .reduce((s, v) => s + v.total, 0);
    const toCollect = allOpenReceivables(
      db.parties,
      db.vouchers,
      db.billAllocations ?? [],
      today
    ).reduce((s, r) => s + r.outstanding, 0);
    const needBill = getAdminQueues(db).needBill.length;
    const needVoucher = db.orders.filter(
      (o) =>
        o.status !== "cancelled" &&
        o.actualBillAmount != null &&
        !db.vouchers.some(
          (v) => v.linkedOrderId === o.id && v.type === "sale" && !v.voided
        )
    ).length;
    const needPricing = listUnpricedGoodsReceipts(db).length;
    return {
      cash: cash ? accountBalance(cash, db.ledgerEntries, today) : 0,
      bank: bank ? accountBalance(bank, db.ledgerEntries, today) : 0,
      salesToday,
      purchaseToday,
      toCollect,
      needBill,
      needVoucher,
      needPricing,
    };
  }, [db, today]);

  if (!session || !checkCapability(session, db?.users, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const money: { label: string; value: number; href: string }[] = [
    {
      label: "Cash in hand",
      value: stats?.cash ?? 0,
      href: "/admin/accounts/cash-bank",
    },
    {
      label: "Bank balance",
      value: stats?.bank ?? 0,
      href: "/admin/accounts/cash-bank",
    },
    {
      label: "Sales today",
      value: stats?.salesToday ?? 0,
      href: "/admin/accounts/daybook",
    },
    ...(isOwner
      ? [
          {
            label: "Purchases today",
            value: stats?.purchaseToday ?? 0,
            href: "/admin/accounts/purchases",
          },
        ]
      : []),
    {
      label: "Money to collect",
      value: stats?.toCollect ?? 0,
      href: "/admin/accounts/receivables",
    },
  ];

  const attention = [
    ...(isOwner && (stats?.needPricing ?? 0) > 0
      ? [
          {
            href: "/admin/accounts/needs-pricing",
            label: "Goods waiting for your rate",
            value: String(stats?.needPricing ?? 0),
          },
        ]
      : []),
    {
      href: "/admin/accounts/receivables",
      label: "Bills not yet paid",
      value: formatInr(stats?.toCollect ?? 0),
    },
    {
      href: "/admin/orders?filter=need_bill",
      label: "Orders waiting for a bill",
      value: String(stats?.needBill ?? 0),
    },
    {
      href: "/admin/orders?filter=need_voucher",
      label: "Bills not posted to books",
      value: String(stats?.needVoucher ?? 0),
    },
  ];

  const actions = ACTIONS.filter((a) => !a.ownerOnly || isOwner);

  const lockedThrough = db?.settings.lockedThroughDate;

  return (
    <AccountsShell>
      <div>
        <h1 className="text-2xl font-semibold text-[var(--ink)]">Accounts</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          New sale opens an order; packing slip and bill follow like dealer
          orders. Use Sale voucher only for free-form bills. Press{" "}
          <kbd className="rounded border border-[var(--line)] px-1 font-mono text-xs">
            ?
          </kbd>{" "}
          for Tally-style shortcuts.
        </p>
      </div>

      {lockedThrough ? (
        <p className="mt-3 rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          Period locked through <strong>{lockedThrough}</strong>
          {" · "}
          <Link href="/admin/accounts/controls" className="underline">
            Controls
          </Link>
        </p>
      ) : null}

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {actions.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="tt-panel flex min-h-[5.5rem] flex-col justify-center p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
          >
            <p className="text-lg font-semibold text-[var(--brand-deep)]">
              {a.label}
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
        Today
      </h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {money.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="tt-panel block p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
          >
            <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
              {c.label}
            </p>
            <p className="mt-2 text-xl font-semibold tabular-nums text-[var(--brand-deep)]">
              {formatInr(c.value)}
            </p>
          </Link>
        ))}
      </div>

      <h2 className="mt-8 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        Needs attention
      </h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {attention.map((a) => (
          <Link
            key={a.href}
            href={a.href}
            className="tt-panel block p-4 transition hover:border-[var(--brand)]"
          >
            <p className="text-xs font-bold uppercase text-[var(--ink-muted)]">
              {a.label}
            </p>
            <p className="mt-2 text-lg font-semibold tabular-nums">{a.value}</p>
          </Link>
        ))}
      </div>

      <p className="mt-6 text-xs text-[var(--ink-muted)]">
        Website orders post themselves: saving a final bill creates the sales
        entry, and verifying payment creates the receipt.
      </p>
    </AccountsShell>
  );
}
