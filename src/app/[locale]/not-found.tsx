"use client";

import { useLocale } from "next-intl";
import { Link } from "@/i18n/routing";

export default function LocaleNotFound() {
  const locale = useLocale() as "en" | "hi";
  const hi = locale === "hi";

  return (
    <section className="tt-section">
      <div className="tt-wrap flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
        <p className="tt-display text-5xl font-bold text-[var(--brand)]">404</p>
        <h1 className="tt-display text-2xl text-[var(--brand-deep)] sm:text-3xl">
          {hi ? "यह पेज नहीं मिला" : "Page not found"}
        </h1>
        <p className="max-w-md text-sm text-[var(--ink-muted)]">
          {hi
            ? "जो लिंक आपने खोला वह हटा दिया गया है या गलत है। नीचे से आगे बढ़ें।"
            : "The link you opened has moved or no longer exists. Continue from below."}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className="tt-btn tt-btn-dark">
            {hi ? "होम" : "Home"}
          </Link>
          <Link href="/catalog" className="tt-btn tt-btn-outline">
            {hi ? "कैटलॉग" : "Catalog"}
          </Link>
          <Link href="/orders" className="tt-btn tt-btn-outline">
            {hi ? "मेरे ऑर्डर" : "My orders"}
          </Link>
        </div>
      </div>
    </section>
  );
}
