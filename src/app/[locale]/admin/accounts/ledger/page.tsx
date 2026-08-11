"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import {
  ACCT,
  OWNER_SENSITIVE_ACCOUNTS,
  accountBalance,
  isDebitNormal,
  partyBalance,
} from "@/lib/accounting";
import { ExportButtons } from "@/components/ExportButtons";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr, roundMoney } from "@/lib/pricing";
import { canViewFinancials, checkCapability } from "@/lib/store/db";
import type { Party } from "@/lib/types";

function LedgerInner() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const search = useSearchParams();
  const { session } = useSession();
  const { db } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;
  /**
   * Purchase-side money is owner-only. `manage_accounts` cannot be the test
   * here — the page already requires it, so that check never blocks anyone.
   */
  const canSeeSuppliers =
    isOwner || (!!session && checkCapability(session, db?.users, "view_financials"));
  const [mode, setMode] = useState<"account" | "party">("party");
  const [accountId, setAccountId] = useState("acct_cash");
  const [partyId, setPartyId] = useState("");
  const [partyType, setPartyType] = useState<"all" | "customer" | "supplier">(
    "all"
  );
  const [q, setQ] = useState("");
  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const a = search.get("account");
    if (a) {
      setMode("account");
      setAccountId(a);
    }
    const p = search.get("party");
    if (p) {
      setMode("party");
      setPartyId(p);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [search]);

  const parties = useMemo(() => {
    if (!db) return [];
    return db.parties
      .filter((p) => p.active)
      .filter((p) => canSeeSuppliers || p.type !== "supplier")
      .filter((p) => (partyType === "all" ? true : p.type === partyType))
      .filter((p) => {
        const hay = `${p.name} ${p.phone} ${p.gstin ?? ""}`.toLowerCase();
        return hay.includes(q.trim().toLowerCase());
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db, partyType, q, canSeeSuppliers]);

  const party = db?.parties.find((p) => p.id === partyId);
  const account = db?.accounts.find((a) => a.id === accountId);

  const controlId =
    party?.type === "supplier" ? ACCT.creditors : ACCT.debtors;

  const accountEntries = useMemo(() => {
    if (!db || !account || mode !== "account") return [];
    return db.ledgerEntries
      .filter(
        (e) =>
          !e.voided &&
          e.accountId === accountId &&
          e.date.slice(0, 10) <= asOf
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, [db, accountId, asOf, account, mode]);

  const partyEntries = useMemo(() => {
    if (!db || !party || mode !== "party") return [];
    return db.ledgerEntries
      .filter(
        (e) =>
          !e.voided &&
          e.partyId === partyId &&
          e.accountId === controlId &&
          e.date.slice(0, 10) <= asOf
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, [db, party, partyId, controlId, asOf, mode]);

  const runningAccount = useMemo(() => {
    if (!account) return [] as { e: (typeof accountEntries)[number]; bal: number }[];
    const out: { e: (typeof accountEntries)[number]; bal: number }[] = [];
    let bal = account.openingBalance;
    for (const e of accountEntries) {
      const delta = e.debit - e.credit;
      bal = roundMoney(
        isDebitNormal(account.type) ? bal + delta : bal - delta
      );
      out.push({ e, bal });
    }
    return out;
  }, [accountEntries, account]);

  const runningParty = useMemo(() => {
    const out: { e: (typeof partyEntries)[number]; bal: number }[] = [];
    let bal = 0;
    for (const e of partyEntries) {
      bal = roundMoney(bal + e.debit - e.credit);
      out.push({ e, bal });
    }
    return out;
  }, [partyEntries]);

  const closingAccount = account
    ? accountBalance(account, db?.ledgerEntries ?? [], asOf)
    : 0;
  const closingParty = party
    ? partyBalance(party, db?.ledgerEntries ?? [], asOf)
    : 0;

  const lockedAccount =
    mode === "account" &&
    !!account &&
    !isOwner &&
    OWNER_SENSITIVE_ACCOUNTS.has(account.id);

  const hideSupplierAmounts =
    mode === "party" && party?.type === "supplier" && !canSeeSuppliers;

  if (!session || !checkCapability(session, db?.users, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const exportRows =
    mode === "party"
      ? runningParty.map(({ e, bal }) => [
          e.date,
          e.voucherNumber,
          e.narration || e.voucherType,
          e.debit ? formatInr(e.debit, locale) : "—",
          e.credit ? formatInr(e.credit, locale) : "—",
          formatInr(bal, locale),
        ])
      : runningAccount.map(({ e, bal }) => [
          e.date,
          e.voucherNumber,
          e.narration || e.voucherType,
          e.debit ? formatInr(e.debit, locale) : "—",
          e.credit ? formatInr(e.credit, locale) : "—",
          formatInr(bal, locale),
        ]);

  const exportOptions = (() => {
    const title =
      mode === "party" && party
        ? `${party.name} (${party.type})`
        : account
          ? `${account.code} · ${account.name[locale]}`
          : "Ledger";
    return {
      title: t("accounts.ledger"),
      subtitle: `${title} · As of ${asOf}`,
      filename: `ledger-${mode}-${asOf}.pdf`,
      columns: [
        "Date",
        "Voucher",
        "Narration",
        "Debit",
        "Credit",
        "Balance",
      ],
      rows: exportRows,
    };
  })();

  return (
    <AccountsShell>
      <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)]">
        {t("accounts.ledger")}
      </h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        {locale === "hi"
          ? "खाता या देनदार / लेनदार पार्टी खोजें"
          : "Search account or debtor / creditor party"}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={`tt-btn ${mode === "party" ? "tt-btn-dark" : "tt-btn-outline"}`}
          onClick={() => setMode("party")}
        >
          {t("accounts.ledgerModeParty")}
        </button>
        <button
          type="button"
          className={`tt-btn ${mode === "account" ? "tt-btn-dark" : "tt-btn-outline"}`}
          onClick={() => setMode("account")}
        >
          {t("accounts.ledgerModeAccount")}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        {mode === "party" ? (
          <>
            <div>
              <label className="tt-label">{t("accounts.searchParty")}</label>
              <input
                className="tt-input min-w-[200px]"
                placeholder={locale === "hi" ? "नाम / फ़ोन" : "Name / phone"}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div>
              <label className="tt-label">Type</label>
              <select
                className="tt-select"
                value={partyType}
                onChange={(e) =>
                  setPartyType(e.target.value as "all" | "customer" | "supplier")
                }
              >
                <option value="all">{t("common.all")}</option>
                <option value="customer">{t("accounts.customers")}</option>
                {canSeeSuppliers ? (
                  <option value="supplier">{t("accounts.suppliers")}</option>
                ) : null}
              </select>
            </div>
            <div>
              <label className="tt-label">{t("common.party")}</label>
              <select
                className="tt-select min-w-[240px]"
                value={partyId}
                onChange={(e) => setPartyId(e.target.value)}
              >
                <option value="">
                  {locale === "hi" ? "पार्टी चुनें…" : "Select party…"}
                </option>
                {parties.map((p: Party) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.type === "customer" ? "Debtor" : "Creditor"})
                  </option>
                ))}
              </select>
            </div>
          </>
        ) : (
          <div>
            <label className="tt-label">Account</label>
            <select
              className="tt-select min-w-[240px]"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              {(db?.accounts ?? [])
                .filter(
                  (a) =>
                    a.active &&
                    (isOwner || !OWNER_SENSITIVE_ACCOUNTS.has(a.id))
                )
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} · {a.name[locale]}
                  </option>
                ))}
            </select>
          </div>
        )}
        <div>
          <label className="tt-label">As of</label>
          <input
            type="date"
            className="tt-input"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </div>
        {!lockedAccount && !hideSupplierAmounts && (mode === "account" || party) ? (
          <ExportButtons options={exportOptions} />
        ) : null}
        {mode === "party" && party ? (
          <Link
            href={`/admin/accounts/party-statement?party=${party.id}`}
            className="tt-btn tt-btn-outline"
          >
            {t("accounts.partyStatement")}
          </Link>
        ) : null}
      </div>

      {lockedAccount ? (
        <p className="mt-4 text-sm text-[var(--danger)]">
          {t("owner.ownerOnly")}
        </p>
      ) : mode === "party" && !party ? (
        <p className="mt-6 text-sm text-[var(--ink-muted)]">
          {locale === "hi"
            ? "देनदार या लेनदार चुनें।"
            : "Pick a debtor or creditor to view their ledger."}
        </p>
      ) : hideSupplierAmounts ? (
        <p className="mt-4 text-sm text-[var(--danger)]">
          {t("owner.ownerOnly")}
        </p>
      ) : (
        <>
          <p className="mt-4 text-sm">
            {mode === "party" ? (
              <>
                {party?.type === "customer"
                  ? t("accounts.customers")
                  : t("accounts.suppliers")}
                : <strong>{party?.name}</strong>
                {" · "}
                {t("accounts.outstanding")}:{" "}
                <strong>{formatInr(closingParty, locale)}</strong>
              </>
            ) : (
              <>
                Opening:{" "}
                <strong>
                  {formatInr(account?.openingBalance ?? 0, locale)}
                </strong>
                {" · "}
                Closing: <strong>{formatInr(closingAccount, locale)}</strong>
              </>
            )}
          </p>

          <div className="tt-panel mt-4 overflow-x-auto">
            <table className="tt-table min-w-[800px]">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Voucher</th>
                  <th>Narration</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th>Balance</th>
                </tr>
              </thead>
              <tbody>
                {(mode === "party" ? runningParty : runningAccount).map(
                  ({ e, bal }) => (
                    <tr key={e.id}>
                      <td>{e.date}</td>
                      <td><VoucherNumberLink id={e.voucherId} number={e.voucherNumber} /></td>
                      <td className="text-sm text-[var(--ink-muted)]">
                        {e.narration || e.voucherType}
                      </td>
                      <td>{e.debit ? formatInr(e.debit, locale) : "—"}</td>
                      <td>{e.credit ? formatInr(e.credit, locale) : "—"}</td>
                      <td>{formatInr(bal, locale)}</td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
            {(mode === "party" ? runningParty : runningAccount).length === 0 ? (
              <p className="p-4 text-sm text-[var(--ink-muted)]">
                {t("common.empty")}
              </p>
            ) : null}
          </div>
        </>
      )}
    </AccountsShell>
  );
}

export default function AccountsLedgerViewPage() {
  return (
    <Suspense
      fallback={
        <AccountsShell>
          <p className="p-4 text-sm">Loading…</p>
        </AccountsShell>
      }
    >
      <LedgerInner />
    </Suspense>
  );
}
