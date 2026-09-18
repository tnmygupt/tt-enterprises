"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { runBooksHealthCheck } from "@/lib/accounting";
import { toDateInputValue } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import { canViewFinancials, checkCapability } from "@/lib/store/db";

type CheckItem = {
  id: string;
  label: string;
  detail: string;
  href?: string;
  auto?: boolean;
  ok?: boolean;
};

const FLOW_DONE_KEY = "tt_flow_audit_done_v1";

const MANUAL: Omit<CheckItem, "ok" | "auto">[] = [
  {
    id: "sale_stock",
    label: "Sale → stock out + COGS",
    detail: "Post a sale and confirm stock and COGS moved.",
    href: "/admin/accounts/vouchers?new=sale",
  },
  {
    id: "receipt_alloc",
    label: "Receipt allocated to bill",
    detail: "Money received against an open invoice drops outstanding.",
    href: "/admin/accounts/vouchers?new=receipt",
  },
  {
    id: "grn_price",
    label: "Goods received → Needs pricing → purchase",
    detail: "Staff GRN with packing slip; owner rates; bill posts.",
    href: "/admin/accounts/goods-received",
  },
  {
    id: "order_chain",
    label: "Order bill → sale voucher → payment → receipt",
    detail:
      "Dealer order with final bill auto-posts sale; each part-payment posts its own receipt.",
    href: "/admin/orders",
  },
  {
    id: "part_pay",
    label: "Part payments = separate receipts",
    detail: "Upload two proof amounts on one order; books show two receipts.",
    href: "/admin/orders",
  },
  {
    id: "match_stmt",
    label: "Match statement to zero",
    detail: "Tick lines / add extras until unexplained is ₹0.",
    href: "/admin/accounts/match-statement",
  },
  {
    id: "pay_verify",
    label: "Payments desk verify",
    detail: "UPI proof on Payments desk → receipt posts. Then tick the same credit in BRS.",
    href: "/admin/accounts/payments",
  },
  {
    id: "brs",
    label: "Bank BRS to zero (Alt+B)",
    detail: "Enter today's bank SMS closing, tick cleared lines, add charges until difference is ₹0.",
    href: "/admin/accounts/brs",
  },
  {
    id: "wa_desk",
    label: "WhatsApp desk + daily summary",
    detail: "Gateway on, send a test to yourself, then send owner daily summary.",
    href: "/admin/whatsapp",
  },
  {
    id: "expense",
    label: "Log expense with bill photo",
    detail: "Freight or other head from cash/bank.",
    href: "/admin/accounts/expenses",
  },
  {
    id: "period_lock",
    label: "Period lock blocks old dates",
    detail: "Lock a past date in Controls; posting that date must fail.",
    href: "/admin/accounts/controls",
  },
  {
    id: "backup",
    label: "Books backup downloads",
    detail: "Owner downloads JSON from Controls.",
    href: "/admin/accounts/controls",
  },
  {
    id: "owner_mask",
    label: "Owner-only masking",
    detail: "Staff cannot see purchase rates / P&L amounts.",
    href: "/admin/accounts/payables",
  },
];

