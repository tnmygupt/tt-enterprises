"use client";

import { useEffect, useRef, useState } from "react";
import { Link, usePathname } from "@/i18n/routing";
import { useLocale, useTranslations } from "next-intl";
import { useDb, useSession } from "@/lib/hooks";
import { getAdminQueues } from "@/lib/admin-queues";
import { checkCapability, isSalesDeskStaff, isStaff } from "@/lib/store/db";
import { SALES_DESK_HREFS, staffRoleLabel } from "@/lib/capabilities";
import { refreshCloudDealerDirectory } from "@/lib/cloud-dealers";
import { playStaffNewOrderChime } from "@/lib/whatsapp";
import { notifyStaffPush } from "@/lib/push-client";
import { WhatsAppOutbox } from "@/components/WhatsAppOutbox";
import type { Capability, UserRole } from "@/lib/types";

const NEED_CONFIRM_SEEN_KEY = "tt_staff_need_confirm_seen";
const NEED_VERIFY_SEEN_KEY = "tt_staff_need_verify_seen";
const PENDING_DEALER_SEEN_KEY = "tt_staff_pending_dealer_seen";

function readSeen(key: string): number {
  try {
    return Number(sessionStorage.getItem(key) || "0") || 0;
  } catch {
    return 0;
  }
}

function writeSeen(key: string, count: number): void {
  try {
    sessionStorage.setItem(key, String(count));
  } catch {
    /* private mode — the toast just repeats next load */
  }
}

type NavItem = {
  href: string;
  labelKey: string;
  cap?: Capability;
  /** Visible if the staffer has any of these (used with or instead of cap). */
  anyCap?: Capability[];
  /** Only show for owner / super_admin */
  superOnly?: boolean;
  roles?: UserRole[];
  badge?: keyof ReturnType<typeof getAdminQueues>["counts"];
};

type NavGroup = { titleKey: string; items: NavItem[] };

const GROUPS: NavGroup[] = [
  {
    titleKey: "admin.moduleDesk",
    items: [
      { href: "/admin", labelKey: "admin.dashboard" },
      {
        href: "/admin/orders",
        labelKey: "admin.orders",
        cap: "manage_orders",
        badge: "need_confirm",
      },
      {
        href: "/admin/whatsapp",
        labelKey: "admin.whatsappDesk",
        anyCap: [
          "manage_users",
          "manage_accounts",
          "verify_payment",
          "approve_dealers",
          "manage_shipping",
        ],
      },
      {
        href: "/admin/tracking",
        labelKey: "admin.trackingMatrix",
        anyCap: [
          "manage_shipping",
          "manage_accounts",
          "manage_users",
          "view_financials",
        ],
      },
      {
        href: "/admin/owner",
        labelKey: "admin.ownerTracking",
        superOnly: true,
      },
      {
        href: "/admin/owner/monthly-audit",
        labelKey: "admin.monthlyAudit",
        superOnly: true,
      },
      {
        href: "/admin/audit",
        labelKey: "admin.auditHub",
        anyCap: [
          "manage_accounts",
          "manage_reorder",
          "view_financials",
        ],
      },
      {
        href: "/admin/accounts/payments",
        labelKey: "admin.paymentsDesk",
        cap: "manage_accounts",
        badge: "need_verify_payment",
      },
      { href: "/admin/help", labelKey: "admin.helpGuide" },
    ],
  },
  {
    titleKey: "admin.moduleCatalog",
    items: [
      {
        href: "/admin/home",
        labelKey: "admin.homePage",
        cap: "manage_products",
        superOnly: true,
      },
      {
        href: "/admin/products",
        labelKey: "admin.products",
        cap: "manage_products",
      },
      {
        href: "/admin/rates",
        labelKey: "admin.rates",
        cap: "manage_products",
      },
      {
        href: "/admin/categories",
        labelKey: "admin.categories",
        cap: "manage_products",
      },
      {
        href: "/admin/accounts/inventory",
        labelKey: "admin.stock",
        anyCap: ["manage_accounts", "manage_reorder"],
      },
      {
        href: "/admin/accounts/reports/stock-alerts",
        labelKey: "admin.stockAlerts",
        anyCap: ["manage_accounts", "manage_reorder"],
        badge: "need_reorder",
      },
      {
        href: "/admin/audit/stock-count",
        labelKey: "admin.stockCount",
        roles: ["dispatch", "plant_manager", "accounts", "super_admin"],
        anyCap: ["manage_accounts", "manage_reorder", "view_financials"],
      },
      {
        href: "/admin/accounts/purchases?tab=orders",
        labelKey: "admin.openPurchaseOrders",
        cap: "manage_reorder",
      },
      {
        href: "/admin/schemes",
        labelKey: "admin.schemes",
        cap: "manage_schemes",
      },
    ],
  },
  {
    titleKey: "admin.modulePeople",
    items: [
      {
        href: "/admin/hr",
        labelKey: "admin.hrDesk",
      },
      {
        href: "/admin/hr/punch",
        labelKey: "admin.hrPunch",
      },
      { href: "/admin/users", labelKey: "admin.users", anyCap: ["manage_users", "approve_dealers"] },
      {
        href: "/admin/wallets",
        labelKey: "admin.wallets",
        cap: "manage_wallet",
      },
    ],
  },
  {
    titleKey: "admin.moduleBooks",
    items: [
      {
        href: "/admin/accounts",
        labelKey: "admin.accountsBook",
        cap: "manage_accounts",
      },
    ],
  },
  {
    titleKey: "admin.moduleSetup",
    items: [
      {
        href: "/admin/shipping",
        labelKey: "admin.shipping",
        cap: "manage_shipping",
      },
      {
        href: "/admin/settings",
        labelKey: "admin.settings",
        cap: "manage_users",
      },
    ],
  },
];

