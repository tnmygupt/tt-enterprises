"use client";

import { Suspense, useMemo } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { AccountsSearch } from "@/components/AccountsSearch";
import {
  searchAccountsEverywhere,
  type SearchHitKind,
} from "@/lib/accounts-search";
import { useDb, useSession } from "@/lib/hooks";
import { canViewFinancials, checkCapability } from "@/lib/store/db";

function SearchInner() {
  const t = useTranslations("accounts");
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

  if (!session || !checkCapability(session, db, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <AccountsPageHeader title={t("search")} hint={t("searchFindHint")} />

      <div className="mt-4 max-w-xl">
        <AccountsSearch initialQuery={q} />
      </div>

      {q.trim() ? (
        <div className="mt-6 space-y-6">
          {!hits.length ? (
            <AccountsEmpty
              message={`${t("emptySearch")} “${q}”.`}
              href="/admin/orders/new"
              cta={t("emptySearchCta")}
            />
          ) : (
            [...groups.entries()].map(([kind, rows]) => (
              <div key={kind} className="tt-panel overflow-hidden">
                <p className="border-b border-[var(--line)] px-4 py-2 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
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
                    )[kind]
                  )}{" "}
                  · {rows.length}
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
        <p className="mt-6 text-sm text-[var(--ink-muted)]">{t("searchHint")}</p>
      )}
    </AccountsShell>
  );
}

function SearchFallback() {
  const t = useTranslations("accounts");
  return (
    <AccountsShell>
      <p className="p-4 text-sm">{t("loadingBooks")}</p>
    </AccountsShell>
  );
}

export default function AccountsSearchPage() {
  return (
    <Suspense fallback={<SearchFallback />}>
      <SearchInner />
    </Suspense>
  );
}
