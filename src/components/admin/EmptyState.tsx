"use client";

import { AccountsEmpty } from "@/components/AccountsEmpty";

/** Canonical empty panel for admin and books lists. */
export function EmptyState({
  message,
  href,
  cta,
}: {
  message: string;
  href?: string;
  cta?: string;
}) {
  return <AccountsEmpty message={message} href={href} cta={cta} />;
}
