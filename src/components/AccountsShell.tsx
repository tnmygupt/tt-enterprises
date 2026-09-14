"use client";

import { Suspense, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, usePathname } from "@/i18n/routing";
import { AdminShell } from "@/components/AdminShell";
import { AccountsHotkeys, openAccountsShortcuts } from "@/components/AccountsHotkeys";
import { AccountsSearch } from "@/components/AccountsSearch";
import { useSession, useDb } from "@/lib/hooks";
import { checkCapability } from "@/lib/store/db";
import type { Capability } from "@/lib/types";

type NavItem = {
  href: string;
  labelKey: string;
  /** Book-keeping term or shortcut, shown small and grey */
  term?: string;
  exact?: boolean;
  ownerOnly?: boolean;
  cap?: Capability;
};

type NavGroup = { titleKey: string; items: NavItem[] };

const EVERYDAY: NavItem[] = [
  { href: "/admin/accounts", labelKey: "home", exact: true },
  { href: "/admin/accounts/search", labelKey: "search", term: "Ctrl+K" },
  {
    href: "/admin/orders/new",
    labelKey: "newSale",
    term: "F8",
    cap: "manage_orders",
  },
  { href: "/admin/accounts/goods-received", labelKey: "goodsReceived", term: "F9" },
  {
    href: "/admin/accounts/vouchers?new=receipt",
    labelKey: "moneyReceived",
    term: "F6",
  },
  { href: "/admin/accounts/payments", labelKey: "paymentDesk" },
  { href: "/admin/accounts/expenses", labelKey: "logExpense", term: "Alt+E" },
];

const GROUPS: NavGroup[] = [
  { titleKey: "navEveryday", items: EVERYDAY },
  {
    titleKey: "navWhoOwes",
    items: [
      {
        href: "/admin/accounts/receivables",
        labelKey: "moneyToCollect",
        term: "Alt+R",
      },
      {
        href: "/admin/accounts/payables",
        labelKey: "moneyToPay",
        term: "Alt+P",
      },
      {
        href: "/admin/accounts/party-statement",
        labelKey: "statement",
        term: "Alt+S",
      },
      { href: "/admin/accounts/match-statement", labelKey: "matchStatement" },
    ],
  },
  {
    titleKey: "navRecords",
    items: [
      { href: "/admin/accounts/vouchers", labelKey: "allEntries", term: "Alt+V" },
      { href: "/admin/accounts/daybook", labelKey: "daybook", term: "Alt+F1" },
      { href: "/admin/accounts/ledger", labelKey: "ledger", term: "Alt+L" },
      { href: "/admin/accounts/inventory", labelKey: "stock", term: "Alt+F2" },
      {
        href: "/admin/accounts/cash-bank",
        labelKey: "cashBankBook",
        term: "Alt+C",
      },
      { href: "/admin/accounts/brs", labelKey: "brs", term: "Alt+B" },
      { href: "/admin/accounts/journal", labelKey: "journal", term: "F7" },
      {
        href: "/admin/accounts/needs-pricing",
        labelKey: "needsPricing",
        term: "Alt+N",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/purchases",
        labelKey: "purchaseBills",
        term: "Alt+U",
        ownerOnly: true,
      },
      {
        href: "/admin/accounts/vouchers?new=payment",
        labelKey: "moneyPaid",
        term: "F5",
        ownerOnly: true,
      },
    ],
  },
  {
    titleKey: "navReports",
    items: [{ href: "/admin/accounts/reports", labelKey: "reportsHub" }],
  },
  {
    titleKey: "navSetup",
    items: [
      { href: "/admin/accounts/parties", labelKey: "customersSuppliers" },
      {
        href: "/admin/accounts/openings",
        labelKey: "openingBalances",
        ownerOnly: true,
      },
      { href: "/admin/accounts/ledgers", labelKey: "accountHeads" },
      {
        href: "/admin/accounts/contracts",
        labelKey: "supplierContracts",
        cap: "manage_contracts",
      },
    ],
  },
  {
    titleKey: "navControls",
    items: [
      {
        href: "/admin/accounts/controls",
        labelKey: "navControls",
        term: "FY · Lock · Backup",
        exact: true,
      },
      { href: "/admin/accounts/controls/audit", labelKey: "auditTrail" },
      { href: "/admin/accounts/controls/health", labelKey: "healthCheck" },
      { href: "/admin/accounts/controls/flow-audit", labelKey: "flowAudit" },
    ],
  },
];

