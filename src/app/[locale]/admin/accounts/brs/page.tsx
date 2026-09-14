"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { NumberField } from "@/components/NumberField";
import {
  ACCT,
  cashBankAccounts,
  collectBrsProofHints,
  matchBrsProofHint,
  summarizeBrs,
} from "@/lib/accounting";
import { toDateInputValue } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr, roundMoney } from "@/lib/pricing";
import { checkCapability, saveBankRecon } from "@/lib/store/db";
import type { BankReconExtra } from "@/lib/types";

export default function BankReconPage() {
  const t = useTranslations("accounts");
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const today = toDateInputValue();
  const cashAndBank = useMemo(
    () => cashBankAccounts(db?.accounts ?? []),
    [db]
  );
  const [accountId, setAccountId] = useState<string>(ACCT.bank);
  const [asOf, setAsOf] = useState(today);
  const [statement, setStatement] = useState("");
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<BankReconExtra[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [msg, setMsg] = useState("");
  const [extraNote, setExtraNote] = useState("");
  const [extraAmt, setExtraAmt] = useState("");
  const [extraSide, setExtraSide] = useState<"charge" | "interest">("charge");

  const account = cashAndBank.find((a) => a.id === accountId);

  const saved = useMemo(() => {
    if (!db) return undefined;
    return (db.bankRecons ?? []).find(
      (r) => r.accountId === accountId && r.asOf === asOf
    );
  }, [db, accountId, asOf]);

  const [syncedRecon, setSyncedRecon] = useState<typeof saved>(undefined);
  if (saved !== syncedRecon) {
    setSyncedRecon(saved);
    if (saved) {
      setStatement(String(saved.statementBalance));
      setCleared(new Set(saved.clearedEntryIds));
      setExtras(saved.extras ?? []);
      setSessionId(saved.id);
    } else {
      setStatement("");
      setCleared(new Set());
      setExtras([]);
      setSessionId(undefined);
    }
  }

  const summary = useMemo(() => {
    if (!db || !account) return null;
    const statementBalance = Number(statement) || 0;
    return summarizeBrs({
      account,
      entries: db.ledgerEntries,
      asOf,
      statementBalance,
      clearedEntryIds: [...cleared],
      extras,
    });
  }, [db, account, asOf, statement, cleared, extras]);

  const proofHints = useMemo(
    () => collectBrsProofHints(db?.orders ?? []),
    [db]
  );
  const waitingProofs = useMemo(
    () => proofHints.filter((h) => !h.verified).slice(0, 12),
    [proofHints]
  );

  if (!session || !checkCapability(session, db, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const toggle = (id: string) => {
    setCleared((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setMsg("");
  };

  const addExtra = () => {
    const amt = Number(extraAmt);
    if (!(amt > 0) || !extraNote.trim()) return;
    const row: BankReconExtra = {
      id: `bre_${crypto.randomUUID()}`,
      date: asOf,
      note: extraNote.trim(),
      debit: extraSide === "charge" ? roundMoney(amt) : 0,
      credit: extraSide === "interest" ? roundMoney(amt) : 0,
    };
    setExtras((xs) => [...xs, row]);
    setExtraNote("");
    setExtraAmt("");
  };

  const onSave = (status: "open" | "reconciled") => {
    if (!session) return;
    try {
      const row = saveBankRecon({
        id: sessionId,
        accountId,
        asOf,
        statementBalance: Number(statement) || 0,
        clearedEntryIds: [...cleared],
        extras,
        status:
          status === "reconciled" && summary?.balanced
            ? "reconciled"
            : status === "reconciled"
              ? "open"
              : status,
        updatedBy: session.id,
      });
      setSessionId(row.id);
      setMsg(
        status === "reconciled" && summary?.balanced
          ? t("brsReconciled")
          : t("brsSaved")
      );
      refresh();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : t("brsSaveFailed"));
    }
  };

  return (
    <AccountsShell>
      <AccountsPageHeader title={t("brsTitle")} hint={t("brsHint")} />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="tt-label">{t("brsAccount")}</span>
          <select
            className="tt-select mt-1"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            {cashAndBank.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name[locale] || a.name.en}
                {a.id === ACCT.cash ? ` · ${t("cashInHand")}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="tt-label">{t("brsAsOf")}</span>
          <input
            type="date"
            className="tt-input mt-1"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
        <label className="text-sm">
          <span className="tt-label">{t("brsStatementBal")}</span>
          <NumberField
            className="tt-input mt-1 w-40"
            emptyAs={null}
            value={statement}
            onValueChange={(v) => setStatement(v === "" ? "" : String(v))}
          />
        </label>
      </div>

      {summary ? (
        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="tt-panel p-4">
            <p className="text-xs uppercase text-[var(--ink-muted)]">
              {t("brsBooks")}
            </p>
            <p className="mt-1 text-lg font-semibold">
              {formatInr(summary.booksBalance, locale)}
            </p>
          </div>
          <div className="tt-panel p-4">
            <p className="text-xs uppercase text-[var(--ink-muted)]">
              {t("brsExpected")}
            </p>
            <p className="mt-1 text-lg font-semibold">
              {formatInr(summary.expectedStatement, locale)}
            </p>
          </div>
          <div className="tt-panel p-4">
            <p className="text-xs uppercase text-[var(--ink-muted)]">
              {t("brsStatementBal")}
            </p>
            <p className="mt-1 text-lg font-semibold">
              {formatInr(Number(statement) || 0, locale)}
            </p>
          </div>
          <div
            className={`tt-panel p-4 ${summary.balanced ? "border-[var(--ok)]" : ""}`}
          >
            <p className="text-xs uppercase text-[var(--ink-muted)]">
              {t("brsDifference")}
            </p>
            <p className="mt-1 text-lg font-semibold">
              {formatInr(summary.difference, locale)}
            </p>
            <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
              {summary.balanced ? t("brsMatched") : t("brsTickHint")}
            </p>
          </div>
        </div>
      ) : null}

      <p className="mt-4 text-sm text-[var(--ink-muted)]">
        {t("brsFormula")}
      </p>

      {waitingProofs.length ? (
        <div className="mt-4 rounded-xl border border-dashed border-[var(--brand)]/40 bg-[var(--brand-soft)]/40 p-3 text-sm">
          <p className="font-semibold">{t("brsWaitingProofs")}</p>
          <p className="mt-0.5 text-xs text-[var(--ink-muted)]">
            {t("brsWaitingHint")}
          </p>
          <ul className="mt-2 space-y-1">
            {waitingProofs.map((h, i) => (
              <li key={`${h.orderNumber}-${h.payRef || i}`}>
                {h.orderNumber} · {formatInr(h.amount, locale)} · {h.date}
                {h.payRef ? ` · ${h.payRef}` : ""}
                {h.utr ? ` · ${h.utr}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {t("brsEntries")}
      </h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--line)] text-xs uppercase text-[var(--ink-muted)]">
              <th className="py-2 pr-2">{t("brsInBank")}</th>
              <th className="py-2 pr-2">Date</th>
              <th className="py-2 pr-2">Vch</th>
              <th className="py-2 pr-2">{t("brsNarration")}</th>
              <th className="py-2 pr-2">{t("brsHintCol")}</th>
              <th className="py-2 pr-2 text-right">{t("brsDebit")}</th>
              <th className="py-2 text-right">{t("brsCredit")}</th>
            </tr>
          </thead>
          <tbody>
            {(summary?.rows ?? []).map((e) => {
              const inBank = cleared.has(e.id);
              const hint = matchBrsProofHint(e, proofHints);
              const suggest = !!hint && !inBank;
              return (
                <tr
                  key={e.id}
                  className={`border-b border-[var(--line)] ${
                    inBank
                      ? "bg-[var(--brand-soft)]"
                      : suggest
                        ? "bg-[var(--warn,var(--brand-soft))]/35"
                        : ""
                  }`}
                >
                  <td className="py-2 pr-2">
                    <input
                      type="checkbox"
                      checked={inBank}
                      onChange={() => toggle(e.id)}
                      aria-label={t("brsInBank")}
                    />
                  </td>
                  <td className="py-2 pr-2 whitespace-nowrap">{e.date}</td>
                  <td className="py-2 pr-2">
                    <VoucherNumberLink
                      id={e.voucherId}
                      number={e.voucherNumber}
                    />
                  </td>
                  <td className="py-2 pr-2">{e.narration || e.voucherType}</td>
                  <td className="py-2 pr-2 text-xs">
                    {hint ? (
                      <>
                        {suggest ? (
                          <span className="mr-1 font-semibold text-[var(--brand-deep)]">
                            {t("brsSuggest")}
                          </span>
                        ) : null}
                        <span className="font-mono">
                          {[hint.payRef, hint.utr, hint.orderNumber]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </>
                    ) : (
                      ""
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    {e.debit ? formatInr(e.debit, locale) : ""}
                  </td>
                  <td className="py-2 text-right">
                    {e.credit ? formatInr(e.credit, locale) : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {summary && summary.rows.length === 0 ? (
          <AccountsEmpty
            message={t("brsEmpty")}
            href="/admin/accounts/vouchers?new=receipt"
            cta={t("emptyBrsCta")}
          />
        ) : null}
      </div>

      <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-[var(--ink-muted)]">
        {t("brsBankOnly")}
      </h2>
      <p className="mt-1 text-xs text-[var(--ink-muted)]">{t("brsBankOnlyHint")}</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <input
          className="tt-input min-w-[12rem]"
          placeholder={t("brsExtraNote")}
          value={extraNote}
          onChange={(e) => setExtraNote(e.target.value)}
        />
        <NumberField
          className="tt-input w-28"
          emptyAs={null}
          value={extraAmt}
          onValueChange={(v) => setExtraAmt(v === "" ? "" : String(v))}
        />
        <select
          className="tt-select"
          value={extraSide}
          onChange={(e) =>
            setExtraSide(e.target.value === "interest" ? "interest" : "charge")
          }
        >
          <option value="charge">{t("brsCharge")}</option>
          <option value="interest">{t("brsInterest")}</option>
        </select>
        <button type="button" className="tt-btn tt-btn-outline" onClick={addExtra}>
          {t("brsAddExtra")}
        </button>
      </div>
      {extras.length ? (
        <ul className="mt-2 space-y-1 text-sm">
          {extras.map((x) => (
            <li key={x.id} className="flex justify-between gap-2">
              <span>
                {x.note} ·{" "}
                {x.debit
                  ? `${t("brsCharge")} ${formatInr(x.debit, locale)}`
                  : `${t("brsInterest")} ${formatInr(x.credit, locale)}`}
              </span>
              <button
                type="button"
                className="text-xs underline"
                onClick={() => setExtras((xs) => xs.filter((r) => r.id !== x.id))}
              >
                {t("brsRemove")}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          className="tt-btn tt-btn-dark"
          onClick={() => onSave("open")}
        >
          {t("brsSave")}
        </button>
        <button
          type="button"
          className="tt-btn tt-btn-primary"
          disabled={!summary?.balanced}
          onClick={() => onSave("reconciled")}
        >
          {t("brsMarkDone")}
        </button>
      </div>
      {msg ? <p className="mt-2 text-sm text-[var(--brand-deep)]">{msg}</p> : null}
    </AccountsShell>
  );
}
