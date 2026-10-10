"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  pendingOwnerApprovals,
  pendingProductRatesApproval,
  pendingSchemeApproval,
  type SellingRateSnapshot,
} from "@/lib/owner-approvals";
import { formatInr } from "@/lib/pricing";
import type { OwnerApproval } from "@/lib/types";

export function OwnerPendingBanner({
  items,
  locale,
}: {
  items: OwnerApproval[];
  locale: "en" | "hi";
}) {
  const t = useTranslations();
  const pending = pendingOwnerApprovals(items);
  if (!pending.length) return null;
  return (
    <div className="tt-panel mt-4 border-[var(--brand)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            {t("admin.approvalMyPending")} ({pending.length})
          </p>
          <ul className="mt-1 space-y-0.5 text-sm text-[var(--ink-muted)]">
            {pending.slice(0, 6).map((row) => (
              <li key={row.id}>{row.title}</li>
            ))}
          </ul>
        </div>
        <Link href="/admin/owner/approvals" className="tt-btn tt-btn-outline text-sm">
          {t("admin.approvals")}
        </Link>
      </div>
    </div>
  );
}

export function ProposedRateHint({
  approval,
  locale,
}: {
  approval: OwnerApproval | undefined;
  locale: "en" | "hi";
}) {
  const t = useTranslations();
  if (!approval) return null;
  const proposed = approval.snapshot.proposed as SellingRateSnapshot | undefined;
  const sample = proposed?.variations?.[0]?.rate ?? proposed?.baseRate;
  if (sample == null) {
    return (
      <p className="mt-1 text-xs font-medium text-[var(--brand)]">
        {t("admin.approvalMyPending")}
      </p>
    );
  }
  return (
    <p className="mt-1 text-xs font-medium text-[var(--brand)]">
      {t("admin.approvalProposed")}: {formatInr(sample, locale)}
    </p>
  );
}

export { pendingProductRatesApproval, pendingSchemeApproval };
