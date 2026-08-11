"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { categoryLabel } from "@/lib/categories";
import { useDb, useSession } from "@/lib/hooks";
import { loc } from "@/lib/localized";
import { formatInr } from "@/lib/pricing";
import {
  dealerHasScheme,
  formatSchemeDuration,
  isSchemeVisibleToDealer,
  schemeRewardAmount,
  schemeRewardLabel,
} from "@/lib/schemes";
import {
  checkCapability,
  isStaff,
  loginAsync,
  registerCustomer,
} from "@/lib/store/db";
import type { Order, Product, Scheme } from "@/lib/types";

function useHomeContent() {
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db } = useDb();

  const newProducts = useMemo(() => {
    if (!db) return [] as Product[];
    return [...(db.products ?? [])]
      .filter((p) => p.active)
      .sort((a, b) => {
        if (a.featured !== b.featured) return a.featured ? -1 : 1;
        return String(b.createdAt || "").localeCompare(String(a.createdAt || ""));
      })
      .slice(0, 6);
  }, [db]);

  const myOrders = useMemo(() => {
    if (!db || !session) return [] as Order[];
    return [...(db.orders ?? [])]
      .filter((o) => o.userId === session.id)
      .sort((a, b) =>
        String(b.createdAt || "").localeCompare(String(a.createdAt || ""))
      )
      .slice(0, 3);
  }, [db, session]);

  const schemes = useMemo(() => {
    if (!db) return [] as Scheme[];
    const user = session
      ? (db.users ?? []).find((u) => u.id === session.id)
      : undefined;
    return (db.schemes ?? [])
      .filter((s) => isSchemeVisibleToDealer(s))
      .filter((s) =>
        !user || session?.role !== "customer"
          ? true
          : dealerHasScheme(s, user.assignedSchemeIds || [])
      )
      .slice(0, 4);
  }, [db, session]);

  return { db, locale, session, myOrders, newProducts, schemes };
}

