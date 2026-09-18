"use client";

import { FormEvent, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { TableWrap } from "@/components/admin/TableWrap";
import { AdminShell } from "@/components/AdminShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { NumberField } from "@/components/NumberField";
import { inRange } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { getProofItems } from "@/lib/proofs";
import {
  assignSchemeToUser,
  cancelWalletDeposit,
  creditWallet,
  checkCapability,
  rejectWalletDeposit,
  verifyWalletDeposit,
} from "@/lib/store/db";
import type { WalletDeposit } from "@/lib/types";

export default function AdminWalletsPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { db, refresh } = useDb();
  const { session } = useSession();
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({
    userId: "",
    amount: 500,
    reason: "Wallet deposit",
  });
  const [assign, setAssign] = useState({ userId: "", schemeId: "" });
  const [range, setRange] = useAdminDateRange("today");

  const canWallet = !!session && checkCapability(session, db, "manage_wallet");

  const dealers = useMemo(() => {
    const list = (db?.users ?? []).filter((u) => u.role === "customer");
    if (!q.trim()) return list;
    return list.filter((u) =>
      `${u.name} ${u.phone ?? ""} ${u.email ?? ""} ${u.company ?? ""}`
        .toLowerCase()
        .includes(q.toLowerCase())
    );
  }, [db, q]);

  const ledger = useMemo(() => {
    return [...(db?.walletTransactions ?? [])]
      .filter((tx) => inRange(tx.createdAt, range.from, range.to))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [db, range.from, range.to]);

  const pendingDeposits = useMemo(() => {
    return [...(db?.walletDeposits ?? [])]
      .filter(
        (d) => d.status === "pending_verify" || d.status === "awaiting_proof"
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [db]);

  const applyWallet = (amount: number, reasonFallback: string) => {
    if (!session || !form.userId) return;
    try {
      creditWallet({
        userId: form.userId,
        amount,
        reason: form.reason.trim() || reasonFallback,
        adminId: session.id,
      });
      setMsg(
        amount >= 0
          ? locale === "hi"
            ? `₹${amount} जमा हो गया`
            : `Deposited ₹${amount}`
          : locale === "hi"
            ? `₹${Math.abs(amount)} काटा गया`
            : `Debited ₹${Math.abs(amount)}`
      );
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "Failed");
    }
  };

  const onDeposit = (e: FormEvent) => {
    e.preventDefault();
    const amount = Math.abs(Number(form.amount) || 0);
    if (amount <= 0) {
      setMsg(locale === "hi" ? "जमा राशि डालें" : "Enter a deposit amount");
      return;
    }
    applyWallet(amount, "Wallet deposit");
  };

  const onWithdraw = (e: FormEvent) => {
    e.preventDefault();
    const amount = Math.abs(Number(form.amount) || 0);
    if (amount <= 0) {
      setMsg(locale === "hi" ? "राशि डालें" : "Enter an amount");
      return;
    }
    applyWallet(-amount, "Wallet debit");
  };

  if (!canWallet) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  return (
    <AdminShell>
      <AdminPageHeader
        title={t("admin.wallets")}
        hint={t("admin.walletsHint")}
        actions={
          <input
            className="tt-input max-w-xs"
            placeholder={t("common.search")}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        }
      />

      <DateRangeBar value={range} onChange={setRange} className="mt-4" />

      {msg ? (
        <p className="mt-3 rounded-lg bg-[var(--brand-soft)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {msg}
        </p>
      ) : null}

      {pendingDeposits.length ? (
        <div className="tt-panel mt-5 space-y-4 border-2 border-amber-300/60 p-4">
          <div>
            <h2 className="font-semibold text-amber-950">
              {locale === "hi"
                ? `डीलर जमा वेरिफाई करें (${pendingDeposits.length})`
                : `Verify dealer deposits (${pendingDeposits.length})`}
            </h2>
            <p className="text-xs text-[var(--ink-muted)]">
              {locale === "hi"
                ? "डीलर ने राशि + QR पेमेंट प्रूफ भेजा — वेरिफाई पर वॉलेट क्रेडिट होगा।"
                : "Dealer sent amount + QR payment proof — verify to credit their wallet."}
            </p>
          </div>
          <ul className="space-y-4">
            {pendingDeposits.map((d) => (
              <DepositVerifyCard
                key={d.id}
                deposit={d}
                locale={locale}
                onVerify={() => {
                  if (!session) return;
                  if (
                    !confirm(
                      locale === "hi"
                        ? `${d.userName} को ${formatInr(d.amount, locale)} वॉलेट में जमा करें?`
                        : `Credit ${formatInr(d.amount, locale)} to ${d.userName}'s wallet?`
                    )
                  )
                    return;
                  try {
                    verifyWalletDeposit(d.id, session.id);
                    setMsg(
                      locale === "hi"
                        ? `${d.depositNumber} वेरिफाइड`
                        : `${d.depositNumber} verified`
                    );
                    refresh();
                  } catch (err) {
                    setMsg(err instanceof Error ? err.message : "Failed");
                  }
                }}
                onReject={() => {
                  if (!session) return;
                  const reason =
                    window.prompt(
                      locale === "hi"
                        ? "रिजेक्ट कारण (वैकल्पिक)"
                        : "Reject reason (optional)",
                      ""
                    ) ?? "";
                  if (reason === null) return;
                  try {
                    rejectWalletDeposit(d.id, session.id, reason);
                    setMsg(
                      locale === "hi"
                        ? `${d.depositNumber} रिजेक्ट`
                        : `${d.depositNumber} rejected`
                    );
                    refresh();
                  } catch (err) {
                    setMsg(err instanceof Error ? err.message : "Failed");
                  }
                }}
                onCancel={() => {
                  if (!session) return;
                  if (
                    !confirm(
                      locale === "hi"
                        ? "यह जमा रद्द करें?"
                        : "Cancel this deposit?"
                    )
                  )
                    return;
                  try {
                    cancelWalletDeposit(d.id, session.id);
                    setMsg(
                      locale === "hi"
                        ? `${d.depositNumber} रद्द`
                        : `${d.depositNumber} cancelled`
                    );
                    refresh();
                  } catch (err) {
                    setMsg(err instanceof Error ? err.message : "Failed");
                  }
                }}
              />
            ))}
          </ul>
        </div>
      ) : null}

      <TableWrap className="tt-panel mt-5">
        <table className="tt-table min-w-[800px]">
          <thead>
            <tr>
              <th>Dealer</th>
              <th>Company</th>
              <th>Balance</th>
              <th>Lifting kg</th>
              <th>Schemes</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {dealers.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="font-medium">{u.name}</div>
                  <div className="text-xs text-[var(--ink-muted)]">
                    {u.phone || u.email}
                  </div>
                </td>
                <td>{u.company || "—"}</td>
                <td className="font-semibold tabular-nums text-[var(--brand-deep)]">
                  {formatInr(u.walletBalance, locale)}
                </td>
                <td className="tabular-nums">{u.liftingProgressKg}</td>
                <td className="text-sm text-[var(--ink-muted)]">
                  {u.assignedSchemeIds
                    .map(
                      (id) =>
                        db?.schemes.find((s) => s.id === id)?.name[locale] ?? id
                    )
                    .join(", ") || "—"}
                </td>
                <td>
                  <button
                    type="button"
                    className="text-xs font-semibold text-[var(--ok)] underline underline-offset-2"
                    onClick={() => {
                      setForm((f) => ({
                        ...f,
                        userId: u.id,
                        amount: Math.abs(f.amount) || 500,
                        reason: f.reason || "Wallet deposit",
                      }));
                      document
                        .getElementById("wallet-deposit-form")
                        ?.scrollIntoView({ behavior: "smooth" });
                    }}
                  >
                    {locale === "hi" ? "जमा" : "Deposit"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!dealers.length ? (
          <p className="p-6 text-sm text-[var(--ink-muted)]">{t("common.empty")}</p>
        ) : null}
      </TableWrap>

      {canWallet ? (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <form
            id="wallet-deposit-form"
            onSubmit={onDeposit}
            className="tt-panel space-y-3 p-4"
          >
            <h2 className="font-semibold">
              {locale === "hi" ? "वॉलेट में जमा करें" : "Deposit to wallet"}
            </h2>
            <select
              className="tt-select"
              value={form.userId}
              onChange={(e) => setForm({ ...form, userId: e.target.value })}
              required
            >
              <option value="">
                {locale === "hi" ? "डीलर चुनें" : "Select dealer"}
              </option>
              {(db?.users ?? [])
                .filter((u) => u.role === "customer")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({formatInr(u.walletBalance, locale)})
                  </option>
                ))}
            </select>
            <NumberField
              className="tt-input"
              min={0.01}
              step="0.01"
              emptyAs={null}
              placeholder={locale === "hi" ? "राशि ₹" : "Amount ₹"}
              value={form.amount || ""}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  amount: typeof v === "number" ? v : 0,
                })
              }
              required
            />
            <input
              className="tt-input"
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              placeholder={locale === "hi" ? "कारण / नोट" : "Reason / note"}
            />
            <div className="flex flex-wrap gap-2">
              <button type="submit" className="tt-btn tt-btn-dark">
                {locale === "hi" ? "जमा करें" : "Deposit"}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-outline text-[var(--danger)]"
                onClick={onWithdraw}
              >
                {locale === "hi" ? "काटें" : "Withdraw / debit"}
              </button>
            </div>
          </form>

          <form
            className="tt-panel space-y-3 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              assignSchemeToUser(assign.userId, assign.schemeId);
              setMsg(locale === "hi" ? "स्कीम असाइन हो गई" : "Scheme assigned");
              refresh();
            }}
          >
            <h2 className="font-semibold">
              {locale === "hi" ? "स्कीम असाइन करें" : "Assign scheme"}
            </h2>
            <select
              className="tt-select"
              value={assign.userId}
              onChange={(e) => setAssign({ ...assign, userId: e.target.value })}
              required
            >
              <option value="">
                {locale === "hi" ? "डीलर चुनें" : "Select dealer"}
              </option>
              {(db?.users ?? [])
                .filter((u) => u.role === "customer")
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
            </select>
            <select
              className="tt-select"
              value={assign.schemeId}
              onChange={(e) => setAssign({ ...assign, schemeId: e.target.value })}
              required
            >
              <option value="">
                {locale === "hi" ? "स्कीम चुनें" : "Select scheme"}
              </option>
              {(db?.schemes ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name[locale]}
                </option>
              ))}
            </select>
            <button type="submit" className="tt-btn tt-btn-dark">
              Assign
            </button>
          </form>
        </div>
      ) : null}

      <h2 className="mt-8 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {locale === "hi" ? "वॉलेट लेजर" : "Wallet ledger"}
        <span className="ml-2 font-normal normal-case">
          ({ledger.length})
        </span>
      </h2>
      <TableWrap className="tt-panel mt-3">
        <table className="tt-table min-w-[720px]">
          <thead>
            <tr>
              <th>Date</th>
              <th>Dealer</th>
              <th>Type</th>
              <th>Amount</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {ledger.slice(0, 40).map((tx) => {
              const user = db?.users.find((u) => u.id === tx.userId);
              return (
                <tr key={tx.id}>
                  <td className="text-sm">
                    {new Date(tx.createdAt).toLocaleString(
                      locale === "hi" ? "hi-IN" : "en-IN"
                    )}
                  </td>
                  <td>{user?.name ?? tx.userId}</td>
                  <td className="capitalize">{tx.type}</td>
                  <td
                    className={
                      tx.type === "credit"
                        ? "tabular-nums text-[var(--ok)]"
                        : "tabular-nums text-[var(--danger)]"
                    }
                  >
                    {tx.type === "credit" ? "+" : "-"}
                    {formatInr(tx.amount, locale)}
                  </td>
                  <td className="text-sm">{tx.reason}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!ledger.length ? (
          <p className="p-6 text-sm text-[var(--ink-muted)]">{t("common.empty")}</p>
        ) : null}
      </TableWrap>
    </AdminShell>
  );
}

function DepositVerifyCard({
  deposit,
  locale,
  onVerify,
  onReject,
  onCancel,
}: {
  deposit: WalletDeposit;
  locale: "en" | "hi";
  onVerify: () => void;
  onReject: () => void;
  onCancel: () => void;
}) {
  const items = getProofItems(deposit.proof);
  const ready = deposit.status === "pending_verify" && items.length > 0;
  return (
    <li className="rounded-xl border border-[var(--line)] bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-[var(--ink)]">
            {deposit.userName}{" "}
            <span className="font-mono text-sm text-[var(--ink-muted)]">
              {deposit.userPhone}
            </span>
          </p>
          <p className="mt-0.5 text-sm">
            <span className="font-bold tabular-nums text-[var(--brand-deep)]">
              {formatInr(deposit.amount, locale)}
            </span>
            <span className="mx-2 text-[var(--ink-muted)]">·</span>
            {deposit.depositNumber}
            <span className="ml-2 text-xs uppercase text-[var(--ink-muted)]">
              {deposit.status === "pending_verify"
                ? locale === "hi"
                  ? "प्रूफ मिला"
                  : "proof uploaded"
                : locale === "hi"
                  ? "प्रूफ बाकी"
                  : "awaiting proof"}
            </span>
          </p>
          {deposit.note ? (
            <p className="mt-1 text-xs text-[var(--ink-muted)]">{deposit.note}</p>
          ) : null}
          <p className="mt-1 text-[11px] text-[var(--ink-muted)]">
            {new Date(deposit.createdAt).toLocaleString(
              locale === "hi" ? "hi-IN" : "en-IN"
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {ready ? (
            <button
              type="button"
              className="tt-btn tt-btn-dark px-3 py-1.5 text-xs font-bold"
              onClick={onVerify}
            >
              {locale === "hi" ? "वेरिफाई व जमा" : "Verify & credit"}
            </button>
          ) : null}
          <button
            type="button"
            className="tt-btn tt-btn-outline px-3 py-1.5 text-xs font-bold text-[var(--danger)]"
            onClick={onReject}
          >
            {locale === "hi" ? "रिजेक्ट" : "Reject"}
          </button>
          <button
            type="button"
            className="tt-btn tt-btn-outline px-3 py-1.5 text-xs"
            onClick={onCancel}
          >
            {locale === "hi" ? "रद्द" : "Cancel"}
          </button>
        </div>
      </div>
      {items.length ? (
        <ul className="mt-3 flex flex-wrap gap-2">
          {items.map((it) => (
            <li key={it.id}>
              <a
                href={it.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-lg border border-[var(--line)] p-1.5 text-xs font-semibold text-[var(--brand)]"
              >
                {it.type === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={it.url}
                    alt=""
                    className="h-14 w-14 rounded object-cover"
                  />
                ) : (
                  <span className="px-2">PDF</span>
                )}
                {locale === "hi" ? "देखें" : "View"}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-amber-800">
          {locale === "hi"
            ? "डीलर ने अभी प्रूफ नहीं भेजा।"
            : "Dealer has not uploaded proof yet."}
        </p>
      )}
    </li>
  );
}
