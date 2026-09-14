"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AdminShell } from "@/components/AdminShell";
import { useDb, useSession } from "@/lib/hooks";
import {
  canEnterPhysicalCountNow,
  canViewFinancials,
  checkCapability,
  isSalesDeskStaff,
} from "@/lib/store/db";

type Card = {
  href: string;
  titleKey: string;
  hintKey: string;
  show: boolean;
};

export default function AuditHubPage() {
  const t = useTranslations("admin");
  const { session } = useSession();
  const { db } = useDb();
  const salesDesk = isSalesDeskStaff(session, db);
  const books = !!session && checkCapability(session, db, "manage_accounts");
  const owner = !!session && canViewFinancials(session.role);
  const canCount =
    !!session &&
    (canEnterPhysicalCountNow(session, db) || owner);

  if (!session || salesDesk || (!books && !owner && !canCount)) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  const cards: Card[] = [
    {
      href: "/admin/audit/stock-count",
      titleKey: "auditCountCard",
      hintKey: "auditCountHint",
      show: canCount,
    },
    {
      href: "/admin/owner/monthly-audit",
      titleKey: "auditMonthCard",
      hintKey: "auditMonthHint",
      show: owner,
    },
    {
      href: "/admin/accounts/controls/audit",
      titleKey: "auditTrailCard",
      hintKey: "auditTrailHint",
      show: books,
    },
    {
      href: "/admin/accounts/controls/health",
      titleKey: "auditHealthCard",
      hintKey: "auditHealthHint",
      show: books,
    },
    {
      href: "/admin/accounts/controls/flow-audit",
      titleKey: "auditFlowCard",
      hintKey: "auditFlowHint",
      show: books,
    },
  ];

  const visible = cards.filter((c) => c.show);

  return (
    <AdminShell wide>
      <AccountsPageHeader
        title={t("auditHub")}
        hint={t("auditHubHint")}
        backHref="/admin"
        backLabel={t("backToAdmin")}
      />
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        {visible.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="tt-panel flex min-h-[5rem] flex-col justify-center p-4 transition hover:border-[var(--brand)] hover:bg-[var(--brand-soft)]"
          >
            <p className="font-semibold text-[var(--brand-deep)]">
              {t(item.titleKey as "auditHub")}
            </p>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {t(item.hintKey as "auditHubHint")}
            </p>
          </Link>
        ))}
      </div>
    </AdminShell>
  );
}
