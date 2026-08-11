"use client";

import { useEffect, useState } from "react";
import { Link, usePathname } from "@/i18n/routing";
import { AdminShell } from "@/components/AdminShell";
import { AccountsHotkeys } from "@/components/AccountsHotkeys";
import { AccountsSearch } from "@/components/AccountsSearch";
import {useSession, useDb} from "@/lib/hooks";
import { checkCapability } from "@/lib/store/db";
import type { Capability } from "@/lib/types";

type NavItem = {
  href: string;
  /** Plain-language label shown to the user */
  label: string;
  /** Book-keeping term, shown small and grey so an accountant recognises it */
  term?: string;
  exact?: boolean;
  ownerOnly?: boolean;
  cap?: Capability;
};

type NavGroup = { title: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    title: "Every day",
    items: [
      { href: "/admin/accounts", label: "Home", exact: true },
      {
        href: "/admin/accounts/search",
        label: "Search",
        term: "Ctrl+K",
      },
      {
        href: "/admin/orders/new",
        label: "New sale",
        term: "F8",
        cap: "manage_orders",
      },
      {
        href: "/admin/accounts/goods-received",
        label: "Goods received",
        term: "F9",
      },
      {
        href: "/admin/accounts/needs-pricing",
        label: "Needs pricing",
        term: "Owner rates",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/purchases",
        label: "Purchase bills",
        term: "Alt+U",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/vouchers?new=receipt",
        label: "Money received",
        term: "F6",
      },
      {
        href: "/admin/accounts/vouchers?new=payment",
        label: "Money paid",
        term: "F5",
      },
      {
        href: "/admin/accounts/expenses",
        label: "Log expense",
        term: "Expense",
      },
      {
        href: "/admin/accounts/journal",
        label: "Journal",
        term: "F7",
      },
      {
        href: "/admin/accounts/vouchers?new=credit_note",
        label: "Sale return",
        term: "Credit note",
      },
    ],
  },
  {
    title: "Who owes what",
    items: [
      {
        href: "/admin/accounts/receivables",
        label: "Money to collect",
        term: "Alt+R",
      },
      {
        href: "/admin/accounts/payables",
        label: "Money to pay",
        term: "Alt+P",
      },
      {
        href: "/admin/accounts/party-statement",
        label: "Statement",
        term: "Party statement",
      },
      {
        href: "/admin/accounts/match-statement",
        label: "Match statement",
        term: "Cross-check",
      },
    ],
  },
  {
    title: "Records",
    items: [
      {
        href: "/admin/accounts/vouchers",
        label: "All entries",
        term: "Alt+V",
      },
      {
        href: "/admin/accounts/vouchers?new=sale",
        label: "Sale voucher",
        term: "Free-form bill",
      },
      { href: "/admin/accounts/daybook", label: "Day book", term: "Alt+F1" },
      { href: "/admin/accounts/ledger", label: "Ledger", term: "Alt+L" },
      { href: "/admin/accounts/inventory", label: "Stock", term: "Alt+F2" },
    ],
  },
  {
    title: "Set up",
    items: [
      {
        href: "/admin/accounts/parties",
        label: "Customers & suppliers",
        term: "Parties",
      },
      {
        href: "/admin/accounts/openings",
        label: "Opening balances",
        term: "From Tally",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/ledgers",
        label: "Account heads",
        term: "Chart of accounts",
      },
      {
        href: "/admin/accounts/contracts",
        label: "Supplier contracts",
        cap: "manage_contracts",
      },
    ],
  },
  {
    title: "Controls",
    items: [
      {
        href: "/admin/accounts/controls",
        label: "Controls",
        term: "FY · Lock · Backup",
        exact: true,
      },
      {
        href: "/admin/accounts/controls/audit",
        label: "Audit trail",
        term: "Who posted",
      },
      {
        href: "/admin/accounts/controls/health",
        label: "Health check",
        term: "Books integrity",
      },
      {
        href: "/admin/accounts/controls/flow-audit",
        label: "Flow audit",
        term: "E2E checklist",
      },
    ],
  },
  {
    title: "Reports",
    items: [
      {
        href: "/admin/accounts/cash-bank",
        label: "Cash & bank book",
        term: "Alt+C",
      },
      {
        href: "/admin/accounts/reports/sales-analysis",
        label: "Sales analysis",
      },
      {
        href: "/admin/accounts/reports/purchase-analysis",
        label: "Purchase analysis",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/reports/profit-analysis",
        label: "Profit analysis",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/reports/stock-movements",
        label: "Stock movements",
      },
      {
        href: "/admin/accounts/reports/stock-alerts",
        label: "Stock alerts",
        term: "Reorder / dead",
      },
      {
        href: "/admin/accounts/reports/stock-valuation",
        label: "Stock valuation",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/reports/cash-flow",
        label: "Cash flow",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/reports/pl",
        label: "Profit & Loss",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/reports/balance-sheet",
        label: "Balance sheet",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/trial-balance",
        label: "Trial balance",
        ownerOnly: true,
      },
      { href: "/admin/accounts/item-sales", label: "Sales by item" },
    ],
  },
];

