"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { SearchSelect } from "@/components/SearchSelect";
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
    isOwner || (!!session && checkCapability(session, db, "view_financials"));
  const [mode, setMode] = useState<"account" | "party">("party");
  const [accountId, setAccountId] = useState("acct_cash");
  const [partyId, setPartyId] = useState("");
  const [partyType, setPartyType] = useState<"all" | "customer" | "supplier">(
    "all"
  );
  const [range, setRange] = useAdminDateRange("mtd");
  const from = range.from;
  const to = range.to;

  const dayBeforeFrom = useMemo(() => {
    const d = new Date(from + "T00:00:00");
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  }, [from]);

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
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db, partyType, canSeeSuppliers]);

  const partyOptions = useMemo(
    () =>
      parties.map((p) => ({
        value: p.id,
        label: `${p.name} (${p.type === "customer" ? "Debtor" : "Creditor"})`,
        searchText: `${p.name} ${p.phone} ${p.gstin ?? ""}`,
      })),
    [parties]
  );

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
          e.date.slice(0, 10) >= from &&
          e.date.slice(0, 10) <= to
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, [db, accountId, from, to, account, mode]);

  const partyEntries = useMemo(() => {
    if (!db || !party || mode !== "party") return [];
    return db.ledgerEntries
      .filter(
        (e) =>
          !e.voided &&
          e.partyId === partyId &&
          e.accountId === controlId &&
          e.date.slice(0, 10) >= from &&
          e.date.slice(0, 10) <= to
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, [db, party, partyId, controlId, from, to, mode]);

  const runningAccount = useMemo(() => {
    if (!account) return [] as { e: (typeof accountEntries)[number]; bal: number }[];
    const out: { e: (typeof accountEntries)[number]; bal: number }[] = [];
    let bal = accountBalance(
      account,
      db?.ledgerEntries ?? [],
      dayBeforeFrom
    );
    for (const e of accountEntries) {
      const delta = e.debit - e.credit;
      bal = roundMoney(
        isDebitNormal(account.type) ? bal + delta : bal - delta
      );
      out.push({ e, bal });
    }
    return out;
  }, [accountEntries, account, db, dayBeforeFrom]);

  const runningParty = useMemo(() => {
    const out: { e: (typeof partyEntries)[number]; bal: number }[] = [];
    let bal = party
      ? partyBalance(party, db?.ledgerEntries ?? [], dayBeforeFrom)
      : 0;
    for (const e of partyEntries) {
      bal = roundMoney(bal + e.debit - e.credit);
      out.push({ e, bal });
    }
    return out;
  }, [partyEntries, party, db, dayBeforeFrom]);

  const closingAccount = account
    ? accountBalance(account, db?.ledgerEntries ?? [], to)
    : 0;
  const closingParty = party
    ? partyBalance(party, db?.ledgerEntries ?? [], to)
    : 0;

  const lockedAccount =
    mode === "account" &&
    !!account &&
    !isOwner &&
    OWNER_SENSITIVE_ACCOUNTS.has(account.id);

  const hideSupplierAmounts =
    mode === "party" && party?.type === "supplier" && !canSeeSuppliers;

  if (!session || !checkCapability(session, db, "manage_accounts")) {
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
      subtitle: `${title} · ${from} → ${to}`,
      filename: `ledger-${mode}-${from}-${to}.pdf`,
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
      <AccountsPageHeader
        title={t("accounts.ledger")}
        hint={t("accounts.ledgerHint")}
      />

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
              <label className="tt-label">{t("accounts.typeLabel")}</label>
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
            <div className="min-w-[240px]">
              <label className="tt-label">{t("common.party")}</label>
              <SearchSelect
                options={partyOptions}
                value={partyId}
                onChange={setPartyId}
                placeholder={t("accounts.searchParty")}
                emptyLabel={t("accounts.selectParty")}
              />
            </div>
          </>
        ) : (
          <div>
            <label className="tt-label">{t("accounts.accountLabel")}</label>
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
        <DateRangeBar value={range} onChange={setRange} />
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
        <AccountsEmpty message={t("accounts.emptyLedgerPick")} />
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

          <div className="tt-acct-cards mt-4 sm:hidden">
            {(mode === "party" ? runningParty : runningAccount).map(
              ({ e, bal }) => (
                <div key={e.id} className="tt-panel tt-acct-card">
                  <p className="text-xs text-[var(--ink-muted)]">{e.date}</p>
                  <p className="font-mono text-sm font-semibold">
                    <VoucherNumberLink
                      id={e.voucherId}
                      number={e.voucherNumber}
                    />
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-muted)]">
                    {e.narration || e.voucherType}
                  </p>
                  <p className="mt-1 text-sm tabular-nums">
                    {e.debit
                      ? `Dr ${formatInr(e.debit, locale)}`
                      : e.credit
                        ? `Cr ${formatInr(e.credit, locale)}`
                        : "—"}
                    <span className="ml-2 text-[var(--ink-muted)]">
                      {formatInr(bal, locale)}
                    </span>
                  </p>
                </div>
              )
            )}
          </div>
          <div className="tt-panel tt-acct-table-wrap mt-4 hidden sm:block">
            <table className="tt-table min-w-[800px]">
              <thead>
                <tr>
                  <th>{t("accounts.colDate")}</th>
                  <th>{t("accounts.colVoucher")}</th>
                  <th>{t("accounts.colNarration")}</th>
                  <th>{t("accounts.colDebit")}</th>
                  <th>{t("accounts.colCredit")}</th>
                  <th>{t("accounts.colBalance")}</th>
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
                      <td className="tabular-nums">{e.debit ? formatInr(e.debit, locale) : "—"}</td>
                      <td className="tabular-nums">{e.credit ? formatInr(e.credit, locale) : "—"}</td>
                      <td className="tabular-nums">{formatInr(bal, locale)}</td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>
          {(mode === "party" ? runningParty : runningAccount).length === 0 ? (
            <AccountsEmpty message={t("accounts.emptyLedger")} />
          ) : null}
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