function MyOrdersSection({ orders }: { orders: Order[] }) {
  const t = useTranslations();
  const { locale } = useHomeContent();

  return (
    <section className="tt-animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="tt-display text-3xl text-[var(--brand-deep)]">
            {t("home.myOrders")}
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {t("home.myOrdersHint")}
          </p>
        </div>
        <Link href="/orders" className="tt-btn tt-btn-outline">
          {t("home.viewAllOrders")}
        </Link>
      </div>

      {orders.length ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {orders.map((o, i) => (
            <Link
              key={o.id}
              href={`/orders/${o.id}`}
              className={`tt-panel p-4 transition hover:border-[var(--brand)] ${
                i > 0 ? "tt-animate-rise-delay" : ""
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold text-[var(--ink)]">
                    {o.orderNumber}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {new Date(o.createdAt).toLocaleDateString(
                      locale === "hi" ? "hi-IN" : "en-IN",
                      { day: "2-digit", month: "short", year: "numeric" }
                    )}
                  </p>
                </div>
                <span className="tt-status shrink-0">
                  {t(`orderStatus.${o.status}` as "orderStatus.estimate")}
                </span>
              </div>
              <div className="mt-3 flex items-end justify-between gap-3">
                <p className="text-lg font-bold tabular-nums text-[var(--brand-deep)]">
                  {formatInr(o.actualBillAmount ?? o.estimatedTotal, locale)}
                </p>
                <span className="text-xs font-semibold text-[var(--brand)]">
                  {t("common.track")} →
                </span>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <div className="tt-panel mt-5 p-6 text-center">
          <p className="text-[var(--ink-muted)]">{t("home.noOrdersYet")}</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Link href="/quick-order" className="tt-btn tt-btn-dark">
              {t("nav.quickOrder")}
            </Link>
            <Link href="/catalog" className="tt-btn tt-btn-outline">
              {t("nav.catalog")}
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}

function ProductsSection({
  products,
  loggedIn,
}: {
  products: Product[];
  loggedIn: boolean;
}) {
  const t = useTranslations();
  const { db, locale } = useHomeContent();

  return (
    <section className="tt-animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="tt-display text-3xl text-[var(--brand-deep)]">
            {t("home.newProducts")}
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {t("home.newProductsHint")}
          </p>
        </div>
        {loggedIn ? (
          <Link href="/catalog" className="tt-btn tt-btn-outline">
            {t("home.viewAllProducts")}
          </Link>
        ) : null}
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
        {products.map((p, i) => {
          const href = loggedIn ? `/catalog/${p.id}` : "/";
          const inner = (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={p.logoUrl || p.media?.[0]?.url || ""}
                alt={loc(p.name, locale, p.code || "Product")}
                className="h-28 w-full object-cover"
                style={{ background: "#eef0f3" }}
                loading={i < 3 ? "eager" : "lazy"}
                decoding="async"
              />
              <div className="p-4">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                  {categoryLabel(db?.categories, p.category, locale)}
                  {p.featured
                    ? ` · ${locale === "hi" ? "नया" : "New"}`
                    : ""}
                </p>
                <h3 className="mt-1 truncate font-semibold text-[var(--ink)]">
                  {loc(p.name, locale, p.code || "Product")}
                </h3>
                {loggedIn ? (
                  <p className="mt-1 text-sm font-semibold text-[var(--brand-deep)]">
                    {formatInr(p.baseRate, locale)} / {p.unit}
                  </p>
                ) : null}
              </div>
            </>
          );

          return loggedIn ? (
            <Link
              key={p.id}
              href={href}
              className={`tt-panel overflow-hidden transition hover:border-[var(--brand)] ${
                i > 0 ? "tt-animate-rise-delay" : ""
              }`}
            >
              {inner}
            </Link>
          ) : (
            <div
              key={p.id}
              className={`tt-panel overflow-hidden ${i > 0 ? "tt-animate-rise-delay" : ""}`}
            >
              {inner}
            </div>
          );
        })}
      </div>
      {!products.length ? (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">{t("common.empty")}</p>
      ) : null}
    </section>
  );
}

function SchemesSection({
  schemes,
  loggedIn,
}: {
  schemes: Scheme[];
  loggedIn: boolean;
}) {
  const t = useTranslations();
  const { locale } = useHomeContent();

  return (
    <section className="tt-animate-rise">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="tt-display text-3xl text-[var(--brand-deep)]">
            {t("home.activeSchemes")}
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-muted)]">
            {t("home.schemesHint")}
          </p>
        </div>
        {loggedIn ? (
          <Link href="/schemes" className="tt-btn tt-btn-outline">
            {t("home.viewAllSchemes")}
          </Link>
        ) : null}
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {schemes.map((s) => {
          const reward = schemeRewardAmount(s);
          return (
            <article
              key={s.id}
              className="overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[var(--shadow)]"
            >
              <div className="border-b border-[var(--line)] bg-[var(--surface-2)] px-5 py-4">
                <h3 className="text-lg font-semibold text-[var(--ink)]">
                  {s.name?.[locale] || s.name?.en || s.id}
                </h3>
                <p className="mt-1 text-sm text-[var(--brand)]">
                  {formatSchemeDuration(s, locale)}
                </p>
              </div>
              <div className="space-y-2 p-5 text-sm">
                <p className="text-[var(--ink-muted)]">
                  {s.description?.[locale] || s.description?.en || ""}
                </p>
                <p>
                  <strong>
                    {locale === "hi" ? "लक्ष्य" : "Target"}:
                  </strong>{" "}
                  {(Number(s.targetWeightKg) || 0).toLocaleString(
                    locale === "hi" ? "hi-IN" : "en-IN"
                  )}{" "}
                  {t("common.kg")}
                </p>
                <p>
                  <strong>
                    {locale === "hi" ? "रिवॉर्ड" : "Reward"}:
                  </strong>{" "}
                  {schemeRewardLabel(s, locale)}
                  {reward > 0 ? ` · ${formatInr(reward, locale)}` : ""}
                </p>
              </div>
            </article>
          );
        })}
      </div>
      {!schemes.length ? (
        <p className="mt-4 text-sm text-[var(--ink-muted)]">{t("common.empty")}</p>
      ) : null}
    </section>
  );
}

function MoreInfoSection() {
  const t = useTranslations();
  const { db, locale } = useHomeContent();
  const settings = db?.settings;

  const steps = [
    { title: t("home.step1Title"), body: t("home.step1Body") },
    { title: t("home.step2Title"), body: t("home.step2Body") },
    { title: t("home.step3Title"), body: t("home.step3Body") },
  ];

  return (
    <section className="tt-animate-fade">
      <div>
        <h2 className="tt-display text-3xl text-[var(--brand-deep)]">
          {t("home.moreInfo")}
        </h2>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">
          {t("home.moreInfoHint")}
        </p>
      </div>

      <ol className="mt-5 grid gap-4 md:grid-cols-3">
        {steps.map((step, i) => (
          <li key={step.title} className="relative pl-10 md:pl-0 md:pt-10">
            <span className="absolute left-0 top-0 flex h-7 w-7 items-center justify-center rounded-full bg-[var(--brand-deep)] text-sm font-bold text-white md:left-0">
              {i + 1}
            </span>
            <h3 className="font-semibold text-[var(--ink)]">{step.title}</h3>
            <p className="mt-2 text-sm text-[var(--ink-muted)]">{step.body}</p>
          </li>
        ))}
      </ol>

      <Link
        href="/help"
        className="tt-btn tt-btn-outline mt-6 inline-flex"
      >
        {locale === "hi" ? "पूरी गाइड + वीडियो →" : "Full guide + video →"}
      </Link>

      {settings ? (
        <div className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] p-5">
          <h3 className="font-semibold text-[var(--brand-deep)]">
            {t("home.contactTitle")}
          </h3>
          <div className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
            <p>
              <span className="text-[var(--ink-muted)]">
                {locale === "hi" ? "कंपनी" : "Company"}
              </span>
              <br />
              <strong>{settings.companyName}</strong>
            </p>
            <p>
              <span className="text-[var(--ink-muted)]">
                {locale === "hi" ? "फ़ोन" : "Phone"}
              </span>
              <br />
              <strong>
                <a href={`tel:${settings.phone}`}>{settings.phone || "—"}</a>
                {settings.phone2 ? (
                  <>
                    <br />
                    <a href={`tel:${settings.phone2}`}>{settings.phone2}</a>
                  </>
                ) : null}
              </strong>
            </p>
            <p className="sm:col-span-2 lg:col-span-1">
              <span className="text-[var(--ink-muted)]">
                {locale === "hi" ? "पता" : "Address"}
              </span>
              <br />
              <strong>{settings.address || "—"}</strong>
              {settings.address2 ? (
                <>
                  <br />
                  <strong>{settings.address2}</strong>
                </>
              ) : null}
            </p>
          </div>
          {settings.gstin ? (
            <p className="mt-3 text-xs text-[var(--ink-muted)]">
              GSTIN: {settings.gstin}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function LoggedInHome() {
  const t = useTranslations();
  const { db, locale, session, myOrders, newProducts, schemes } =
    useHomeContent();
  const name = session?.name || (locale === "hi" ? "डीलर" : "Dealer");
  const companyName = db?.settings?.companyName || "TT Enterprises";

  return (
    <section className="tt-section">
      <div className="tt-wrap space-y-12">
        <div className="tt-hero tt-animate-fade">
          <p className="tt-hero-kicker">
            {locale === "hi" ? "स्वागत है" : "Welcome"}
          </p>
          <h1 className="tt-hero-title">
            <strong>{name}</strong>
          </h1>
          <p className="mt-2 text-xl font-semibold text-[var(--brand-deep)]">
            {companyName}
          </p>
          <p className="tt-hero-support">
            {locale === "hi"
              ? "डिजिटल स्टोर — ऑर्डर करें, रेट देखें, और स्कीम ट्रैक करें।"
              : "Digital store — place orders, check rates, and track schemes."}
          </p>
          <div className="tt-hero-actions">
            <Link href="/price-list" className="tt-btn tt-btn-primary">
              {t("home.ctaPrice")}
            </Link>
            <Link href="/quick-order" className="tt-btn tt-btn-ghost">
              {t("nav.quickOrder")}
            </Link>
            {session && isStaff(session.role) ? (
              <Link href="/admin" className="tt-btn tt-btn-outline">
                {t("nav.admin")}
              </Link>
            ) : null}
          </div>
        </div>

        <MyOrdersSection orders={myOrders} />
        <ProductsSection products={newProducts} loggedIn />
        <SchemesSection schemes={schemes} loggedIn />
        <MoreInfoSection />
      </div>
    </section>
  );
}

/**
 * Staff opening the site want the desk, not the dealer storefront — send them
 * straight to the queues they actually work from.
 */
function StaffHome() {
  const t = useTranslations();
  const { db, locale, session } = useHomeContent();
  const companyName = db?.settings?.companyName || "TT Enterprises";
  const name = session?.name || (locale === "hi" ? "स्टाफ़" : "Staff");

  const shortcuts: { href: string; label: string; hint: string }[] = [
    {
      href: "/admin",
      label: t("admin.dashboard"),
      hint: locale === "hi" ? "आज की कतारें" : "Today's queues",
    },
  ];
  if (checkCapability(session, db?.users, "manage_orders")) {
    shortcuts.push(
      {
        href: "/admin/orders",
        label: t("admin.orders"),
        hint: locale === "hi" ? "अनुमान → डिलीवरी" : "Estimate → delivery",
      },
      {
        href: "/admin/tracking",
        label: t("admin.trackingMatrix"),
        hint: locale === "hi" ? "पाइपलाइन + ट्रैफ़िक" : "Pipeline + traffic",
      }
    );
  }
  if (checkCapability(session, db?.users, "manage_accounts")) {
    shortcuts.push({
      href: "/admin/accounts",
      label: t("admin.accountsBook"),
      hint: locale === "hi" ? "बही-खाता" : "Books",
    });
  }

  return (
    <section className="tt-section">
      <div className="tt-wrap space-y-8">
        <div className="tt-hero tt-animate-fade">
          <p className="tt-hero-kicker">
            {locale === "hi" ? "स्वागत है" : "Welcome"}
          </p>
          <h1 className="tt-hero-title">
            <strong>{name}</strong>
          </h1>
          <p className="mt-2 text-xl font-semibold text-[var(--brand-deep)]">
            {companyName}
          </p>
          <p className="tt-hero-support">
            {locale === "hi"
              ? "स्टाफ़ डेस्क — कतारें, ऑर्डर और बही-खाता एक जगह।"
              : "Staff desk — queues, orders and books in one place."}
          </p>
          <div className="tt-hero-actions">
            <Link href="/admin" className="tt-btn tt-btn-primary">
              {t("nav.admin")}
            </Link>
            <Link href="/price-list" className="tt-btn tt-btn-ghost">
              {t("home.ctaPrice")}
            </Link>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {shortcuts.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="tt-panel p-4 transition hover:border-[var(--brand)]"
            >
              <p className="font-semibold text-[var(--ink)]">{s.label}</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">{s.hint}</p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

function AuthLanding() {
  const t = useTranslations();
  const router = useRouter();
  const { db, locale } = useHomeContent();
  const companyName = db?.settings?.companyName || "TT Enterprises";
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [error, setError] = useState("");
  const [signupDone, setSignupDone] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginForm, setLoginForm] = useState({ phone: "", password: "" });
  const [signup, setSignup] = useState({
    name: "",
    password: "",
    phone: "",
    company: "",
    address: "",
    pincode: "",
    gstOrAadhar: "",
    transport: "",
  });

  useEffect(() => {
    try {
      const flash = sessionStorage.getItem("tt_auth_flash");
      if (flash) {
        sessionStorage.removeItem("tt_auth_flash");
        // Hydrating from sessionStorage handoff — intentional
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setError(flash);
      }
      if (sessionStorage.getItem("tt_auth_tab") === "signup") {
        sessionStorage.removeItem("tt_auth_tab");
        setTab("signup");
      }
    } catch {
      /* ignore */
    }
  }, []);

  const onLogin = async (e: FormEvent) => {
    e.preventDefault();
    if (loginBusy) return;
    setError("");
    setLoginBusy(true);
    try {
      const session = await loginAsync(loginForm.phone, loginForm.password);
      router.push(session.role === "customer" ? "/" : "/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoginBusy(false);
    }
  };

  const onSignup = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      await registerCustomer({ ...signup, locale });
      setSignupDone(true);
      setTab("login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Signup failed");
    }
  };

  return (
    <section className="tt-section">
      <div className="tt-wrap space-y-12">
        <div className="grid gap-6 lg:grid-cols-[1.05fr_1fr] lg:items-stretch">
          <div className="tt-hero tt-animate-fade flex flex-col justify-center">
            <div className="mb-5 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/brand/tt-mark.svg"
                alt=""
                className="h-14 w-14 rounded-2xl shadow-sm"
              />
              <div>
                <p className="tt-display text-2xl font-semibold tracking-tight text-[var(--ink)] sm:text-3xl">
                  {companyName}
                </p>
                <p className="mt-1 text-xs font-bold uppercase tracking-[0.16em] text-[var(--brand)]">
                  {locale === "hi" ? "थोक व्यापार" : "Wholesale"}
                </p>
              </div>
            </div>
            <h1 className="sr-only">{companyName}</h1>
            <p className="tt-hero-support">
              {locale === "hi"
                ? "डीलर डिजिटल स्टोर — लॉगिन करें और ऑर्डर शुरू करें।"
                : "Dealer digital store — log in to order and check rates."}
            </p>
            <p className="mt-5 text-sm font-medium text-[var(--brand)]">
              {t("home.loginToOrder")}
            </p>
          </div>

          <div className="tt-panel p-5 sm:p-6">
            <div className="flex rounded-xl bg-[var(--surface-2)] p-1">
              <button
                type="button"
                className={`flex min-h-11 flex-1 items-center justify-center rounded-lg py-2 text-sm font-semibold ${
                  tab === "login"
                    ? "bg-white text-[var(--brand-deep)] shadow-sm"
                    : "text-[var(--ink-muted)]"
                }`}
                onClick={() => {
                  setTab("login");
                  setError("");
                }}
              >
                {t("nav.login")}
              </button>
              <button
                type="button"
                className={`flex min-h-11 flex-1 items-center justify-center rounded-lg py-2 text-sm font-semibold ${
                  tab === "signup"
                    ? "bg-white text-[var(--brand-deep)] shadow-sm"
                    : "text-[var(--ink-muted)]"
                }`}
                onClick={() => {
                  setTab("signup");
                  setError("");
                }}
              >
                {t("nav.register")}
              </button>
            </div>

            {signupDone ? (
              <p className="mt-4 rounded-xl bg-[#e8f2ea] p-3 text-sm text-[var(--ok)]">
                {t("auth.pendingApproval")}
              </p>
            ) : null}

            {tab === "login" ? (
              <form className="mt-5 space-y-4" onSubmit={onLogin}>
                <div>
                  <label className="tt-label">{t("auth.phone")} *</label>
                  <input
                    className="tt-input"
                    type="tel"
                    inputMode="numeric"
                    placeholder="10-digit mobile"
                    value={loginForm.phone}
                    onChange={(e) =>
                      setLoginForm({ ...loginForm, phone: e.target.value })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="tt-label">{t("auth.password")}</label>
                  <input
                    className="tt-input"
                    type="password"
                    value={loginForm.password}
                    onChange={(e) =>
                      setLoginForm({ ...loginForm, password: e.target.value })
                    }
                    required
                  />
                </div>
                {error ? (
                  <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-[var(--danger)]">
                    {error}
                  </p>
                ) : null}
                <button
                  type="submit"
                  className="tt-btn tt-btn-dark w-full"
                  disabled={loginBusy}
                >
                  {loginBusy
                    ? locale === "hi"
                      ? "लॉगिन हो रहा है…"
                      : "Signing in…"
                    : t("nav.login")}
                </button>
              </form>
            ) : (
              <form className="mt-5 grid gap-3 sm:grid-cols-2" onSubmit={onSignup}>
                <div className="sm:col-span-2">
                  <label className="tt-label">{t("auth.name")} *</label>
                  <input
                    className="tt-input"
                    value={signup.name}
                    onChange={(e) =>
                      setSignup({ ...signup, name: e.target.value })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="tt-label">{t("auth.phone")} *</label>
                  <input
                    className="tt-input"
                    type="tel"
                    inputMode="numeric"
                    placeholder="10-digit mobile"
                    value={signup.phone}
                    onChange={(e) =>
                      setSignup({ ...signup, phone: e.target.value })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="tt-label">{t("auth.password")} *</label>
                  <input
                    className="tt-input"
                    type="password"
                    value={signup.password}
                    onChange={(e) =>
                      setSignup({ ...signup, password: e.target.value })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="tt-label">{t("checkout.gstAadhar")}</label>
                  <input
                    className="tt-input"
                    value={signup.gstOrAadhar}
                    onChange={(e) =>
                      setSignup({ ...signup, gstOrAadhar: e.target.value })
                    }
                    placeholder="GSTIN / Aadhaar"
                  />
                </div>
                <div>
                  <label className="tt-label">{t("auth.company")}</label>
                  <input
                    className="tt-input"
                    value={signup.company}
                    onChange={(e) =>
                      setSignup({ ...signup, company: e.target.value })
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="tt-label">{t("checkout.transport")}</label>
                  <input
                    className="tt-input"
                    value={signup.transport}
                    onChange={(e) =>
                      setSignup({ ...signup, transport: e.target.value })
                    }
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="tt-label">{t("auth.address")} *</label>
                  <textarea
                    className="tt-textarea"
                    value={signup.address}
                    onChange={(e) =>
                      setSignup({ ...signup, address: e.target.value })
                    }
                    required
                  />
                </div>
                <div>
                  <label className="tt-label">{t("auth.pincode")} *</label>
                  <input
                    className="tt-input"
                    type="tel"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="6-digit PIN"
                    value={signup.pincode}
                    onChange={(e) =>
                      setSignup({
                        ...signup,
                        pincode: e.target.value.replace(/\D/g, "").slice(0, 6),
                      })
                    }
                    required
                  />
                </div>
                {error ? (
                  <p className="sm:col-span-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-[var(--danger)]">
                    {error}
                  </p>
                ) : null}
                <p className="sm:col-span-2 text-xs text-[var(--ink-muted)]">
                  {t("auth.registerNote")}
                </p>
                <button
                  type="submit"
                  className="tt-btn tt-btn-dark sm:col-span-2"
                >
                  {t("nav.register")}
                </button>
              </form>
            )}
          </div>
        </div>

        <MoreInfoSection />
      </div>
    </section>
  );
}

export default function HomePage() {
  const { session, ready } = useSession();

  // Never leave mobile stuck on a blank loading screen if hydration is slow.
  // Guests see the login landing immediately; session appears once ready.
  if (!ready) {
    return <AuthLanding />;
  }

  if (!session) return <AuthLanding />;
  return isStaff(session.role) ? <StaffHome /> : <LoggedInHome />;
}