export default function FlowAuditPage() {
  const t = useTranslations();
  const { session } = useSession();
  const { db } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;
  const today = toDateInputValue();
  const [done, setDone] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      const raw = localStorage.getItem(FLOW_DONE_KEY);
      // Hydrate saved ticks from storage — one-time sync from an external store
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setDone(JSON.parse(raw) as Record<string, boolean>);
    } catch {
      /* ignore */
    }
  }, []);

  const setDonePersisted = (id: string, checked: boolean) => {
    setDone((d) => {
      const next = { ...d, [id]: checked };
      try {
        localStorage.setItem(FLOW_DONE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const health = useMemo(() => {
    if (!db) return null;
    return runBooksHealthCheck({
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
  }, [db, today]);

  const autoItems: CheckItem[] = useMemo(() => {
    if (!health) return [];
    return health.items
      .filter((i) => isOwner || !i.ownerOnly)
      .map((i) => ({
        id: `auto_${i.id}`,
        label: i.label,
        detail: i.detail,
        href: "/admin/accounts/controls/health",
        auto: true,
        ok: i.ok,
      }));
  }, [health, isOwner]);

  const manualItems: CheckItem[] = useMemo(
    () =>
      MANUAL.map((m) => ({
        ...m,
        auto: false,
        ok: !!done[m.id],
      })),
    [done]
  );

  const all = useMemo(
    () => [...autoItems, ...manualItems],
    [autoItems, manualItems]
  );
  const passed = all.filter((i) => i.ok).length;

  const exportOptions = useMemo(
    () => ({
      title: "End-to-end flow audit",
      subtitle: today,
      filename: `flow-audit-${today}.pdf`,
      columns: ["Kind", "Check", "Status", "Detail"],
      rows: all.map((i) => [
        i.auto ? "Auto" : "Manual",
        i.label,
        i.ok ? "OK" : "Todo",
        i.detail,
      ]),
    }),
    [all, today]
  );

  if (!session || !checkCapability(session, db, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <AccountsPageHeader
        title={t("accounts.flowAudit")}
        hint={t("accounts.flowAuditHint")}
        actions={
          <>
            <ExportButtons options={exportOptions} />
            <Link href="/admin/help" className="tt-btn tt-btn-outline">
              {t("accounts.helpBooks")}
            </Link>
            <Link
              href="/admin/accounts/controls/health"
              className="tt-btn tt-btn-outline"
            >
              {t("accounts.healthCheck")}
            </Link>
          </>
        }
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="tt-panel p-4">
          <p className="text-xs text-[var(--ink-muted)]">Checks done</p>
          <p className="tt-display text-3xl text-[var(--brand-deep)]">
            {passed} / {all.length}
          </p>
        </div>
        <div className="tt-panel p-4">
          <p className="text-xs text-[var(--ink-muted)]">Auto health</p>
          <p
            className={`tt-display text-3xl ${
              autoItems.every((i) => i.ok)
                ? "text-[var(--ok)]"
                : "text-[var(--danger)]"
            }`}
          >
            {autoItems.length
              ? `${autoItems.filter((i) => i.ok).length} ok · ${
                  autoItems.filter((i) => !i.ok).length
                } fail`
              : "—"}
          </p>
        </div>
      </div>

      <div className="tt-panel mt-5 overflow-x-auto">
        <p className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
          Automated
        </p>
        <table className="tt-table min-w-[640px]">
          <thead>
            <tr>
              <th>Check</th>
              <th>Status</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {autoItems.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.href ? (
                    <Link
                      href={i.href}
                      className="font-medium text-[var(--brand-deep)] underline"
                    >
                      {i.label}
                    </Link>
                  ) : (
                    i.label
                  )}
                </td>
                <td
                  className={
                    i.ok ? "text-[var(--ok)]" : "text-[var(--danger)]"
                  }
                >
                  {i.ok ? "OK" : "FAIL"}
                </td>
                <td className="text-sm text-[var(--ink-muted)]">{i.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tt-panel mt-5 overflow-x-auto">
        <p className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
          Manual walkthrough — tick as you verify
        </p>
        <ul className="divide-y divide-[var(--line)]">
          {manualItems.map((i) => (
            <li
              key={i.id}
              className="flex flex-wrap items-start gap-3 px-4 py-3"
            >
              <input
                type="checkbox"
                className="mt-1"
                checked={!!done[i.id]}
                onChange={(e) => setDonePersisted(i.id, e.target.checked)}
                aria-label={i.label}
              />
              <div className="min-w-0 flex-1">
                <p className="font-medium text-[var(--ink)]">{i.label}</p>
                <p className="text-sm text-[var(--ink-muted)]">{i.detail}</p>
                {i.href ? (
                  <Link
                    href={i.href}
                    className="mt-1 inline-block text-sm text-[var(--brand-deep)] underline"
                  >
                    Open
                  </Link>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </AccountsShell>
  );
}
