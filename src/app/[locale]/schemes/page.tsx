"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import {
  dealerHasScheme,
  daysUntilSchemeEnd,
  estimateSchemePayout,
  formatSchemeDuration,
  getAchievedTier,
  getDealerTierStatuses,
  getSchemeLevels,
  isPercentScheme,
  isOrderDiscountScheme,
  isSchemeActiveNow,
  isSchemeEndingSoon,
  isSchemeVisibleToDealer,
  listSchemeContributions,
  schemeLevelLabel,
  schemeRewardLabel,
  schemeScopeLabel,
  schemeTierRate,
  schemeUnitLabel,
} from "@/lib/schemes";
import type { Scheme } from "@/lib/types";

type StatusFilter = "all" | "live" | "ending_soon";

export default function SchemesPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db } = useDb();
  const [openTerms, setOpenTerms] = useState<string | null>(null);
  const [openTx, setOpenTx] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // Capture "now" once at mount so re-renders don't shift countdown values
  // and so React 19's purity lint doesn't flag Date.now() in render.
  const [now] = useState<number>(() => Date.now());

  const user = db?.users.find((u) => u.id === session?.id);

  const schemes = useMemo(() => {
    if (!db || !user) return [] as Scheme[];
    const at = new Date(now);
    return db.schemes.filter(
      (s) =>
        dealerHasScheme(s, user.assignedSchemeIds || []) &&
        isSchemeVisibleToDealer(s, at)
    );
  }, [db, user, now]);

  const visible = useMemo(() => {
    const at = new Date(now);
    return schemes.filter((s) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "live") return isSchemeActiveNow(s, at);
      return isSchemeEndingSoon(s, at);
    });
  }, [schemes, statusFilter, now]);

  const summary = useMemo(() => {
    const at = new Date(now);
    let live = 0;
    let endingSoon = 0;
    let estimatedTotal = 0;
    for (const s of schemes) {
      if (isSchemeActiveNow(s, at)) live += 1;
      if (isSchemeEndingSoon(s, at)) endingSoon += 1;
      const progress = user?.schemeProgress?.[s.id] ?? 0;
      const salesValue = user?.schemeValueProgress?.[s.id] ?? 0;
      estimatedTotal += estimateSchemePayout(s, progress, salesValue);
    }
    return {
      total: schemes.length,
      live,
      endingSoon,
      estimatedTotal: Math.round(estimatedTotal * 100) / 100,
    };
  }, [schemes, user, now]);

  if (!session) {
    return (
      <section className="tt-section">
        <div className="tt-wrap tt-panel max-w-lg p-6">
          <p className="text-[var(--ink-muted)]">{t("common.loginRequired")}</p>
          <Link
            href="/"
            className="tt-btn tt-btn-dark mt-4 inline-flex w-full sm:w-auto"
          >
            {t("nav.login")}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="tt-section">
      <div className="tt-wrap space-y-6">
        {/* --- Header ------------------------------------------------- */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold sm:text-3xl">
              {t("nav.schemes")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
              {locale === "hi"
                ? "लिफ्टिंग स्कीम: ऊँची टियर → पूरा लिफ्ट पर रेट, समाप्ति पर वॉलेट। प्रति-ऑर्डर छूट: इस ऑर्डर की मात्रा से टियर, बिल पर छूट।"
                : "Lifting schemes: higher tier rate on full lift, wallet credit when the scheme ends. Per-order discounts: tier by this order’s qty, applied on the bill."}
            </p>
          </div>
          <Link
            href="/wallet"
            className="tt-btn tt-btn-outline whitespace-nowrap"
          >
            {t("nav.wallet")}: {formatInr(user?.walletBalance ?? 0, locale)}
          </Link>
        </div>

        {/* --- Summary stats ---------------------------------------- */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryTile
            label={locale === "hi" ? "आपको सौंपी" : "Assigned to you"}
            value={String(summary.total)}
          />
          <SummaryTile
            label={locale === "hi" ? "चालू" : "Live now"}
            value={String(summary.live)}
            tone="brand"
          />
          <SummaryTile
            label={
              locale === "hi" ? "7 दिन में समाप्त" : "Ending in 7 days"
            }
            value={String(summary.endingSoon)}
            tone={summary.endingSoon > 0 ? "warn" : "muted"}
          />
          <SummaryTile
            label={locale === "hi" ? "कुल अनुमान" : "Estimated payout"}
            value={formatInr(summary.estimatedTotal, locale)}
            tone="ok"
          />
        </div>

        {/* --- Filter chips ---------------------------------------- */}
        <div className="flex flex-wrap gap-2">
          {(["all", "live", "ending_soon"] as StatusFilter[]).map((f) => {
            const isActive = statusFilter === f;
            const count =
              f === "all"
                ? summary.total
                : f === "live"
                  ? summary.live
                  : summary.endingSoon;
            const label =
              f === "all"
                ? locale === "hi"
                  ? "सभी"
                  : "All"
                : f === "live"
                  ? locale === "hi"
                    ? "चालू"
                    : "Live"
                  : locale === "hi"
                    ? "7 दिन में समाप्त"
                    : "Ending soon";
            return (
              <button
                key={f}
                type="button"
                onClick={() => setStatusFilter(f)}
                className={`tt-chip ${
                  isActive ? "tt-chip-active" : ""
                }`}
              >
                {label}
                <span className="tt-chip-count">{count}</span>
              </button>
            );
          })}
        </div>

        {/* --- Scheme cards ---------------------------------------- */}
        <div className="grid gap-4 xl:grid-cols-2">
          {visible.map((s) => {
            const progress = user?.schemeProgress?.[s.id] ?? 0;
            const levels = getSchemeLevels(s);
            const topLevel = levels[levels.length - 1];
            const topTarget =
              topLevel?.targetAmount || s.targetWeightKg || 1;
            const topRate = topLevel ? schemeTierRate(s, topLevel) : 0;
            const aboveTop = progress + 1e-9 > topTarget;
            const pct = Math.min(
              100,
              topTarget > 0 ? (progress / topTarget) * 100 : 0
            );
            const live = isSchemeActiveNow(s, new Date(now));
            const endingSoon = isSchemeEndingSoon(s, new Date(now));
            const unit = schemeUnitLabel(s, locale);
            const statuses = getDealerTierStatuses(
              s,
              progress,
              user?.schemeValueProgress?.[s.id] ?? 0
            );
            const achieved = getAchievedTier(s, progress);
            const currentRate = achieved ? schemeTierRate(s, achieved) : 0;
            const estPayout = estimateSchemePayout(
              s,
              progress,
              user?.schemeValueProgress?.[s.id] ?? 0
            );
            const nextTier = statuses.find((x) => !x.unlocked);
            const contributions =
              db && user
                ? listSchemeContributions(
                    s,
                    db.orders,
                    db.products,
                    user.id,
                    db.walletTransactions
                  )
                : [];
            const daysLeft = daysUntilSchemeEnd(s, new Date(now));
            const startedAgoDays = Math.max(
              0,
              Math.floor(
                (now - new Date(s.startDate).getTime()) /
                  (1000 * 60 * 60 * 24)
              )
            );

            return (
              <article
                key={s.id}
                className="tt-panel overflow-hidden shadow-[var(--shadow)]"
              >
                {/* Header strip --------------------------------- */}
                <header
                  className={`tt-scheme-hero ${
                    endingSoon ? "tt-scheme-hero-ending" : "tt-scheme-hero-live"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-white/70">
                        {schemeScopeLabel(
                          s,
                          locale,
                          db?.products ?? [],
                          db?.categories
                        )}
                      </p>
                      <h2 className="mt-1 text-xl font-bold text-white sm:text-2xl">
                        {s.name[locale]}
                      </h2>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        endingSoon
                          ? "bg-amber-300 text-amber-950"
                          : "bg-white text-[var(--brand-deep)]"
                      }`}
                    >
                      {endingSoon
                        ? locale === "hi"
                          ? `${daysLeft} दिन बाकी`
                          : `${daysLeft}d left`
                        : locale === "hi"
                          ? "चालू"
                          : "Live"}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-white/85">
                    {schemeRewardLabel(s, locale)}
                  </p>
                </header>

                {/* Body --------------------------------------- */}
                <div className="space-y-5 p-5">
                  {endingSoon ? (
                    <div className="tt-scheme-callout tt-scheme-callout-warn">
                      <p className="text-sm font-bold text-amber-800">
                        {locale === "hi"
                          ? `⏰ ${daysLeft} दिन में स्कीम समाप्त`
                          : `⏰ Scheme ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"}`}
                      </p>
                      <p className="mt-1 text-sm text-[var(--ink)]">
                        {isOrderDiscountScheme(s)
                          ? t("schemes.endingSoonOrder")
                          : locale === "hi"
                            ? "समाप्ति के बाद यह स्कीम लिस्ट से हट जाएगी और पेआउट वॉलेट में लगेगा।"
                            : "After it ends this scheme leaves your list and payout posts to wallet."}
                      </p>
                    </div>
                  ) : null}

                  {isOrderDiscountScheme(s) ? (
                    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
                      <p className="text-xs font-bold uppercase tracking-wide text-[var(--brand)]">
                        {t("schemes.orderDiscount")}
                      </p>
                      <p className="mt-2 text-sm text-[var(--ink)]">
                        {t("schemes.orderDiscountHint")}
                      </p>
                      <ul className="mt-3 space-y-1.5 text-sm">
                        {levels.map((l) => (
                          <li key={l.id} className="flex justify-between gap-2">
                            <span className="text-[var(--ink-muted)]">
                              {schemeLevelLabel(l, locale)} ·{" "}
                              {l.targetAmount} {unit}+
                            </span>
                            <span className="font-semibold tabular-nums">
                              {s.rewardType === "order_percent"
                                ? `${schemeTierRate(s, l)}%`
                                : formatInr(schemeTierRate(s, l), locale)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                  /* Progress ring + estimate ------------------ */
                  <div className="grid grid-cols-[auto_1fr] items-center gap-4">
                    <ProgressRing
                      pct={pct}
                      centerLabel={
                        aboveTop
                          ? locale === "hi"
                            ? "पूरा"
                            : "Max"
                          : `${Math.round(pct)}%`
                      }
                    />
                    <div className="min-w-0 space-y-1">
                      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
                        {locale === "hi"
                          ? "अनुमानित पेआउट"
                          : "Estimated payout"}
                      </p>
                      <p className="text-2xl font-bold tabular-nums text-[var(--brand-deep,var(--brand))]">
                        {formatInr(estPayout, locale)}
                      </p>
                      <p className="text-xs text-[var(--ink-muted)]">
                        {achieved
                          ? isPercentScheme(s)
                            ? locale === "hi"
                              ? `${currentRate}% × बिक्री ₹${(user?.schemeValueProgress?.[s.id] ?? 0).toFixed(0)}`
                              : `${currentRate}% of sales ₹${(user?.schemeValueProgress?.[s.id] ?? 0).toFixed(0)}`
                            : locale === "hi"
                              ? `${progress.toFixed(0)} ${unit} × ₹${currentRate}/${unit}`
                              : `${progress.toFixed(0)} ${unit} × ₹${currentRate}/${unit}`
                          : locale === "hi"
                            ? "अभी कोई टियर अनलॉक नहीं"
                            : "no tier unlocked yet"}
                      </p>
                      {aboveTop ? (
                        <p className="text-xs font-semibold text-[var(--ok)]">
                          {isPercentScheme(s)
                            ? locale === "hi"
                              ? `टॉप टियर पार — बिक्री पर ${topRate}%`
                              : `Above top tier — ${topRate}% of sales`
                            : locale === "hi"
                              ? `टॉप टियर पार — पूरा लिफ्ट × ₹${topRate}/${unit}`
                              : `Above top tier — full lift × ₹${topRate}/${unit}`}
                        </p>
                      ) : null}
                      {live && nextTier ? (
                        <p className="text-xs text-[var(--ink-muted)]">
                          {isPercentScheme(s)
                            ? locale === "hi"
                              ? `${nextTier.remaining.toFixed(0)} ${unit} और → ${nextTier.rate}%`
                              : `${nextTier.remaining.toFixed(0)} ${unit} more → ${nextTier.rate}%`
                            : locale === "hi"
                              ? `${nextTier.remaining.toFixed(0)} ${unit} और → ₹${nextTier.rate}/${unit}`
                              : `${nextTier.remaining.toFixed(0)} ${unit} more → ₹${nextTier.rate}/${unit}`}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  )}

                  {/* Progress bar ------------------------------ */}
                  {!isOrderDiscountScheme(s) ? (
                  <div>
                    <div className="mb-1 flex justify-between text-xs text-[var(--ink-muted)]">
                      <span>
                        {locale === "hi" ? "लिफ्ट किया" : "Lifted"}
                      </span>
                      <span className="tabular-nums">
                        {progress.toFixed(0)} {unit}
                        {aboveTop
                          ? ` · +${(progress - topTarget).toFixed(0)}`
                          : ` / ${topTarget} ${unit}`}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div
                        className="h-full rounded-full bg-[var(--brand)] transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  ) : null}

                  {/* Meta grid --------------------------------- */}
                  <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                    <Fact
                      label={locale === "hi" ? "शुरू" : "Started"}
                      value={new Date(s.startDate).toLocaleDateString(
                        locale === "hi" ? "hi-IN" : "en-IN",
                        { day: "2-digit", month: "short" }
                      )}
                      hint={
                        locale === "hi"
                          ? `${startedAgoDays} दिन पहले`
                          : `${startedAgoDays}d ago`
                      }
                    />
                    <Fact
                      label={locale === "hi" ? "समाप्त" : "Ends"}
                      value={new Date(s.endDate).toLocaleDateString(
                        locale === "hi" ? "hi-IN" : "en-IN",
                        { day: "2-digit", month: "short" }
                      )}
                      hint={
                        locale === "hi"
                          ? `${daysLeft} दिन बचे`
                          : `${daysLeft}d left`
                      }
                      tone={endingSoon ? "warn" : undefined}
                    />
                    {isOrderDiscountScheme(s) ? (
                      <>
                        <Fact
                          label={locale === "hi" ? "प्रकार" : "Type"}
                          value={
                            s.rewardType === "order_percent"
                              ? locale === "hi"
                                ? "% छूट"
                                : "% off"
                              : locale === "hi"
                                ? "₹ छूट"
                                : "₹ off"
                          }
                          hint={t("schemes.orderDiscount")}
                        />
                        <Fact
                          label={locale === "hi" ? "टॉप टियर" : "Top tier"}
                          value={
                            s.rewardType === "order_percent"
                              ? `${topRate}%`
                              : formatInr(topRate, locale)
                          }
                          hint={`${topTarget} ${unit}+`}
                          tone="ok"
                        />
                      </>
                    ) : (
                      <>
                    <Fact
                      label={locale === "hi" ? "योगदान" : "Contributions"}
                      value={String(contributions.length)}
                      hint={
                        locale === "hi" ? "बिल हो चुके ऑर्डर" : "billed orders"
                      }
                    />
                    <Fact
                      label={locale === "hi" ? "डिस्काउंट रेट" : "Discount rate"}
                      value={
                        achieved
                          ? isPercentScheme(s)
                            ? `${currentRate}%`
                            : `₹${currentRate}/${unit}`
                          : "—"
                      }
                      hint={
                        achieved
                          ? schemeLevelLabel(achieved, locale)
                          : locale === "hi"
                            ? "टियर बाकी"
                            : "no tier yet"
                      }
                      tone={achieved ? "ok" : undefined}
                    />
                      </>
                    )}
                  </div>

                  {/* Tier ladder ------------------------------ */}
                  {!isOrderDiscountScheme(s) ? (
                  <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                      {locale === "hi" ? "टियर लैडर" : "Tier ladder"}
                    </p>
                    <ol className="tt-tier-ladder">
                      {statuses.map((x) => {
                        const isCurrent =
                          achieved?.id === x.level.id && x.unlocked;
                        return (
                          <li
                            key={x.level.id}
                            className={`tt-tier-step ${
                              isCurrent
                                ? "tt-tier-step-current"
                                : x.unlocked
                                  ? "tt-tier-step-passed"
                                  : "tt-tier-step-locked"
                            }`}
                          >
                            <div className="tt-tier-step-dot" aria-hidden>
                              {x.unlocked ? "✓" : ""}
                            </div>
                            <div className="tt-tier-step-body">
                              <p className="tt-tier-step-title">
                                {schemeLevelLabel(x.level, locale)}
                              </p>
                              <p className="tt-tier-step-meta">
                                {x.level.targetAmount} {unit}+
                              </p>
                              <p className="tt-tier-step-rate">
                                {isPercentScheme(s)
                                  ? `${x.rate}%`
                                  : `₹${x.rate}/${unit}`}
                              </p>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                    <p className="mt-2 text-[11px] text-[var(--ink-muted)]">
                      {isPercentScheme(s)
                        ? locale === "hi"
                          ? "टियर लिफ्ट से अनलॉक होता है; % स्कीम बिक्री पर लागू। केवल सबसे ऊँचा अनलॉक टियर।"
                          : "Tiers unlock by lift; % applies to scheme sales. Only the highest unlocked tier counts."
                        : locale === "hi"
                          ? "हर टियर का रेट पूरे लिफ्ट पर लागू होता है — केवल सबसे ऊँचा अनलॉक टियर गिना जाता है।"
                          : "Each tier's rate applies to your full lift — only the highest unlocked tier counts."}
                    </p>
                  </div>
                  ) : null}

                  {/* Footer actions --------------------------- */}
                  <div className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] pt-4 text-sm">
                    {!isOrderDiscountScheme(s) ? (
                    <button
                      type="button"
                      className="font-semibold text-[var(--brand)] hover:underline"
                      onClick={() =>
                        setOpenTx(openTx === s.id ? null : s.id)
                      }
                    >
                      {openTx === s.id
                        ? locale === "hi"
                          ? "ट्रांज़ैक्शन छुपाएँ"
                          : "Hide transactions"
                        : locale === "hi"
                          ? `ट्रांज़ैक्शन (${contributions.length})`
                          : `Transactions (${contributions.length})`}
                    </button>
                    ) : null}
                    <button
                      type="button"
                      className="font-semibold text-[var(--brand)] hover:underline"
                      onClick={() =>
                        setOpenTerms(openTerms === s.id ? null : s.id)
                      }
                    >
                      {openTerms === s.id
                        ? locale === "hi"
                          ? "नियम छुपाएँ"
                          : "Hide terms"
                        : locale === "hi"
                          ? "नियम और शर्तें"
                          : "Terms & conditions"}
                    </button>
                    <span className="ml-auto text-xs text-[var(--ink-muted)]">
                      {formatSchemeDuration(s, locale)}
                    </span>
                  </div>

                  {openTx === s.id ? (
                    <div className="overflow-hidden rounded-xl border border-[var(--line)]">
                      {contributions.length ? (
                        <ul className="divide-y divide-[var(--line)] text-sm">
                          {contributions.map((c) => (
                            <li
                              key={c.orderId}
                              className="flex items-center justify-between gap-3 px-3 py-2.5"
                            >
                              <Link
                                href={`/orders/${c.orderId}`}
                                className={`font-semibold ${
                                  c.cancelled
                                    ? "text-[var(--ink-muted)] line-through"
                                    : "text-[var(--brand-deep,var(--brand))]"
                                }`}
                              >
                                {c.orderNumber}
                              </Link>
                              <span
                                className={
                                  c.cancelled
                                    ? "text-[var(--ink-muted)] line-through"
                                    : "font-semibold tabular-nums"
                                }
                              >
                                +{c.amount.toFixed(0)} {unit}
                              </span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="px-3 py-4 text-sm text-[var(--ink-muted)]">
                          {locale === "hi"
                            ? "अभी कोई बिल असली वजन नहीं।"
                            : "No billed actual weight yet."}
                        </p>
                      )}
                    </div>
                  ) : null}

                  {openTerms === s.id ? (
                    <div className="rounded-xl bg-[var(--surface)] p-3 text-sm text-[var(--ink-muted)] whitespace-pre-wrap">
                      {s.termsAndConditions?.[locale] ||
                        s.termsAndConditions?.en ||
                        "—"}
                    </div>
                  ) : null}

                  {/* Info hint about the one-time payout */}
                  {live ? (
                    <p className="text-[11px] text-[var(--ink-muted)]">
                      {locale === "hi"
                        ? "स्कीम समाप्ति के बाद एक ही बार वॉलेट में क्रेडिट लगेगा।"
                        : "Wallet credit will post once after the scheme ends."}
                    </p>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        {!visible.length ? (
          <p className="tt-panel p-8 text-center text-[var(--ink-muted)]">
            {schemes.length
              ? locale === "hi"
                ? "इस फ़िल्टर के लिए कोई स्कीम नहीं।"
                : "No schemes match this filter."
              : t("common.empty")}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function SummaryTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "brand" | "ok" | "warn" | "muted";
}) {
  const valueClass =
    tone === "brand"
      ? "text-[var(--brand-deep,var(--brand))]"
      : tone === "ok"
        ? "text-[var(--ok)]"
        : tone === "warn"
          ? "text-[var(--danger)]"
          : "text-[var(--ink)]";
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        {label}
      </p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueClass}`}>
        {value}
      </p>
    </div>
  );
}

function Fact({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn";
}) {
  const valueColor =
    tone === "ok"
      ? "text-[var(--ok)]"
      : tone === "warn"
        ? "text-[var(--danger)]"
        : "text-[var(--ink)]";
  return (
    <div className="rounded-lg border border-[var(--line)] bg-white p-2.5">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {label}
      </p>
      <p className={`mt-0.5 text-sm font-semibold tabular-nums ${valueColor}`}>
        {value}
      </p>
      {hint ? (
        <p className="text-[10px] text-[var(--ink-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

function ProgressRing({
  pct,
  centerLabel,
  size = 96,
  stroke = 10,
}: {
  pct: number;
  centerLabel: string;
  size?: number;
  stroke?: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const dash = (clamped / 100) * circumference;
  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--surface-2)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circumference}`}
          className="transition-[stroke-dasharray] duration-500"
        />
      </svg>
      <span className="absolute text-sm font-bold tabular-nums text-[var(--brand-deep,var(--brand))]">
        {centerLabel}
      </span>
    </div>
  );
}