const PLANT_ITEMS: NavItem[] = [
  { href: "/admin/accounts/inventory", labelKey: "stock" },
  { href: "/admin/accounts/reports/stock-alerts", labelKey: "stockAlerts" },
  { href: "/admin/accounts/purchases?tab=orders", labelKey: "tabOrders" },
];
const PLANT_HREFS = new Set(PLANT_ITEMS.map((i) => i.href));

/** Extra routes so Recent can show a label after we collapse Reports. */
const EXTRA_LABELS: NavItem[] = [
  { href: "/admin/accounts/vouchers?new=sale", labelKey: "saleVoucher" },
  { href: "/admin/accounts/vouchers?new=credit_note", labelKey: "saleReturn" },
  { href: "/admin/accounts/reports/sales-analysis", labelKey: "salesAnalysis" },
  {
    href: "/admin/accounts/reports/purchase-analysis",
    labelKey: "purchaseAnalysis",
    ownerOnly: true,
  },
  {
    href: "/admin/accounts/reports/profit-analysis",
    labelKey: "profitAnalysis",
    ownerOnly: true,
  },
  { href: "/admin/accounts/reports/stock-movements", labelKey: "stockMovements" },
  { href: "/admin/accounts/reports/stock-alerts", labelKey: "stockAlerts" },
  {
    href: "/admin/accounts/reports/stock-valuation",
    labelKey: "stockValuation",
    ownerOnly: true,
  },
  {
    href: "/admin/accounts/reports/cash-flow",
    labelKey: "cashFlow",
    ownerOnly: true,
  },
  { href: "/admin/accounts/reports/pl", labelKey: "pl", ownerOnly: true },
  {
    href: "/admin/accounts/reports/balance-sheet",
    labelKey: "balanceSheet",
    ownerOnly: true,
  },
  {
    href: "/admin/accounts/trial-balance",
    labelKey: "trialBalance",
    ownerOnly: true,
  },
  { href: "/admin/accounts/item-sales", labelKey: "salesByItem" },
];

const ALL_ITEMS = [
  ...GROUPS.flatMap((g) => g.items),
  ...EXTRA_LABELS,
  ...PLANT_ITEMS,
];

const PIN_KEY = "tt_accounts_pins_v1";
const RECENT_KEY = "tt_accounts_recent_v1";
const RECENT_MAX = 6;

function readHrefs(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((h): h is string => typeof h === "string");
  } catch {
    return [];
  }
}

function writeHrefs(key: string, hrefs: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(hrefs));
  } catch {
    // private mode — list just doesn't persist
  }
}

