"use client";

import type { ReactNode } from "react";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";

/** Ops-desk header — same layout as books, no “Back to books”. */
export function AdminPageHeader({
  title,
  hint,
  extra,
  actions,
  backHref,
  backLabel,
}: {
  title: string;
  hint?: ReactNode;
  extra?: ReactNode;
  actions?: ReactNode;
  backHref?: string | null;
  backLabel?: string;
}) {
  return (
    <AccountsPageHeader
      home={backHref == null}
      title={title}
      hint={hint}
      extra={extra}
      actions={actions}
      backHref={backHref ?? undefined}
      backLabel={backLabel}
    />
  );
}
