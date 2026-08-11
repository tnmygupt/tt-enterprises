"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { useDb, useSession } from "@/lib/hooks";
import { searchGlobal, type GlobalHit } from "@/lib/global-search";
import { isStaff } from "@/lib/store/db";

/**
 * One search bar for the whole app — catalog products and orders together.
 * Opens as an overlay so the header stays usable on a phone.
 */
export function GlobalSearch({ className }: { className?: string }) {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const router = useRouter();
  const { db } = useDb();
  const { session } = useSession();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const staff = !!session && isStaff(session.role);

  const hits = useMemo(
    () =>
      searchGlobal(db, q, {
        locale,
        staff,
        userId: session?.id,
      }),
    [db, q, locale, staff, session?.id]
  );

  const close = useCallback(() => {
    setOpen(false);
    setQ("");
    setActive(0);
  }, []);

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen(true);
        return;
      }
      if (e.key === "/" && !typing) {
        e.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const go = (hit: GlobalHit) => {
    close();
    router.push(hit.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active] ?? hits[0];
      if (hit) go(hit);
    }
  };

  return (
    <>
      <button
        type="button"
        className={`inline-flex min-h-11 items-center gap-2 rounded-lg border border-[var(--line)] px-3 text-sm font-medium text-[var(--ink-muted)] transition hover:border-[var(--brand)] hover:text-[var(--brand-deep)] ${className ?? ""}`}
        onClick={() => setOpen(true)}
        aria-label={t("search.open")}
      >
        <span aria-hidden className="text-lg leading-none">
          ⌕
        </span>
        <span className="hidden sm:inline">{t("search.open")}</span>
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-3 pt-[max(3rem,env(safe-area-inset-top))]"
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) close();
          }}
        >
          <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-xl">
            <div className="flex items-center gap-2 border-b border-[var(--line)] p-3">
              <input
                ref={inputRef}
                className="tt-input flex-1"
                placeholder={t("search.placeholder")}
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                aria-label={t("search.placeholder")}
              />
              <button
                type="button"
                className="min-h-11 min-w-11 rounded-lg text-[var(--ink-muted)]"
                onClick={close}
                aria-label={t("common.cancel")}
              >
                ✕
              </button>
            </div>

            <div className="max-h-[60dvh] overflow-y-auto">
              {q.trim().length < 2 ? (
                <p className="p-4 text-sm text-[var(--ink-muted)]">
                  {t("search.hint")}
                </p>
              ) : !hits.length ? (
                <p className="p-4 text-sm text-[var(--ink-muted)]">
                  {t("search.empty")}
                </p>
              ) : (
                <ul>
                  {hits.map((hit, i) => (
                    <li key={`${hit.kind}-${hit.id}`}>
                      <button
                        type="button"
                        className={`flex w-full flex-col items-start gap-0.5 px-4 py-3 text-left ${
                          i === active
                            ? "bg-[var(--brand-soft)]"
                            : "hover:bg-[var(--surface-2)]"
                        }`}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(hit)}
                      >
                        <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                          {hit.kind === "product"
                            ? t("search.products")
                            : t("search.orders")}
                        </span>
                        <span className="font-semibold text-[var(--ink)]">
                          {hit.title}
                        </span>
                        <span className="text-xs text-[var(--ink-muted)]">
                          {hit.subtitle}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