function isActive(
  pathname: string,
  searchParams: { get(name: string): string | null },
  item: NavItem
) {
  const qIndex = item.href.indexOf("?");
  const path = qIndex === -1 ? item.href : item.href.slice(0, qIndex);
  const want = qIndex === -1 ? "" : item.href.slice(qIndex + 1);
  if (want) {
    if (pathname !== path) return false;
    const wantParams = new URLSearchParams(want);
    for (const [k, v] of wantParams) {
      if (searchParams.get(k) !== v) return false;
    }
    return true;
  }
  // Don't light "All entries" while a typed voucher form is open.
  if (path === "/admin/accounts/vouchers" && searchParams.get("new")) {
    return false;
  }
  if (item.exact) return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function canonicalHref(
  pathname: string,
  searchParams: { get(name: string): string | null }
) {
  const hits = ALL_ITEMS.filter((item) =>
    isActive(pathname, searchParams, item)
  ).sort((a, b) => b.href.length - a.href.length);
  return hits[0]?.href ?? pathname;
}

export function BackToBooksBar() {
  const t = useTranslations("accounts");
  return (
    <div className="mb-3 print:hidden">
      <Link
        href="/admin/accounts"
        className="text-sm font-semibold text-[var(--brand)] hover:underline"
      >
        ← {t("backToBooks")}
      </Link>
    </div>
  );
}

export function AccountsShell({
  children,
  focusMode = false,
}: {
  children: React.ReactNode;
  /** Hide the accounts side nav so entry forms get full width */
  focusMode?: boolean;
}) {
  return (
    <Suspense
      fallback={
        <AccountsShellFrame focusMode={focusMode} searchParams={null}>
          {children}
        </AccountsShellFrame>
      }
    >
      <AccountsShellWithQuery focusMode={focusMode}>{children}</AccountsShellWithQuery>
    </Suspense>
  );
}

function AccountsShellWithQuery({
  children,
  focusMode,
}: {
  children: React.ReactNode;
  focusMode: boolean;
}) {
  const searchParams = useSearchParams();
  return (
    <AccountsShellFrame focusMode={focusMode} searchParams={searchParams}>
      {children}
    </AccountsShellFrame>
  );
}

function AccountsShellFrame({
  children,
  focusMode = false,
  searchParams,
}: {
  children: React.ReactNode;
  focusMode?: boolean;
  searchParams: { get(name: string): string | null } | null;
}) {
  const t = useTranslations("accounts");
  const pathname = usePathname();
  const { session } = useSession();
  const { db } = useDb();
  const owner = checkCapability(session, db, "view_financials");
  const booksNav = checkCapability(session, db, "manage_accounts");
  const plantDesk =
    !!session &&
    checkCapability(session, db, "manage_reorder") &&
    !checkCapability(session, db, "manage_accounts");
  const [navOpen, setNavOpen] = useState(false);
  const [allBooks, setAllBooks] = useState(false);
  const [pins, setPins] = useState<string[]>([]);
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    // Close the accounts drawer on route change — derived UI state
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNavOpen(false);
    setAllBooks(false);
  }, [pathname]);

  useEffect(() => {
    if (!navOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [navOpen]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPins(readHrefs(PIN_KEY));
    setRecents(readHrefs(RECENT_KEY));
  }, []);

  useEffect(() => {
    const params = searchParams ?? new URLSearchParams();
    const href = canonicalHref(pathname, params);
    if (href === "/admin/accounts") return;
    setRecents((cur) => {
      const next = [href, ...cur.filter((h) => h !== href)].slice(0, RECENT_MAX);
      writeHrefs(RECENT_KEY, next);
      return next;
    });
  }, [pathname, searchParams]);

  const togglePin = (href: string) => {
    setPins((cur) => {
      const next = cur.includes(href)
        ? cur.filter((h) => h !== href)
        : [...cur, href];
      writeHrefs(PIN_KEY, next);
      return next;
    });
  };

  const allowed = (item: NavItem) => {
    if (plantDesk) return PLANT_HREFS.has(item.href);
    if (item.ownerOnly && !owner) return false;
    if (item.cap && session && !checkCapability(session, db, item.cap)) {
      return false;
    }
    return true;
  };

  const findItem = (href: string) =>
    ALL_ITEMS.find((i) => i.href === href);

  const pinnedItems = pins
    .map(findItem)
    .filter((i): i is NavItem => !!i && allowed(i));

  const recentItems = recents
    .map(findItem)
    .filter((i): i is NavItem => !!i && allowed(i) && !pins.includes(i.href))
    .slice(0, RECENT_MAX);

  const labelOf = (item: NavItem) => t(item.labelKey);

  const renderItem = (item: NavItem, keyPrefix = "") => {
    const active = isActive(
      pathname,
      searchParams ?? new URLSearchParams(),
      item
    );
    const pinned = pins.includes(item.href);
    const label = labelOf(item);
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
          <span>{label}</span>
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
          aria-label={
            pinned ? t("unpin", { label }) : t("pin", { label })
          }
          onClick={() => togglePin(item.href)}
        >
          {pinned ? "★" : "☆"}
        </button>
      </div>
    );
  };

  const renderGroup = (g: NavGroup) => {
    const items = g.items.filter(allowed);
    if (!items.length) return null;
    return (
      <div key={g.titleKey}>
        <p className="tt-acct-nav-title px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
          {t(g.titleKey)}
        </p>
        <div className="flex flex-col gap-0.5">
          {items.map((item) => renderItem(item))}
        </div>
      </div>
    );
  };

  const searchBlock = (
    <div className="space-y-2 border-b border-[var(--line)] px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/admin"
          className="text-xs font-semibold text-[var(--brand)] hover:underline"
        >
          ← {t("allAdmin")}
        </Link>
        <button
          type="button"
          className="inline-flex min-h-9 items-center rounded-md border border-[var(--line)] px-2 text-xs font-semibold text-[var(--ink-muted)] hover:bg-[var(--surface-2)]"
          onClick={openAccountsShortcuts}
        >
          ? {t("shortcutsBtn")}
        </button>
      </div>
      <AccountsSearch compact />
    </div>
  );

  const pinRecent = (
    <>
      {pinnedItems.length ? (
        <div>
          <p className="tt-acct-nav-title px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
            {t("pinned")}
          </p>
          <div className="flex flex-col gap-0.5">
            {pinnedItems.map((item) => renderItem(item, "pin-"))}
          </div>
        </div>
      ) : null}
      {recentItems.length ? (
        <div>
          <p className="tt-acct-nav-title px-2 pb-1 pt-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
            {t("recent")}
          </p>
          <div className="flex flex-col gap-0.5">
            {recentItems.map((item) => renderItem(item, "recent-"))}
          </div>
        </div>
      ) : null}
    </>
  );

  const navGroups = plantDesk
    ? [{ titleKey: "navPlant", items: PLANT_ITEMS }]
    : GROUPS;

  const desktopNav = (
    <>
      {plantDesk ? (
        <div className="border-b border-[var(--line)] px-3 py-3">
          <Link
            href="/admin"
            className="text-xs font-semibold text-[var(--brand)] hover:underline"
          >
            ← {t("allAdmin")}
          </Link>
        </div>
      ) : (
        searchBlock
      )}
      <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2">
        {plantDesk ? null : pinRecent}
        {navGroups.map(renderGroup)}
      </nav>
    </>
  );

  const restGroups = navGroups.filter((g) => g.titleKey !== "navEveryday");

  const mobileNav = plantDesk ? (
    <>
      <nav className="space-y-3 p-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {navGroups.map(renderGroup)}
      </nav>
    </>
  ) : (
    <>
      {searchBlock}
      <nav className="space-y-3 p-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {pinRecent}
        {renderGroup(GROUPS[0])}
        <button
          type="button"
          className="tt-btn tt-btn-outline w-full"
          aria-expanded={allBooks}
          onClick={() => setAllBooks((o) => !o)}
        >
          {allBooks ? t("closeMenu") : t("allBooks")}
        </button>
        {allBooks ? restGroups.map(renderGroup) : null}
      </nav>
    </>
  );

  if (!plantDesk && !booksNav) {
    return <AdminShell wide>{children}</AdminShell>;
  }

  return (
    <AdminShell wide hideNav>
      {plantDesk ? null : <AccountsHotkeys />}
      <div
        className={`grid gap-5 ${
          focusMode ? "grid-cols-1" : "lg:grid-cols-[240px_1fr]"
        }`}
      >
        {focusMode ? null : (
          <>
            <div className="lg:hidden print:hidden">
              <button
                type="button"
                className="tt-btn tt-btn-outline w-full"
                aria-expanded={navOpen}
                onClick={() => setNavOpen(true)}
              >
                {t("menu")}
              </button>
              {navOpen ? (
                <div className="tt-acct-sheet" role="dialog" aria-modal="true">
                  <button
                    type="button"
                    className="absolute inset-0 bg-black/40"
                    aria-label={t("closeMenu")}
                    onClick={() => setNavOpen(false)}
                  />
                  <aside className="tt-acct-sheet-panel">
                    <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--line)] bg-[var(--surface)] px-4 py-3">
                      <p className="text-sm font-semibold">{t("menu")}</p>
                      <button
                        type="button"
                        className="text-sm font-semibold text-[var(--brand)]"
                        onClick={() => setNavOpen(false)}
                      >
                        {t("closeMenu")}
                      </button>
                    </div>
                    {mobileNav}
                  </aside>
                </div>
              ) : null}
            </div>
            <aside className="tt-panel hidden max-h-[calc(100dvh-5.5rem)] flex-col overflow-hidden p-0 print:hidden lg:sticky lg:top-20 lg:flex">
              {desktopNav}
            </aside>
          </>
        )}
        <div className="min-w-0">
          {!db ? (
            <p className="mb-3 text-sm text-[var(--ink-muted)]">
              {t("loadingBooks")}
            </p>
          ) : null}
          {children}
        </div>
      </div>
    </AdminShell>
  );
}
