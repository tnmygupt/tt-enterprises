"use client";

import { useEffect, useState } from "react";
import { useRouter } from "@/i18n/routing";
import {
  ACCOUNTS_HOTKEYS,
  isTypingTarget,
  matchAccountsHotkey,
} from "@/lib/accounts-hotkeys";
import { useSession } from "@/lib/hooks";
import { canViewFinancials } from "@/lib/store/db";

/** Global Tally-style shortcuts while inside AccountsShell. */
export function AccountsHotkeys() {
  const router = useRouter();
  const { session } = useSession();
  const owner = session ? canViewFinancials(session.role) : false;
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "?" && !isTypingTarget(e.target) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setHelpOpen((o) => !o);
        return;
      }
      if (e.key === "Escape" && helpOpen) {
        e.preventDefault();
        setHelpOpen(false);
        return;
      }
      if (isTypingTarget(e.target)) return;
      const hit = matchAccountsHotkey(e);
      if (!hit) return;
      if (hit.ownerOnly && !owner) return;
      e.preventDefault();
      setHelpOpen(false);
      router.push(hit.href);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [helpOpen, owner, router]);

  if (!helpOpen) return null;

  const rows = ACCOUNTS_HOTKEYS.filter((h) => !h.ownerOnly || owner);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4 print:hidden"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
      onClick={() => setHelpOpen(false)}
    >
      <div
        className="tt-panel max-h-[85vh] w-full max-w-md overflow-y-auto p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--ink)]">
              Keyboard shortcuts
            </h2>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Tally-style keys. Press ? to toggle · Esc to close
            </p>
          </div>
          <button
            type="button"
            className="text-sm text-[var(--ink-muted)]"
            onClick={() => setHelpOpen(false)}
          >
            Esc
          </button>
        </div>
        <ul className="mt-4 space-y-2">
          {rows.map((h) => (
            <li
              key={h.keys}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="text-[var(--ink)]">{h.label}</span>
              <kbd className="rounded border border-[var(--line)] bg-[var(--surface-2)] px-2 py-0.5 font-mono text-xs text-[var(--ink-muted)]">
                {h.keys}
              </kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
