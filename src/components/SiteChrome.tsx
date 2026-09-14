"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { useCart, useDb, useSession } from "@/lib/hooks";
import { GlobalSearch } from "@/components/GlobalSearch";
import { checkCapability, isStaff, logout } from "@/lib/store/db";

function BrandLockup({ light = false }: { light?: boolean }) {
  const t = useTranslations();
  const { db } = useDb();
  const companyName = db?.settings?.companyName || "TT Enterprises";
  return (
    <span className={`tt-brand ${light ? "tt-brand-light" : ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={light ? "/brand/tt-mark-light.svg" : "/brand/tt-mark.png"}
        alt=""
        className="tt-brand-mark"
      />
      <span className="tt-brand-word" aria-label={companyName}>
        <strong>{companyName}</strong>
        <span>{t("shop.wholesale")}</span>
      </span>
    </span>
  );
}

export function SiteHeader() {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const { session, ready } = useSession();
  const { cart } = useCart();
  const { db } = useDb();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    // Close mobile menu on route change — intentional sync of derived UI state
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  const switchLocale = (next: "en" | "hi") => {
    router.replace(pathname, { locale: next });
  };

  const linkClass = (href: string) =>
    `inline-flex min-h-11 w-full items-center rounded-lg px-3 py-2.5 text-base font-medium transition lg:w-auto lg:text-sm ${
      pathname === href || pathname.startsWith(`${href}/`)
        ? "tt-selected bg-[var(--brand)] text-white"
        : "text-[var(--ink-muted)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-deep)]"
    }`;

  const langToggle = (
    <div className="flex overflow-hidden rounded-lg border border-[var(--line)] text-xs font-bold">
      <button
        type="button"
        className={`min-h-11 min-w-11 px-3 ${locale === "en" ? "tt-selected bg-[var(--brand)] text-white" : "bg-white text-[var(--ink-muted)]"}`}
        onClick={() => switchLocale("en")}
      >
        EN
      </button>
      <button
        type="button"
        className={`min-h-11 min-w-11 px-3 ${locale === "hi" ? "tt-selected bg-[var(--brand)] text-white" : "bg-white text-[var(--ink-muted)]"}`}
        onClick={() => switchLocale("hi")}
      >
        हिं
      </button>
    </div>
  );

  const canStock =
    !!session && checkCapability(session, db, "manage_accounts");
  const canAccounts =
    !!session && checkCapability(session, db, "manage_accounts");
  const staff = !!session && isStaff(session.role);

  const storeLinks = session ? (
    <>
      <Link
        href="/price-list"
        className={linkClass("/price-list")}
        onClick={() => setMenuOpen(false)}
      >
        {t("nav.priceList")}
      </Link>
      <Link
        href="/catalog"
        className={linkClass("/catalog")}
        onClick={() => setMenuOpen(false)}
      >
        {t("nav.catalog")}
      </Link>
      <Link
        href="/quick-order"
        className={linkClass("/quick-order")}
        onClick={() => setMenuOpen(false)}
      >
        {t("nav.quickOrder")}
        {cart.length > 0 ? (
          <span className="ml-1.5 rounded-md bg-[var(--accent)] px-2 py-0.5 text-xs font-bold text-white">
            {cart.length}
          </span>
        ) : null}
      </Link>
      <Link
        href="/orders"
        className={linkClass("/orders")}
        onClick={() => setMenuOpen(false)}
      >
        {t("nav.orders")}
      </Link>
      <Link
        href="/schemes"
        className={linkClass("/schemes")}
        onClick={() => setMenuOpen(false)}
      >
        {t("nav.schemes")}
      </Link>
      <Link
        href="/wallet"
        className={linkClass("/wallet")}
        onClick={() => setMenuOpen(false)}
      >
        {t("nav.wallet")}
      </Link>
      <Link
        href="/profile"
        className={linkClass("/profile")}
        onClick={() => setMenuOpen(false)}
      >
        {t("nav.profile")}
      </Link>
      {!staff ? (
        <Link
          href="/help"
          className={linkClass("/help")}
          onClick={() => setMenuOpen(false)}
        >
          {t("nav.help")}
        </Link>
      ) : null}
      {staff ? (
        <Link
          href="/admin"
          className={linkClass("/admin")}
          onClick={() => setMenuOpen(false)}
        >
          {t("nav.admin")}
        </Link>
      ) : null}
      {canAccounts ? (
        <Link
          href="/admin/accounts"
          className={linkClass("/admin/accounts")}
          onClick={() => setMenuOpen(false)}
        >
          {t("admin.accountsBook")}
        </Link>
      ) : null}
      {canStock ? (
        <Link
          href="/admin/accounts/inventory"
          className={linkClass("/admin/accounts/inventory")}
          onClick={() => setMenuOpen(false)}
        >
          {t("admin.stock")}
        </Link>
      ) : null}
      <button
        type="button"
        className="inline-flex min-h-11 w-full items-center rounded-lg px-3 py-2.5 text-base text-[var(--ink-muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] lg:w-auto lg:text-sm"
        onClick={() => {
          logout();
          setMenuOpen(false);
          router.push("/");
        }}
      >
        {t("nav.logout")}
      </button>
    </>
  ) : (
    <>
      <Link
        href="/catalog"
        className={linkClass("/catalog")}
        onClick={() => setMenuOpen(false)}
      >
        {t("nav.catalog")}
      </Link>
      <Link
        href="/help"
        className={linkClass("/help")}
        onClick={() => setMenuOpen(false)}
      >
        {t("nav.help")}
      </Link>
      <Link
        href="/"
        className={linkClass("/")}
        onClick={() => setMenuOpen(false)}
      >
        {t("nav.login")} / {t("nav.register")}
      </Link>
    </>
  );

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--line)] bg-white/95 pt-[env(safe-area-inset-top)] backdrop-blur-md print:hidden">
      <div className="tt-wrap flex items-center justify-between gap-3 py-2">
        <Link
          href="/"
          className="min-h-11 min-w-0 shrink"
          onClick={() => setMenuOpen(false)}
        >
          <BrandLockup />
        </Link>

        {!ready ? null : (
          <>
            {session ? <GlobalSearch className="shrink-0" /> : null}

            <nav className="hidden flex-wrap items-center gap-0.5 lg:flex">
              {storeLinks}
              {langToggle}
            </nav>

            <div className="flex shrink-0 items-center gap-2 lg:hidden">
              {langToggle}
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--line)] text-base font-semibold text-[var(--ink)]"
                aria-expanded={menuOpen}
                aria-controls="tt-mobile-nav"
                aria-label={menuOpen ? "Close menu" : "Open menu"}
                onClick={() => setMenuOpen((o) => !o)}
              >
                {menuOpen ? "✕" : "☰"}
              </button>
            </div>
          </>
        )}
      </div>

      {ready && menuOpen ? (
        <nav
          id="tt-mobile-nav"
          className="tt-wrap flex max-h-[calc(100dvh-5.5rem-env(safe-area-inset-top))] flex-col gap-1 overflow-y-auto border-t border-[var(--line)] py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:hidden"
        >
          {storeLinks}
        </nav>
      ) : null}
    </header>
  );
}

export function SiteFooter() {
  const t = useTranslations();
  const locale = useLocale();
  const { db } = useDb();
  const { session, ready } = useSession();
  const settings = db?.settings;
  const phone = settings?.phone?.trim() || "";
  const phone2 = settings?.phone2?.trim() || "";
  const address = settings?.address?.trim() || "";
  const gstin = settings?.gstin?.trim() || "";
  const loggedIn = ready && !!session;

  return (
    <footer className="mt-auto border-t border-[var(--line)] bg-white pb-[env(safe-area-inset-bottom)] print:hidden">
      <div className="tt-wrap grid gap-5 py-7 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-2">
          <BrandLockup />
          {address ? (
            <p className="max-w-xs text-[var(--ink-muted)]">{address}</p>
          ) : null}
          {gstin ? (
            <p className="text-xs text-[var(--ink-muted)]">GSTIN: {gstin}</p>
          ) : null}
        </div>

        {phone || phone2 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">
              {locale === "hi" ? "संपर्क" : "Contact"}
            </p>
            {[phone, phone2].filter(Boolean).map((p) => (
              <a
                key={p}
                href={`tel:${p}`}
                className="block font-semibold text-[var(--brand-deep)] hover:underline"
              >
                {p}
              </a>
            ))}
          </div>
        ) : null}

        <div className="space-y-1.5">
          <p className="text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">
            {locale === "hi" ? "लिंक" : "Links"}
          </p>
          <Link
            href="/catalog"
            className="block text-[var(--ink-muted)] hover:text-[var(--brand-deep)]"
          >
            {t("nav.catalog")}
          </Link>
          <Link
            href="/price-list"
            className="block text-[var(--ink-muted)] hover:text-[var(--brand-deep)]"
          >
            {t("nav.priceList")}
          </Link>
          {loggedIn ? (
            <>
              <Link
                href="/orders"
                className="block text-[var(--ink-muted)] hover:text-[var(--brand-deep)]"
              >
                {t("nav.orders")}
              </Link>
              <Link
                href="/profile"
                className="block text-[var(--ink-muted)] hover:text-[var(--brand-deep)]"
              >
                {t("nav.profile")}
              </Link>
            </>
          ) : (
            <Link
              href="/"
              className="block text-[var(--ink-muted)] hover:text-[var(--brand-deep)]"
            >
              {t("nav.login")}
            </Link>
          )}
          <Link
            href="/help"
            className="block text-[var(--ink-muted)] hover:text-[var(--brand-deep)]"
          >
            {t("nav.help")}
          </Link>
        </div>
      </div>
      <div className="border-t border-[var(--line)]">
        <p className="tt-wrap py-3 text-xs text-[var(--ink-muted)]">
          © {new Date().getFullYear()}{" "}
          {settings?.companyName || "TT Enterprises"} · {t("common.footerTag")}
        </p>
      </div>
    </footer>
  );
}
