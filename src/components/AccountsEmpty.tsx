"use client";

import { Link } from "@/i18n/routing";

export function AccountsEmpty({
  message,
  href,
  cta,
}: {
  message: string;
  href?: string;
  cta?: string;
}) {
  return (
    <div className="tt-panel mt-4 px-4 py-6 text-center sm:text-left">
      <p className="text-sm text-[var(--ink-muted)]">{message}</p>
      {href && cta ? (
        <Link href={href} className="tt-btn tt-btn-dark mt-3 inline-flex">
          {cta}
        </Link>
      ) : null}
    </div>
  );
}
