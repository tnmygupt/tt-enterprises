"use client";

import type { ReactNode } from "react";
import { Link } from "@/i18n/routing";
import { BackToBooksBar } from "@/components/AccountsShell";

export function AccountsPageHeader({
  title,
  hint,
  extra,
  actions,
  home = false,
  backHref,
  backLabel,
}: {
  title: string;
  hint?: ReactNode;
  extra?: ReactNode;
  actions?: ReactNode;
  home?: boolean;
  /** Override the default “Back to books” link. `null` hides the back row. */
  backHref?: string | null;
  backLabel?: string;
}) {
  return (
    <div className="tt-acct-header-wrap">
      {home || backHref === null ? null : backHref ? (
        <div className="mb-3 print:hidden">
          <Link
            href={backHref}
            className="text-sm font-semibold text-[var(--brand)] hover:underline"
          >
            ← {backLabel || "Back"}
          </Link>
        </div>
      ) : (
        <BackToBooksBar />
      )}
      <div className="tt-acct-header">
        <div className="min-w-0">
          <h1 className="tt-display text-2xl sm:text-3xl print:text-2xl">
            {title}
          </h1>
          {hint ? (
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)] print:hidden">
              {hint}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex flex-wrap gap-2 print:hidden">{actions}</div>
        ) : null}
      </div>
      {extra ? <div className="mt-4 print:hidden">{extra}</div> : null}
    </div>
  );
}