export function AdminShell({
  children,
  wide = false,
  hideNav = false,
}: {
  children: React.ReactNode;
  wide?: boolean;
  /** Hide the outer admin sidebar (accounts uses its own nav). */
  hideNav?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const pathname = usePathname();
  const { session, ready } = useSession();
  const { db, refresh } = useDb();
  const queues = getAdminQueues(db);
  const salesDesk = isSalesDeskStaff(session, db);
  const [navOpen, setNavOpen] = useState(false);
  const [pendingOpen, setPendingOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; href: string } | null>(
    null
  );
  const audioReady = useRef(false);
  const pendingDealers = (db?.users ?? []).filter(
    (u) => u.role === "customer" && u.approved !== true && u.active !== false
  ).length;
  const closeLabel = locale === "hi" ? "मेनू बंद करें" : "Close menu";

  useEffect(() => {
    if (!ready || !session || !isStaff(session.role)) return;
    if (
      !checkCapability(session, db, "manage_users") &&
      !checkCapability(session, db, "manage_orders") &&
      !checkCapability(session, db, "approve_dealers")
    ) {
      return;
    }
    let cancelled = false;
    const load = async () => {
      const result = await refreshCloudDealerDirectory();
      if (!cancelled && result?.changed) refresh();
    };
    void load();
    const timer = window.setInterval(() => void load(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, session?.id]);

  useEffect(() => {
    // Close admin nav on route change — intentional sync of derived UI state
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    document.body.style.overflow = navOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [navOpen]);

  // Unlock Web Audio after first click in admin (browser autoplay policy)
  useEffect(() => {
    const unlock = () => {
      audioReady.current = true;
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    return () => window.removeEventListener("pointerdown", unlock);
  }, []);

  // Browser chime + toast when new estimates arrive
  useEffect(() => {
    if (!session || !isStaff(session.role)) return;
    if (!checkCapability(session, db, "manage_orders")) return;
    const count = queues.counts.need_confirm;
    const prev = readSeen(NEED_CONFIRM_SEEN_KEY);
    if (count > prev) {
      if (audioReady.current || prev > 0) {
        playStaffNewOrderChime();
      }
      // Toast is driven by an external count change — intentional
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToast({
        text:
          locale === "hi"
            ? `नया ऑर्डर · प्रोसेस के लिए तैयार (${count})`
            : `New order · ready to process (${count})`,
        href: "/admin/orders?filter=estimate",
      });
      window.setTimeout(() => setToast(null), 5000);
      void notifyStaffPush({
        title: locale === "hi" ? "नया अनुमान" : "New estimate",
        body:
          locale === "hi"
            ? `${count} ऑर्डर प्रोसेस के लिए तैयार`
            : `${count} order(s) ready to process`,
        url: "/en/admin/orders?filter=estimate",
      });
    }
    writeSeen(NEED_CONFIRM_SEEN_KEY, count);
  }, [queues.counts.need_confirm, session, locale, db?.users]);

  // Same chime + toast + push when payment proofs arrive
  useEffect(() => {
    if (!session || !isStaff(session.role)) return;
    if (
      !checkCapability(session, db, "manage_orders") &&
      !checkCapability(session, db, "verify_payment")
    ) {
      return;
    }
    const count = queues.counts.need_verify_payment;
    const prev = readSeen(NEED_VERIFY_SEEN_KEY);
    if (count > prev) {
      if (audioReady.current || prev > 0) {
        playStaffNewOrderChime();
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToast({
        text:
          locale === "hi"
            ? `पेमेंट प्रूफ · जाँच करें (${count})`
            : `Payment proof · verify (${count})`,
        href: "/admin/orders?filter=need_verify",
      });
      window.setTimeout(() => setToast(null), 5000);
      void notifyStaffPush({
        title: locale === "hi" ? "पेमेंट प्रूफ" : "Payment proof",
        body:
          locale === "hi"
            ? `${count} पेमेंट जाँच के लिए तैयार`
            : `${count} payment(s) waiting to verify`,
        url: "/en/admin/orders?filter=need_verify",
      });
    }
    writeSeen(NEED_VERIFY_SEEN_KEY, count);
  }, [queues.counts.need_verify_payment, session, locale, db?.users]);

  // Same treatment for dealers waiting on approval. The signup itself pushes
  // from the server (nobody is logged in then); this covers staff already in
  // the admin when the sync poll brings the new registration in.
  useEffect(() => {
    if (!session || !isStaff(session.role)) return;
    if (
      !checkCapability(session, db, "manage_users") &&
      !checkCapability(session, db, "approve_dealers")
    )
      return;
    const prev = readSeen(PENDING_DEALER_SEEN_KEY);
    if (pendingDealers > prev) {
      if (audioReady.current || prev > 0) {
        playStaffNewOrderChime();
      }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setToast({
        text:
          locale === "hi"
            ? `नया डीलर · मंज़ूरी बाकी (${pendingDealers})`
            : `New dealer · approval pending (${pendingDealers})`,
        href: "/admin/users",
      });
      window.setTimeout(() => setToast(null), 6000);
    }
    writeSeen(PENDING_DEALER_SEEN_KEY, pendingDealers);
  }, [pendingDealers, session, locale, db?.users]);

  if (!ready) {
    return <p className="tt-section tt-wrap">{t("common.loading")}</p>;
  }

  if (!session || !isStaff(session.role)) {
    return (
      <section className="tt-section">
        <div className="tt-wrap tt-panel p-6">
          <p className="font-semibold">{t("common.adminRequired")}</p>
          <p className="mt-2 text-sm text-[var(--ink-muted)]">
            {t("common.adminRequiredHint")}
          </p>
          <Link href="/" className="tt-btn tt-btn-dark mt-4 inline-flex w-full sm:w-auto">
            {t("nav.login")}
          </Link>
        </div>
      </section>
    );
  }

  const pendingTotal =
    queues.counts.need_confirm +
    queues.counts.need_bill +
    queues.counts.need_verify_payment +
    queues.counts.need_lr +
    queues.counts.full_truck;

  const pendingQueues: {
    key: string;
    href: string;
    label: string;
    count: number;
  }[] = [
    {
      key: "need_confirm",
      href: "/admin/orders?filter=estimate",
      label: t("admin.queueEstimates"),
      count: queues.counts.need_confirm,
    },
    {
      key: "need_bill",
      href: "/admin/orders?filter=need_bill",
      label: t("admin.queueNeedBill"),
      count: queues.counts.need_bill,
    },
    {
      key: "need_verify",
      href: "/admin/orders?filter=need_verify",
      label: t("admin.queueVerifyPay"),
      count: queues.counts.need_verify_payment,
    },
    {
      key: "need_lr",
      href: "/admin/orders?filter=need_lr",
      label: t("admin.queueNeedLr"),
      count: queues.counts.need_lr,
    },
    {
      key: "full_truck",
      href: "/admin/orders?filter=full_truck",
      label: t("admin.queueFullTruck"),
      count: queues.counts.full_truck,
    },
    {
      key: "need_voucher",
      href: "/admin/orders?filter=need_voucher",
      label: t("admin.queueNeedVoucher"),
      count: queues.counts.need_voucher,
    },
    {
      key: "need_reorder",
      href: "/admin/accounts/reports/stock-alerts",
      label: t("admin.queueReorder"),
      count: queues.counts.need_reorder,
    },
  ].filter((q) => {
    if (q.count <= 0) return false;
    if (salesDesk && q.href.startsWith("/admin/accounts")) return false;
    if (q.key === "need_voucher") {
      return checkCapability(session, db, "manage_accounts");
    }
    if (q.key === "need_reorder") {
      return (
        checkCapability(session, db, "manage_accounts") ||
        checkCapability(session, db, "manage_reorder")
      );
    }
    return true;
  });

  const nav = (
    <>
      <WhatsAppOutbox />
      <div className="border-b border-[var(--line)] bg-white px-4 py-4">
        <div className="mb-3 flex items-center gap-2.5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/tt-mark.svg"
            alt=""
            className="h-10 w-10 rounded-[0.65rem]"
          />
          <div className="min-w-0">
            <p className="tt-display text-base font-semibold tracking-tight text-[var(--ink)]">
              TT Enterprises
            </p>
            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--brand)]">
              {t("nav.admin")} · {session.name}
            </p>
          </div>
        </div>
        <p className="text-xs capitalize text-[var(--ink-muted)]">
          {staffRoleLabel(session.role, locale === "hi" ? "hi" : "en")}
        </p>
        {pendingQueues.length > 0 ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setPendingOpen((o) => !o)}
              aria-expanded={pendingOpen}
              className="flex w-full items-center justify-between gap-2 rounded-lg bg-[var(--brand-soft)] px-2.5 py-2 text-left text-xs font-bold text-[var(--brand-deep)] transition hover:bg-[var(--brand)] hover:text-white"
            >
              <span>
                {t("common.pendingWork")}:{" "}
                {pendingQueues.reduce((s, q) => s + q.count, 0)}
              </span>
              <span className="text-[10px] font-semibold opacity-80">
                {pendingOpen ? t("admin.hidePending") : t("admin.openPending")}
              </span>
            </button>
            {pendingOpen ? (
              <ul className="mt-1.5 space-y-0.5 rounded-lg border border-[var(--line)] bg-white p-1">
                {pendingQueues.map((q) => (
                  <li key={q.key}>
                    <Link
                      href={q.href}
                      onClick={() => {
                        setNavOpen(false);
                        setPendingOpen(false);
                      }}
                      className="flex min-h-10 items-center justify-between gap-2 rounded-md px-2.5 py-2 text-xs font-semibold text-[var(--ink)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-deep)]"
                    >
                      <span>{q.label}</span>
                      <span className="rounded-md bg-[var(--brand)] px-1.5 py-0.5 text-[10px] font-bold text-white">
                        {q.count}
                      </span>
                    </Link>
                  </li>
                ))}
                <li>
                  <Link
                    href="/admin"
                    onClick={() => {
                      setNavOpen(false);
                      setPendingOpen(false);
                    }}
                    className="flex min-h-9 items-center rounded-md px-2.5 py-1.5 text-[11px] font-medium text-[var(--ink-muted)] hover:bg-[var(--surface)] hover:text-[var(--ink)]"
                  >
                    {t("admin.allQueuesDashboard")}
                  </Link>
                </li>
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
      <nav className="max-h-[60vh] space-y-3 overflow-y-auto p-2 lg:max-h-[75vh]">
        {GROUPS.map((g) => {
          const items = g.items.filter((l) => {
            if (salesDesk && !SALES_DESK_HREFS.has(l.href)) return false;
            if (l.superOnly && session.role !== "super_admin") return false;
            if (l.roles?.length && l.roles.includes(session.role)) return true;
            if (l.anyCap?.length) {
              return l.anyCap.some((c) => checkCapability(session, db, c));
            }
            if (l.cap) return checkCapability(session, db, l.cap);
            return !l.roles?.length;
          });
          if (!items.length) return null;
          return (
            <div key={g.titleKey}>
              <p className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                {t(g.titleKey)}
              </p>
              <div className="flex flex-col gap-0.5">
                {items.map((l) => {
                  const active =
                    l.href === "/admin"
                      ? pathname === "/admin"
                      : pathname === l.href ||
                        pathname.startsWith(`${l.href}/`);
                  const badgeCount = l.badge ? queues.counts[l.badge] : 0;
                  const showBadge =
                    l.href === "/admin/orders"
                      ? pendingTotal
                      : l.href === "/admin/users"
                        ? pendingDealers
                        : badgeCount;
                  return (
                    <Link
                      key={l.href}
                      href={l.href}
                      onClick={() => setNavOpen(false)}
                      className={`flex min-h-11 items-center justify-between rounded-lg px-2.5 py-2.5 text-sm ${
                        active
                          ? "tt-selected bg-[var(--brand)] font-semibold text-white"
                          : "text-[var(--ink-muted)] hover:bg-[var(--brand-soft)] hover:text-[var(--brand-deep)]"
                      }`}
                    >
                      <span>
                        {l.href === "/admin/hr" &&
                        session.role !== "super_admin"
                          ? t("admin.hrMyDesk")
                          : t(l.labelKey as "admin.dashboard")}
                      </span>
                      {showBadge > 0 ? (
                        <span
                          className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                            active
                              ? "bg-white/25 text-white"
                              : "bg-[var(--brand)] text-white"
                          }`}
                        >
                          {showBadge}
                        </span>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-[var(--line)] p-3">
        <Link
          href="/"
          className="inline-flex min-h-11 items-center text-sm font-medium text-[var(--ink-muted)] hover:text-[var(--ink)]"
        >
          ← {t("common.backToStore")}
        </Link>
      </div>
    </>
  );

  return (
    <div className="min-h-[70vh] border-t border-[var(--line)] bg-[var(--surface)]">
      {toast ? (
        <Link
          href={toast.href}
          className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 left-4 z-50 max-w-sm rounded-xl border border-[var(--line)] bg-white px-4 py-3 text-sm font-semibold text-[var(--brand-deep)] shadow-lg print:hidden hover:border-[var(--brand)] sm:left-auto"
          role="status"
          onClick={() => setToast(null)}
        >
          {toast.text}
          <span className="mt-1 block text-xs font-medium text-[var(--ink-muted)]">
            {t("admin.viewArrow")}
          </span>
        </Link>
      ) : null}
      <div
        className={`${wide ? "tt-admin-wrap" : "tt-wrap"} grid gap-4 py-4 ${
          hideNav ? "" : "lg:grid-cols-[220px_1fr]"
        } lg:gap-5 lg:py-5`}
      >
        {hideNav ? null : (
          <div className="lg:hidden print:hidden">
            <button
              type="button"
              className="tt-btn tt-btn-outline w-full"
              onClick={() => setNavOpen((o) => !o)}
              aria-expanded={navOpen}
            >
              {navOpen
                ? closeLabel
                : pendingTotal > 0
                  ? t("admin.adminMenuCount", { count: pendingTotal })
                  : t("admin.adminMenu")}
            </button>
            {navOpen ? (
              <aside className="tt-panel mt-3 max-h-[min(70dvh,calc(100dvh-8rem))] overflow-y-auto p-0">
                {nav}
              </aside>
            ) : null}
          </div>
        )}

        {hideNav ? null : (
          <aside className="tt-panel admin-shell-nav hidden h-fit overflow-hidden p-0 print:hidden lg:sticky lg:top-16 lg:block">
            {nav}
          </aside>
        )}
        <div className="admin-shell-main min-w-0">{children}</div>
      </div>
    </div>
  );
}
