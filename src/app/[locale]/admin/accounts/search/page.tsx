"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import { AccountsSearch } from "@/components/AccountsSearch";
import {
  SEARCH_KIND_LABEL,
  searchAccountsEverywhere,
  type SearchHitKind,
} from "@/lib/accounts-search";
import { useDb, useSession } from "@/lib/hooks";
import { canViewFinancials, checkCapability } from "@/lib/store/db";

function SearchInner() {
  const search = useSearchParams();
  const q = search.get("q") || "";
  const { session } = useSession();
  const { db } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;

  const hits = useMemo(() => {
    if (!db || !q.trim()) return [];
    return searchAccountsEverywhere(db, q, {
      includePurchases: isOwner,
      limit: 80,
    });
  }, [db, q, isOwner]);

  const groups = useMemo(() => {
    const map = new Map<SearchHitKind, typeof hits>();
    for (const h of hits) {
      const list = map.get(h.kind) || [];
      list.push(h);
      map.set(h.kind, list);
    }
    return map;
  }, [hits]);

  if (!session || !checkCapability(session, db?.users, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)]">
        Search
      </h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        Find any party, bill, product, account, order or goods receipt.
      </p>

      <div className="mt-4 max-w-xl">
        <AccountsSearch initialQuery={q} />
      </div>

      {q.trim() ? (
        <div className="mt-6 space-y-6">
          {!hits.length ? (
            <p className="text-sm text-[var(--ink-muted)]">
              No matches for “{q}”.
            </p>
          ) : (
            [...groups.entries()].map(([kind, rows]) => (
              <div key={kind} className="tt-panel overflow-hidden">
                <p className="border-b border-[var(--line)] px-4 py-2 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                  {SEARCH_KIND_LABEL[kind]} · {rows.length}
                </p>
                <ul className="divide-y divide-[var(--line)]">
                  {rows.map((h) => (
                    <li key={`${h.kind}-${h.id}`}>
                      <Link
                        href={h.href}
                        className="block px-4 py-3 hover:bg-[var(--brand-soft)]"
                      >
                        <p className="font-medium text-[var(--brand-deep)]">
                          {h.title}
                        </p>
                        <p className="text-xs text-[var(--ink-muted)]">
                          {h.subtitle}
                        </p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      ) : (
        <p className="mt-6 text-sm text-[var(--ink-muted)]">
          Tip: press Ctrl+K from any Accounts page.
        </p>
      )}
    </AccountsShell>
  );
}

export default function AccountsSearchPage() {
  return (
    <Suspense
      fallback={
        <AccountsShell>
          <p className="p-4 text-sm">Loading…</p>
        </AccountsShell>
      }
    >
      <SearchInner />
    </Suspense>
  );
}
