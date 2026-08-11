"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

/** Consistent deny UI inside AdminShell */
export function AdminAccessDenied({
  title,
}: {
  title?: string;
}) {
  const t = useTranslations();
  return (
    <div className="tt-panel max-w-lg p-6">
      <p className="font-semibold text-[var(--danger)]">
        {title ?? t("common.noAccess")}
      </p>
      <p className="mt-2 text-sm text-[var(--ink-muted)]">
        {t("common.noAccessHint")}
      </p>
      <Link href="/admin" className="tt-btn tt-btn-outline mt-4 inline-flex">
        {t("admin.dashboard")}
      </Link>
    </div>
  );
}
