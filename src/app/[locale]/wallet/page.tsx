"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { PaymentInstructions } from "@/components/PaymentInstructions";
import { FilePick } from "@/components/FilePick";
import { NumberField } from "@/components/NumberField";
import { useDb, useSession, retryCloudCatalog } from "@/lib/hooks";
import { dealerOpenBilledOrders } from "@/lib/dealer-statement";
import { formatInr } from "@/lib/pricing";
import { getProofItems } from "@/lib/proofs";
import {
  dealerHasScheme,
  daysUntilSchemeEnd,
  estimateSchemePayout,
  getAchievedTier,
  getSchemeLevels,
  isSchemeEndingSoon,
  isSchemeVisibleToDealer,
  schemeTierRate,
  schemeUnitLabel,
} from "@/lib/schemes";
import {
  cancelWalletDeposit,
  createWalletDeposit,
  uploadWalletDepositProof,
} from "@/lib/store/db";
import { uploadMediaFile } from "@/lib/upload-media";
import type {
  PaymentProofItem,
  WalletDeposit,
  WalletTransaction,
} from "@/lib/types";

type LedgerRow = WalletTransaction & { runningBalance: number };
type LedgerFilter = "all" | "credit" | "debit";

export default function WalletPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh, cloudReady } = useDb();
  const [filter, setFilter] = useState<LedgerFilter>("all");
  const [q, setQ] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositNote, setDepositNote] = useState("");
  const [proofFiles, setProofFiles] = useState<File[]>([]);
  const [proofNote, setProofNote] = useState("");
  const [depositBusy, setDepositBusy] = useState(false);
  const [depositMsg, setDepositMsg] = useState("");

  const user = db?.users.find((u) => u.id === session?.id);

  useEffect(() => {
    if (!session || user || !cloudReady) return;
    void retryCloudCatalog().then(() => refresh());
  }, [session, user, cloudReady, refresh]);

  const myDeposits = useMemo(() => {
    if (!db || !session) return [] as WalletDeposit[];
    return (db.walletDeposits ?? [])
      .filter((d) => d.userId === session.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [db, session]);

  const openDeposit = useMemo(
    () =>
      myDeposits.find(
        (d) => d.status === "awaiting_proof" || d.status === "pending_verify"
      ) ?? null,
    [myDeposits]
  );

  const tx = useMemo<WalletTransaction[]>(() => {
    if (!db || !session) return [];
    return db.walletTransactions
      .filter((x) => x.userId === session.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [db, session]);

  const schemes = useMemo(() => {
    if (!db || !user) return [];
    return db.schemes.filter(
      (s) =>
        dealerHasScheme(s, user.assignedSchemeIds || []) &&
        isSchemeVisibleToDealer(s)
    );
  }, [db, user]);

  // Running balance is computed oldest-first, then reversed for display.
  const rowsWithBalance = useMemo<LedgerRow[]>(() => {
    const out: LedgerRow[] = [];
    let bal = 0;
    for (let i = tx.length - 1; i >= 0; i--) {
      const t = tx[i];
      bal =
        Math.round((bal + (t.type === "credit" ? t.amount : -t.amount)) * 100) /
        100;
      out.push({ ...t, runningBalance: bal });
    }
    return out.reverse();
  }, [tx]);

  const filteredRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rowsWithBalance.filter((r) => {
      if (filter !== "all" && r.type !== filter) return false;
      if (!term) return true;
      return r.reason.toLowerCase().includes(term);
    });
  }, [rowsWithBalance, filter, q]);

  const stats = useMemo(() => {
    let creditCount = 0;
    let debitCount = 0;
    for (const t of tx) {
      if (t.type === "credit") creditCount += 1;
      else debitCount += 1;
    }
    return { creditCount, debitCount };
  }, [tx]);

  const pendingPayout = useMemo(() => {
    if (!user || !db) return 0;
    let total = 0;
    for (const s of db.schemes) {
      if (!dealerHasScheme(s, user.assignedSchemeIds || [])) continue;
      if (!isSchemeVisibleToDealer(s)) continue;
      total += estimateSchemePayout(
        s,
        user.schemeProgress?.[s.id] ?? 0,
        user.schemeValueProgress?.[s.id] ?? 0
      );
    }
    return Math.round(total * 100) / 100;
  }, [db, user]);

  const linkedParty = useMemo(
    () =>
      session && db
        ? db.parties.find((p) => p.linkedUserId === session.id)
        : undefined,
    [db, session]
  );

  const openBilled = useMemo(
    () =>
      session && db
        ? dealerOpenBilledOrders(db.orders, session.id).slice(0, 6)
        : [],
    [db, session]
  );

  const statementReceipts = linkedParty?.statementReceipts ?? [];
  const outstanding =
    linkedParty?.statementOutstanding != null
      ? linkedParty.statementOutstanding
      : 0;
  const showStatement =
    !!session &&
    (!!linkedParty || openBilled.length > 0 || statementReceipts.length > 0);

  const onStartDeposit = (e: FormEvent) => {
    e.preventDefault();
    if (!session) return;
    setDepositMsg("");
    try {
      createWalletDeposit({
        userId: session.id,
        amount: Number(depositAmount),
        note: depositNote.trim() || undefined,
      });
      setDepositAmount("");
      setDepositNote("");
      setDepositMsg(
        locale === "hi"
          ? "राशि सेट — नीचे QR से पेमेंट करें, फिर प्रूफ अपलोड करें"
          : "Amount set — pay via QR below, then upload proof"
      );
      refresh();
    } catch (err) {
      setDepositMsg(err instanceof Error ? err.message : "Failed");
    }
  };

  const onUploadDepositProof = async (e: FormEvent) => {
    e.preventDefault();
    if (!session || !openDeposit) return;
    if (!proofFiles.length) {
      setDepositMsg(
        locale === "hi" ? "कम से कम एक फ़ाइल चुनें" : "Choose at least one file"
      );
      return;
    }
    setDepositBusy(true);
    setDepositMsg("");
    try {
      const items: PaymentProofItem[] = [];
      const errors: string[] = [];
      for (const file of proofFiles) {
        try {
          const up = await uploadMediaFile(file, "proofs");
          if (up.type === "video") throw new Error("Videos not allowed");
          if (!up.url || up.url.startsWith("data:")) {
            throw new Error(
              locale === "hi"
                ? "अपलोड फेल — JPG/PNG आज़माएँ"
                : "Upload failed — try JPG/PNG"
            );
          }
          items.push({
            id: `pp_${crypto.randomUUID()}`,
            url: up.url,
            type: up.type === "pdf" ? "pdf" : "image",
            fileName: file.name,
            note: proofNote.trim() || undefined,
            amount: openDeposit.amount,
            uploadedAt: new Date().toISOString(),
            uploadedBy: session.id,
          });
        } catch (err) {
          errors.push(
            `${file.name}: ${err instanceof Error ? err.message : "failed"}`
          );
        }
      }
      if (!items.length) {
        setDepositMsg(errors.join(" · ") || "Upload failed");
        return;
      }
      uploadWalletDepositProof(openDeposit.id, items, session.id);
      setProofFiles([]);
      setProofNote("");
      setDepositMsg(
        locale === "hi"
          ? "प्रूफ भेज दिया — एडमिन वेरिफाई के बाद वॉलेट में जमा होगा"
          : "Proof sent — wallet credits after admin verifies"
      );
      refresh();
      if (errors.length) setDepositMsg(errors.join(" · "));
    } finally {
      setDepositBusy(false);
    }
  };

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

  const grouped = groupByMonth(filteredRows, locale);

  return (
    <section className="tt-section">
      <div className="tt-wrap space-y-6">
        {/* --- Hero: available credit ---------------------------------- */}
        <div className="tt-wallet-hero">
          <div className="tt-wallet-hero-copy">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-white/70">
              {t("shop.walletTitle")}
            </p>
            <p className="mt-2 text-sm text-white/80">
              {t("shop.walletCredit")}
            </p>
            <p className="mt-1 text-4xl font-bold tabular-nums sm:text-5xl">
              {formatInr(user?.walletBalance ?? 0, locale)}
            </p>
            <p className="mt-3 max-w-md text-sm text-white/80">
              {t("shop.walletHint")}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <a
                href="#wallet-deposit"
                className="tt-btn border border-white/40 bg-white/10 text-white hover:bg-white/20"
              >
                {t("shop.walletDeposit")}
              </a>
              <Link
                href="/quick-order"
                className="tt-btn border border-white/40 bg-white/10 text-white hover:bg-white/20"
              >
                {t("nav.quickOrder")}
              </Link>
              <Link
                href="/schemes"
                className="tt-btn border border-white/40 bg-white/10 text-white hover:bg-white/20"
              >
                {t("nav.schemes")}
              </Link>
            </div>
          </div>
          <div className="tt-wallet-hero-side">
            <div className="tt-wallet-hero-mini">
              <span className="tt-wallet-hero-mini-label">
                {locale === "hi" ? "कुल लिफ्ट" : "Total lifted"}
              </span>
              <span className="tt-wallet-hero-mini-value">
                {(user?.liftingProgressKg ?? 0).toLocaleString(
                  locale === "hi" ? "hi-IN" : "en-IN"
                )}
                <span className="tt-wallet-hero-mini-unit">
                  {t("common.kg")}
                </span>
              </span>
            </div>
            <div className="tt-wallet-hero-mini">
              <span className="tt-wallet-hero-mini-label">
                {locale === "hi" ? "अनुमानित पेंडिंग" : "Pending payout"}
              </span>
              <span className="tt-wallet-hero-mini-value">
                {formatInr(pendingPayout, locale)}
              </span>
              <span className="tt-wallet-hero-mini-hint">
                {locale === "hi"
                  ? "स्कीम समाप्ति पर एक बार"
                  : "credits once schemes end"}
              </span>
            </div>
          </div>
        </div>

        {showStatement ? (
          <div className="tt-panel p-5">
            <h2 className="text-lg font-semibold text-[var(--brand-deep)]">
              {t("shop.outstandingTitle")}
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {t("shop.outstandingHint")}
            </p>
            <p className="mt-3 text-3xl font-bold tabular-nums">
              {outstanding > 0.05
                ? formatInr(outstanding, locale)
                : t("shop.outstandingNone")}
            </p>
            {openBilled.length ? (
              <div className="mt-4">
                <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                  {t("shop.openBills")}
                </p>
                <ul className="mt-2 space-y-1 text-sm">
                  {openBilled.map((o) => (
                    <li key={o.id}>
                      <Link
                        href={`/orders/${o.id}`}
                        className="font-mono text-[var(--brand)]"
                      >
                        {o.orderNumber}
                      </Link>
                      <span className="text-[var(--ink-muted)]">
                        {" "}
                        · {formatInr(o.actualBillAmount || o.estimatedTotal, locale)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="mt-4">
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                {t("shop.recentPayments")}
              </p>
              {statementReceipts.length ? (
                <ul className="mt-2 space-y-1 text-sm">
                  {statementReceipts.map((r) => (
                    <li key={`${r.number}-${r.date}`}>
                      <span className="tabular-nums">{r.date}</span>
                      {" · "}
                      {r.number}
                      {" · "}
                      {formatInr(r.amount, locale)}
                      {r.linkedOrderId ? (
                        <>
                          {" · "}
                          <Link
                            href={`/orders/${r.linkedOrderId}`}
                            className="text-[var(--brand)]"
                          >
                            {locale === "hi" ? "ऑर्डर" : "Order"}
                          </Link>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-[var(--ink-muted)]">
                  {t("shop.noRecentPayments")}
                </p>
              )}
            </div>
          </div>
        ) : null}

        {/* --- Advance deposit ---------------------------------------- */}
        <div
          id="wallet-deposit"
          className="tt-panel space-y-4 border-2 border-[var(--brand)]/30 p-5"
        >
          <div>
            <h2 className="text-lg font-semibold text-[var(--brand-deep)]">
              {locale === "hi"
                ? "वॉलेट में अग्रिम जमा"
                : "Deposit advance to wallet"}
            </h2>
            <p className="mt-1 text-sm text-[var(--ink-muted)]">
              {locale === "hi"
                ? "1) राशि डालें → 2) QR से पेमेंट → 3) स्क्रीनशॉट अपलोड → 4) एडमिन वेरिफाई"
                : "1) Enter amount → 2) Pay via QR → 3) Upload screenshot → 4) Admin verifies"}
            </p>
          </div>

          {depositMsg ? (
            <p className="rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-sm text-[var(--brand-deep)]">
              {depositMsg}
            </p>
          ) : null}

          {!openDeposit ? (
            <form
              onSubmit={onStartDeposit}
              className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]"
            >
              <div>
                <label className="tt-label">
                  {locale === "hi" ? "राशि ₹ *" : "Amount ₹ *"}
                </label>
                <NumberField
                  emptyAs={null}
                  min={1}
                  step="1"
                  className="tt-input"
                  required
                  value={depositAmount}
                  onValueChange={(v) =>
                    setDepositAmount(v === "" ? "" : String(v))
                  }
                  placeholder="5000"
                />
              </div>
              <div>
                <label className="tt-label">
                  {locale === "hi" ? "नोट (वैकल्पिक)" : "Note (optional)"}
                </label>
                <input
                  type="text"
                  className="tt-input"
                  value={depositNote}
                  onChange={(e) => setDepositNote(e.target.value)}
                  placeholder={
                    locale === "hi" ? "अग्रिम / टॉप-अप" : "Advance / top-up"
                  }
                />
              </div>
              <div className="flex items-end">
                <button type="submit" className="tt-btn tt-btn-dark w-full">
                  {locale === "hi" ? "QR दिखाएँ" : "Show QR"}
                </button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-[var(--surface)] px-3 py-2 text-sm">
                <div>
                  <span className="font-semibold">
                    {openDeposit.depositNumber}
                  </span>
                  <span className="mx-2 text-[var(--ink-muted)]">·</span>
                  <span className="font-bold tabular-nums text-[var(--brand-deep)]">
                    {formatInr(openDeposit.amount, locale)}
                  </span>
                  <span className="ml-2 text-xs font-semibold uppercase text-[var(--ink-muted)]">
                    {openDeposit.status === "pending_verify"
                      ? locale === "hi"
                        ? "वेरिफिकेशन बाकी"
                        : "Awaiting verification"
                      : locale === "hi"
                        ? "पेमेंट करें"
                        : "Pay now"}
                  </span>
                </div>
                {openDeposit.status === "awaiting_proof" ? (
                  <button
                    type="button"
                    className="text-xs font-semibold text-[var(--danger)] underline"
                    onClick={() => {
                      if (
                        !confirm(
                          locale === "hi"
                            ? "यह जमा रद्द करें?"
                            : "Cancel this deposit?"
                        )
                      )
                        return;
                      try {
                        cancelWalletDeposit(openDeposit.id, session.id);
                        setDepositMsg(
                          locale === "hi" ? "रद्द हो गया" : "Cancelled"
                        );
                        refresh();
                      } catch (err) {
                        setDepositMsg(
                          err instanceof Error ? err.message : "Failed"
                        );
                      }
                    }}
                  >
                    {locale === "hi" ? "रद्द करें" : "Cancel"}
                  </button>
                ) : null}
              </div>

              {db?.settings ? (
                <PaymentInstructions
                  settings={db.settings}
                  amount={openDeposit.amount}
                  remainingBalance={openDeposit.amount}
                  orderNumber={openDeposit.depositNumber}
                  payRef={`${openDeposit.depositNumber}-P1`}
                  locale={locale}
                />
              ) : null}

              {openDeposit.status === "pending_verify" ? (
                <p className="rounded-lg border border-[var(--ok)]/40 bg-[var(--ok)]/10 px-3 py-2 text-sm text-[var(--ok)]">
                  {locale === "hi"
                    ? "प्रूफ मिल गया — एडमिन वेरिफाई के बाद बैलेंस अपडेट होगा।"
                    : "Proof received — balance updates after admin verifies."}
                </p>
              ) : (
                <form onSubmit={onUploadDepositProof} className="space-y-3">
                  <FilePick
                    kind="photoOrPdf"
                    multiple
                    value={proofFiles}
                    onChange={setProofFiles}
                    label={
                      locale === "hi"
                        ? "पेमेंट के बाद प्रूफ अपलोड करें"
                        : "Upload proof after paying"
                    }
                  />
                  <input
                    type="text"
                    className="tt-input"
                    placeholder={
                      locale === "hi"
                        ? "UPI ref / नोट (वैकल्पिक)"
                        : "UPI ref / note (optional)"
                    }
                    value={proofNote}
                    onChange={(e) => setProofNote(e.target.value)}
                  />
                  <button
                    type="submit"
                    disabled={depositBusy || !proofFiles.length}
                    className="tt-btn tt-btn-dark w-full disabled:opacity-60"
                  >
                    {depositBusy
                      ? locale === "hi"
                        ? "अपलोड…"
                        : "Uploading…"
                      : locale === "hi"
                        ? "प्रूफ भेजें"
                        : "Submit proof"}
                  </button>
                </form>
              )}

              {getProofItems(openDeposit.proof).length ? (
                <ul className="space-y-2">
                  {getProofItems(openDeposit.proof).map((it) => (
                    <li
                      key={it.id}
                      className="flex items-center gap-3 rounded-lg border border-[var(--line)] p-2 text-sm"
                    >
                      {it.type === "image" ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={it.url}
                          alt=""
                          className="h-12 w-12 rounded object-cover"
                        />
                      ) : (
                        <span className="text-xs font-bold">PDF</span>
                      )}
                      <a
                        href={it.url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-semibold text-[var(--brand)] underline"
                      >
                        {it.fileName || (locale === "hi" ? "देखें" : "View")}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>

        {/* --- Stat cards --------------------------------------------- */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            label={locale === "hi" ? "चालू स्कीम" : "Active schemes"}
            value={String(schemes.length)}
            hint={
              locale === "hi"
                ? "अभी दे रहे रिवॉर्ड"
                : "currently rewarding"
            }
          />
          <StatCard
            label={locale === "hi" ? "आज तक लिफ्ट" : "Actual lifting"}
            value={`${(user?.liftingProgressKg ?? 0).toLocaleString(
              locale === "hi" ? "hi-IN" : "en-IN"
            )} ${t("common.kg")}`}
            hint={
              locale === "hi"
                ? "केवल बिल हुआ वजन"
                : "billed weight only"
            }
          />
        </div>

        {/* --- Active scheme snapshot --------------------------------- */}
        {schemes.length ? (
          <div className="tt-panel p-5">
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="text-base font-semibold text-[var(--ink)]">
                  {locale === "hi"
                    ? "सक्रिय स्कीम स्नैपशॉट"
                    : "Active scheme snapshot"}
                </h2>
                <p className="text-xs text-[var(--ink-muted)]">
                  {locale === "hi"
                    ? "सबसे ऊँचा टियर रेट पूरे लिफ्ट पर लागू होगा।"
                    : "Highest tier rate applies to your full lift."}
                </p>
              </div>
              <Link
                href="/schemes"
                className="text-sm font-semibold text-[var(--brand)] hover:underline"
              >
                {locale === "hi" ? "सभी देखें" : "View all"} →
              </Link>
            </div>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {schemes.slice(0, 4).map((s) => {
                const progress = user?.schemeProgress?.[s.id] ?? 0;
                const levels = getSchemeLevels(s);
                const topTarget =
                  levels[levels.length - 1]?.targetAmount ||
                  s.targetWeightKg ||
                  1;
                const pct = Math.min(100, (progress / topTarget) * 100);
                const est = estimateSchemePayout(
                  s,
                  progress,
                  user?.schemeValueProgress?.[s.id] ?? 0
                );
                const achieved = getAchievedTier(s, progress);
                const unit = schemeUnitLabel(s, locale);
                return (
                  <li
                    key={s.id}
                    className="rounded-xl border border-[var(--line)] bg-white p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-[var(--ink)]">
                        {s.name[locale]}
                      </p>
                      <span
                        className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          isSchemeEndingSoon(s)
                            ? "bg-amber-100 text-amber-900"
                            : "bg-[var(--brand-soft)] text-[var(--brand-deep,var(--brand))]"
                        }`}
                      >
                        {isSchemeEndingSoon(s)
                          ? locale === "hi"
                            ? `${daysUntilSchemeEnd(s)} दिन बाकी`
                            : `${daysUntilSchemeEnd(s)}d left`
                          : locale === "hi"
                            ? "चालू"
                            : "Live"}
                      </span>
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[var(--surface-2)]">
                      <div
                        className="h-full bg-[var(--brand)]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-xs text-[var(--ink-muted)]">
                      <span className="tabular-nums">
                        {progress.toFixed(0)} / {topTarget} {unit}
                      </span>
                      <span className="font-semibold text-[var(--brand-deep,var(--brand))]">
                        {achieved
                          ? `₹${schemeTierRate(s, achieved)}/${unit}`
                          : locale === "hi"
                            ? "टियर बाकी"
                            : "no tier yet"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-semibold text-[var(--ok)]">
                      {locale === "hi" ? "अनुमान:" : "Estimate:"}{" "}
                      {formatInr(est, locale)}
                    </p>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {/* --- Ledger ------------------------------------------------ */}
        <div className="tt-panel p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-[var(--ink)]">
                {locale === "hi" ? "लेजर" : "Wallet ledger"}
              </h2>
              <p className="text-xs text-[var(--ink-muted)]">
                {locale === "hi"
                  ? "सभी क्रेडिट और डेबिट, चलती बैलेंस के साथ।"
                  : "Every credit and debit with a running balance."}
              </p>
            </div>
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={locale === "hi" ? "खोजें…" : "Search reason…"}
              className="tt-input max-w-xs"
            />
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {(["all", "credit", "debit"] as LedgerFilter[]).map((f) => {
              const isActive = filter === f;
              const count =
                f === "all"
                  ? tx.length
                  : f === "credit"
                    ? stats.creditCount
                    : stats.debitCount;
              const label =
                f === "all"
                  ? locale === "hi"
                    ? "सभी"
                    : "All"
                  : f === "credit"
                    ? locale === "hi"
                      ? "क्रेडिट"
                      : "Credits"
                    : locale === "hi"
                      ? "डेबिट"
                      : "Debits";
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`tt-chip ${
                    isActive ? "tt-chip-active" : ""
                  } ${
                    f === "credit"
                      ? "tt-chip-ok"
                      : f === "debit"
                        ? "tt-chip-danger"
                        : ""
                  }`}
                >
                  {label}
                  <span className="tt-chip-count">{count}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-4 space-y-5">
            {grouped.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--line)] px-4 py-8 text-center text-sm text-[var(--ink-muted)]">
                {locale === "hi"
                  ? tx.length
                    ? "इस फ़िल्टर के लिए कोई एंट्री नहीं।"
                    : "अभी कोई ट्रांज़ैक्शन नहीं।"
                  : tx.length
                    ? "No entries for this filter."
                    : "No transactions yet."}
              </p>
            ) : null}
            {grouped.map((group) => (
              <div key={group.key}>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wider text-[var(--ink-muted)]">
                  {group.label}
                </h3>
                <ul className="divide-y divide-[var(--line)] rounded-xl border border-[var(--line)] bg-white">
                  {group.rows.map((r) => (
                    <li
                      key={r.id}
                      className="flex items-start justify-between gap-3 px-3 py-3 sm:px-4"
                    >
                      <div className="flex min-w-0 items-start gap-3">
                        <span
                          className={`tt-ledger-icon ${
                            r.type === "credit"
                              ? "tt-ledger-icon-ok"
                              : "tt-ledger-icon-danger"
                          }`}
                          aria-hidden
                        >
                          {r.type === "credit" ? "↑" : "↓"}
                        </span>
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium text-[var(--ink)]">
                            {r.reason}
                          </p>
                          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
                            {new Date(r.createdAt).toLocaleString(
                              locale === "hi" ? "hi-IN" : "en-IN",
                              {
                                day: "2-digit",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              }
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p
                          className={`font-bold tabular-nums ${
                            r.type === "credit"
                              ? "text-[var(--ok)]"
                              : "text-[var(--danger)]"
                          }`}
                        >
                          {r.type === "credit" ? "+" : "−"}
                          {formatInr(r.amount, locale)}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[var(--ink-muted)] tabular-nums">
                          {locale === "hi" ? "शेष" : "Balance"}:{" "}
                          {formatInr(r.runningBalance, locale)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "danger";
}) {
  const color =
    tone === "ok"
      ? "text-[var(--ok)]"
      : tone === "danger"
        ? "text-[var(--danger)]"
        : "text-[var(--ink)]";
  return (
    <div className="rounded-xl border border-[var(--line)] bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ink-muted)]">
        {label}
      </p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${color}`}>{value}</p>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-[var(--ink-muted)]">{hint}</p>
      ) : null}
    </div>
  );
}

function groupByMonth(
  rows: LedgerRow[],
  locale: "en" | "hi"
): { key: string; label: string; rows: LedgerRow[] }[] {
  const map = new Map<string, { label: string; rows: LedgerRow[] }>();
  for (const r of rows) {
    const d = new Date(r.createdAt);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    const label = d.toLocaleString(locale === "hi" ? "hi-IN" : "en-IN", {
      month: "long",
      year: "numeric",
    });
    const bucket = map.get(key) ?? { label, rows: [] };
    bucket.rows.push(r);
    map.set(key, bucket);
  }
  return Array.from(map.entries()).map(([key, v]) => ({ key, ...v }));
}