const PIN_KEY = "tt_accounts_pins_v1";

function readPins(): string[] {
  try {
    const raw = window.localStorage.getItem(PIN_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((h): h is string => typeof h === "string");
  } catch {
    return [];
  }
}

function isActive(pathname: string, item: NavItem) {
  // Links carrying a query open a form rather than a place. The shell can't read
  // the query without useSearchParams (which would force a Suspense boundary on
  // every accounts page), so these never light up — the plain page link does.
  if (item.href.includes("?")) return false;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function AccountsShell({
  children,
  focusMode = false,
}: {
  children: React.ReactNode;
  /** Hide the accounts side nav so entry forms get full width */
  focusMode?: boolean;
}) {
  const pathname = usePathname();
  const { session } = useSession();
  const { db } = useDb();
  const owner = checkCapability(session, db?.users, "view_financials");
  const [navOpen, setNavOpen] = useState(false);
  const [pins, setPins] = useState<string[]>([]);

  useEffect(() => {
    // Close the accounts drawer on route change — derived UI state
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPins(readPins());
  }, []);

  const togglePin = (href: string) => {
    setPins((cur) => {
      const next = cur.includes(href)
        ? cur.filter((h) => h !== href)
        : [...cur, href];
      try {
        window.localStorage.setItem(PIN_KEY, JSON.stringify(next));
      } catch {
        // private mode — pins just don't persist
      }
      return next;
    });
  };

  const allowed = (item: NavItem) => {
    if (item.ownerOnly && !owner) return false;
    if (item.cap && session && !checkCapability(session, db?.users, item.cap)) {
      return false;
    }
    return true;
  };

  const pinnedItems = pins
    .map((href) => GROUPS.flatMap((g) => g.items).find((i) => i.href === href))
    .filter((i): i is NavItem => !!i && allowed(i));

  const renderItem = (item: NavItem, keyPrefix = "") => {
    const active = isActive(pathname, item);
    const pinned = pins.includes(item.href);
    return (
      <div key={`${keyPrefix}${item.href}`} className="flex items-center gap-1">
        <Link
          href={item.href}
          onClick={() => setNavOpen(false)}
          className={`flex min-h-11 min-w-0 flex-1 flex-col justify-center rounded-md px-2.5 py-1.5 text-sm ${
            active
              ? "tt-selected bg-[var(--brand)] font-semibold text-white"
              : "text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
          }`}
        >
          <span>{item.label}</span>
          {item.term ? (
            <span
              className={`text-[10px] ${
                active ? "text-white/70" : "opacity-70"
              }`}
            >
              {item.term}
            </span>
          ) : null}
        </Link>
        <button
          type="button"
          className={`shrink-0 rounded-md px-1.5 py-1 text-sm leading-none ${
            pinned
              ? "text-[var(--brand)]"
              : "text-[var(--ink-muted)] opacity-40 hover:opacity-100"
          }`}
          aria-pressed={pinned}
          aria-label={pinned ? `Unpin ${item.label}` : `Pin ${item.label}`}
          onClick={() => togglePin(item.href)}
        >
          {pinned ? "★" : "☆"}
        </button>
      </div>
    );
  };

  const navBody = (
    <>
      <div className="space-y-2 border-b border-[var(--line)] px-3 py-3">
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
          Accounts
        </p>
        <AccountsSearch compact />
      </div>
      <nav className="max-h-[70vh] space-y-3 overflow-y-auto p-2">
        {pinnedItems.length ? (
          <div>
            <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
              Pinned
            </p>
            <div className="flex flex-col gap-0.5">
              {pinnedItems.map((item) => renderItem(item, "pin-"))}
            </div>
          </div>
        ) : null}
        {GROUPS.map((g) => {
          const items = g.items.filter(allowed);
          if (!items.length) return null;
          return (
            <div key={g.title}>
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                {g.title}
              </p>
              <div className="flex flex-col gap-0.5">
                {items.map((item) => renderItem(item))}
              </div>
            </div>
          );
        })}
      </nav>
    </>
  );

  return (
    <AdminShell wide>
      <AccountsHotkeys />
      <div
        className={`grid gap-5 ${
          focusMode ? "grid-cols-1" : "lg:grid-cols-[216px_1fr]"
        }`}
      >
        {focusMode ? null : (
          <>
            {/* Phone: the long accounts list collapses so reports start at the top */}
            <div className="lg:hidden print:hidden">
              <button
                type="button"
                className="tt-btn tt-btn-outline w-full"
                aria-expanded={navOpen}
                onClick={() => setNavOpen((o) => !o)}
              >
                {navOpen ? "Close accounts menu" : "Accounts menu"}
              </button>
              {navOpen ? (
                <aside className="tt-panel mt-3 max-h-[min(70dvh,calc(100dvh-8rem))] overflow-y-auto p-0 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
                  {navBody}
                </aside>
              ) : null}
            </div>
            <aside className="tt-panel hidden h-fit overflow-hidden p-0 print:hidden lg:sticky lg:top-20 lg:block">
              {navBody}
            </aside>
          </>
        )}
        <div className="min-w-0">{children}</div>
      </div>
    </AdminShell>
  );
}
