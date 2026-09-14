"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { useDb, useSession } from "@/lib/hooks";
import { canViewFinancials, checkCapability } from "@/lib/store/db";

type ReportLink = {
  href: string;
  labelKey: string;
  hintKey: string;
  ownerOnly?: boolean;
};

const GROUPS: { titleKey: string; items: ReportLink[] }[] = [
  {
    titleKey: "reportGroupSales",
    items: [
      {
        href: "/admin/accounts/reports/sales-analysis",
        labelKey: "salesAnalysis",
        hintKey: "reportSalesHint",
      },
      {
        href: "/admin/accounts/item-sales",
        labelKey: "salesByItem",
        hintKey: "reportItemSalesHint",
      },
    ],
  },
  {
    titleKey: "reportGroupPurchase",
    items: [
      {
        href: "/admin/accounts/reports/purchase-analysis",
        labelKey: "purchaseAnalysis",
        hintKey: "reportPurchaseHint",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/reports/profit-analysis",
        labelKey: "profitAnalysis",
        hintKey: "reportProfitHint",
        ownerOnly: true,
      },
    ],
  },
  {
    titleKey: "reportGroupStock",
    items: [
      {
        href: "/admin/accounts/reports/stock-movements",
        labelKey: "stockMovements",
        hintKey: "reportMovementsHint",
      },
      {
        href: "/admin/accounts/reports/stock-alerts",
        labelKey: "stockAlerts",
        hintKey: "reportAlertsHint",
      },
      {
        href: "/admin/accounts/reports/stock-valuation",
        labelKey: "stockValuation",
        hintKey: "reportValuationHint",
        ownerOnly: true,
      },
    ],
  },
  {
    titleKey: "reportGroupMoney",
    items: [
      {
        href: "/admin/accounts/cash-bank",
        labelKey: "cashBankBook",
        hintKey: "reportCashBankHint",
      },
      {
        href: "/admin/accounts/reports/cash-flow",
        labelKey: "cashFlow",
        hintKey: "reportCashFlowHint",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/reports/pl",
        labelKey: "pl",
        hintKey: "reportPlHint",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/reports/balance-sheet",
        labelKey: "balanceSheet",
        hintKey: "reportBsHint",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/trial-balance",
        labelKey: "trialBalance",
        hintKey: "reportTbHint",
        ownerOnly: true,
      },
    ],
  },
];

export default function AccountsReportsHubPage() {
  const t = useTranslations("accounts");
  const { session } = useSession();
  const { db } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;

  if (!session || !checkCapability(session, db, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <AccountsPageHeader title={t("reportsHub")} hint={t("reportsHubHint")} />

      <div className="mt-6 space-y-8">
        {GROUPS.map((g) => {
          const items = g.items.filter((i) => !i.ownerOnly || isOwner);
          if (!items.length) return null;
          return (
            <section key={g.titleKey}>
              <h2 className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                {t(g.titleKey)}
              </h2>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="tt-panel flex min-h-[5rem] flex-col justify-center p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
                  >
                    <p className="font-semibold text-[var(--brand-deep)]">
                      {t(item.labelKey)}
                    </p>
                    <p className="mt-1 text-sm text-[var(--ink-muted)]">
                      {t(item.hintKey)}
                    </p>
                  </Link>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </AccountsShell>
  );
}
