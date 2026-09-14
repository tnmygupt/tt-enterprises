"use client";

import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import {
  searchAccountsEverywhere,
} from "@/lib/accounts-search";
import { useDb, useSession } from "@/lib/hooks";
import { canViewFinancials } from "@/lib/store/db";

type Props = {
  /** Compact input for the Accounts sidebar */
  compact?: boolean;
  className?: string;
  initialQuery?: string;
};

export function AccountsSearch({
  compact,
  className,
  initialQuery = "",
}: Props) {
  const router = useRouter();
  const t = useTranslations("accounts");
  const { db } = useDb();
  const { session } = useSession();
  const isOwner = session ? canViewFinancials(session.role) : false;
  const [q, setQ] = useState(initialQuery);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Scanning the whole book on every keystroke stutters on big datasets
  const deferredQ = useDeferredValue(q);

  const hits = useMemo(() => {
    if (!db || deferredQ.trim().length < 1) return [];
    return searchAccountsEverywhere(db, deferredQ, {
      includePurchases: isOwner,
      limit: compact ? 12 : 50,
    });
  }, [db, deferredQ, isOwner, compact]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit) go(hit.href);
      else if (q.trim()) go(`/admin/accounts/search?q=${encodeURIComponent(q.trim())}`);
    }
  };

  return (
    <div ref={wrapRef} className={`relative ${className ?? ""}`}>
      <input
        ref={inputRef}
        className={`tt-input w-full ${compact ? "text-sm" : ""}`}
        placeholder={
          compact ? t("searchPlaceholderCompact") : t("searchPlaceholder")
        }
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label={t("searchAria")}
      />
      {open && q.trim() && (
        <div
          className={`absolute z-40 mt-1 max-h-80 w-full overflow-y-auto rounded-lg border border-[var(--line)] bg-white shadow-lg ${
            compact ? "min-w-0 sm:min-w-[240px]" : ""
          }`}
        >
          {!hits.length ? (
            <p className="p-3 text-sm text-[var(--ink-muted)]">
              {t("searchNoMatches")}
            </p>
          ) : (
            <ul>
              {hits.map((h, i) => (
                <li key={`${h.kind}-${h.id}`}>
                  <button
                    type="button"
                    className={`flex min-h-11 w-full flex-col items-start justify-center px-3 py-2.5 text-left text-sm ${
                      i === active
                        ? "bg-[var(--brand-soft)]"
                        : "hover:bg-[var(--surface-2)]"
                    }`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => go(h.href)}
                  >
                    <span className="w-full truncate font-medium text-[var(--ink)]">
                      <span className="mr-2 text-[10px] font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                        {t(
                          (
                            {
                              party: "kindParty",
                              voucher: "kindVoucher",
                              product: "kindProduct",
                              account: "kindAccount",
                              order: "kindOrder",
                              grn: "kindGrn",
                            } as const
                          )[h.kind]
                        )}
                      </span>
                      {h.title}
                    </span>
                    <span className="w-full truncate text-xs text-[var(--ink-muted)]">
                      {h.subtitle}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            className="flex min-h-11 w-full items-center border-t border-[var(--line)] px-3 py-2 text-left text-xs font-semibold text-[var(--brand-deep)]"
            onClick={() =>
              go(`/admin/accounts/search?q=${encodeURIComponent(q.trim())}`)
            }
          >
            {t("searchOpenFull")} →
          </button>
        </div>
      )}
    </div>
  );
}
