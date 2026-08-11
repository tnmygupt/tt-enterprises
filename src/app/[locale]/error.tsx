"use client";

import { useEffect, useState } from "react";

/**
 * Route error UI — Reload / Back always work (hard navigation),
 * so the browser is never stuck on a dead client error page.
 */
export default function LocaleError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  const [hi, setHi] = useState(false);

  useEffect(() => {
    console.error(error);
    // Locale read from the URL after mount to avoid a hydration mismatch
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHi(window.location.pathname.startsWith("/hi"));
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-bold text-[var(--brand-deep,#0b3d2e)]">
        {hi ? "यह पेज लोड नहीं हो सका" : "This page couldn't load"}
      </h1>
      <p className="text-sm text-[var(--ink-muted,#5c6b66)]">
        {hi
          ? "कुछ गड़बड़ हुई। Reload या Back दबाएँ — दोनों हमेशा काम करते हैं।"
          : "Something went wrong. Use Reload or go Back — both work even when the page is broken."}
      </p>
      {error.digest ? (
        <p className="text-[11px] text-[var(--ink-muted,#5c6b66)]">
          Ref: {error.digest}
        </p>
      ) : null}
      <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          className="rounded-md bg-[var(--brand-deep,#0b3d2e)] px-4 py-2 text-sm font-semibold text-white"
          onClick={() => {
            try {
              unstable_retry();
            } catch {
              /* fall through to hard reload */
            }
            window.location.reload();
          }}
        >
          {hi ? "रीलोड" : "Reload"}
        </button>
        <button
          type="button"
          className="rounded-md border border-black/20 px-4 py-2 text-sm font-semibold"
          onClick={() => {
            if (window.history.length > 1) {
              window.history.back();
            } else {
              window.location.href = hi ? "/hi" : "/en";
            }
          }}
        >
          {hi ? "वापस" : "Back"}
        </button>
        {/* Hard navigation on purpose — client routing may be broken here. */}
        <a
          href={hi ? "/hi" : "/en"}
          className="rounded-md border border-black/20 px-4 py-2 text-sm font-semibold"
        >
          {hi ? "होम" : "Home"}
        </a>
      </div>
    </main>
  );
}
