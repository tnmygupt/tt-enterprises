"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { DateRangeBar, useAdminDateRange } from "@/components/DateRangeBar";
import { ExportButtons } from "@/components/ExportButtons";
import { NumberField } from "@/components/NumberField";
import { SearchSelect } from "@/components/SearchSelect";
import {
  ACCT,
  computeOurClosing,
  entryBalanceEffect,
  matchDiff,
  suggestedVoucherForExtra,
} from "@/lib/accounting";
import { toDateInputValue } from "@/lib/date-range";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr, roundMoney } from "@/lib/pricing";
import {
  canViewFinancials,
  checkCapability,
  saveStatementMatch,
} from "@/lib/store/db";
import type { StatementMatchExtra } from "@/lib/types";

function MatchStatementInner() {
  const t = useTranslations();
  const search = useSearchParams();
  const { session } = useSession();
  const { db, refresh } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;
  const today = toDateInputValue();
  const [range, setRange] = useAdminDateRange("mtd");
  const from = range.from;
  const to = range.to;

  const [partyId, setPartyId] = useState("");
  const [partyType, setPartyType] = useState<"all" | "customer" | "supplier">(
    "customer"
  );
  const [theirClosing, setTheirClosing] = useState("");
  const [matchedIds, setMatchedIds] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<StatementMatchExtra[]>([]);
  const [sessionId, setSessionId] = useState<string | undefined>();
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  const [extraDate, setExtraDate] = useState(today);
  const [extraNumber, setExtraNumber] = useState("");
  const [extraAmount, setExtraAmount] = useState("");
  const [extraSide, setExtraSide] = useState<"increase" | "decrease">(
    "increase"
  );
  const [extraNote, setExtraNote] = useState("");

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const p = search.get("party");
    if (p) setPartyId(p);
    const type = search.get("type");
    if (type === "customer" || type === "supplier" || type === "all") {
      setPartyType(type);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [search]);

  const parties = useMemo(() => {
    if (!db) return [];
    return db.parties
      .filter((p) => p.active)
      .filter((p) => (partyType === "all" ? true : p.type === partyType))
      .filter((p) => !(p.type === "supplier" && !isOwner))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db, partyType, isOwner]);

  const partyOptions = useMemo(
    () =>
      parties.map((p) => ({
        value: p.id,
        label: `${p.name} (${p.type === "customer" ? "Customer" : "Supplier"})`,
        searchText: `${p.name} ${p.phone} ${p.gstin ?? ""}`,
      })),
    [parties]
  );

  const party = db?.parties.find((p) => p.id === partyId);
  const controlId =
    party?.type === "supplier" ? ACCT.creditors : ACCT.debtors;

  const entries = useMemo(() => {
    if (!db || !partyId) return [];
    return db.ledgerEntries
      .filter(
        (e) =>
          !e.voided &&
          e.partyId === partyId &&
          e.accountId === controlId &&
          e.date >= from &&
          e.date <= to
      )
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  }, [db, partyId, controlId, from, to]);

  const savedSessions = useMemo(() => {
    if (!db || !partyId) return [];
    return (db.statementMatches ?? [])
      .filter((m) => m.partyId === partyId && m.status !== "archived")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [db, partyId]);

  const ourClosing = party
    ? computeOurClosing(party, db?.ledgerEntries ?? [], to)
    : 0;

  const theirClosingNum = Number(theirClosing) || 0;

  const diff = useMemo(() => {
    if (!party) return null;
    return matchDiff({
      party,
      ourClosing,
      theirClosing: theirClosingNum,
      entries,
      matchedEntryIds: [...matchedIds],
      theirExtraRows: extras,
    });
  }, [party, ourClosing, theirClosingNum, entries, matchedIds, extras]);

  const balanced = diff ? Math.abs(diff.unexplained) < 0.02 : false;

  const resetWorking = () => {
    setMatchedIds(new Set());
    setExtras([]);
    setTheirClosing("");
    setSessionId(undefined);
    setMsg("");
    setError("");
  };

  const loadSession = (id: string) => {
    const row = savedSessions.find((m) => m.id === id);
    if (!row) return;
    setSessionId(row.id);
    setRange({ preset: "custom", from: row.from, to: row.to });
    setTheirClosing(String(row.theirClosingBalance));
    setMatchedIds(new Set(row.matchedEntryIds));
    setExtras(structuredClone(row.theirExtraRows));
    setMsg(`Loaded saved match · ${row.from} → ${row.to}`);
    setError("");
  };

  const toggleMatch = (id: string) => {
    setMatchedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const matchAll = () => setMatchedIds(new Set(entries.map((e) => e.id)));
  const clearMatches = () => setMatchedIds(new Set());

  const addExtra = () => {
    const amount = roundMoney(Number(extraAmount) || 0);
    if (!amount) {
      setError("Enter an amount for their line");
      return;
    }
    setExtras((prev) => [
      ...prev,
      {
        id: `x_${crypto.randomUUID()}`,
        date: extraDate,
        number: extraNumber.trim() || "—",
        amount,
        side: extraSide,
        note: extraNote.trim() || undefined,
      },
    ]);
    setExtraNumber("");
    setExtraAmount("");
    setExtraNote("");
    setError("");
  };

  const removeExtra = (id: string) => {
    setExtras((prev) => prev.filter((x) => x.id !== id));
  };

  const onSave = (status: "open" | "reconciled" = "open") => {
    if (!session || !party) return;
    if (status === "reconciled" && !balanced) {
      setError("Unexplained must be zero before marking reconciled");
      return;
    }
    setError("");
    setMsg("");
    try {
      const row = saveStatementMatch({
        id: sessionId,
        partyId: party.id,
        from,
        to,
        theirClosingBalance: theirClosingNum,
        matchedEntryIds: [...matchedIds],
        theirExtraRows: extras,
        status,
        createdBy: session.id,
      });
      setSessionId(row.id);
      setMsg(
        status === "reconciled"
          ? "Saved · marked reconciled"
          : "Match session saved"
      );
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save");
    }
  };

  const exportOptions = useMemo(() => {
    if (!party || !diff) {
      return {
        title: "Statement match",
        filename: "statement-match.pdf",
        columns: ["Side", "Date", "Ref", "Amount", "Note"],
        rows: [] as string[][],
      };
    }
    const ourRows = entries.map((e) => [
      matchedIds.has(e.id) ? "Ours ✓" : "Ours ✗",
      e.date,
      e.voucherNumber,
      formatInr(Math.abs(e.debit || e.credit)),
      e.narration || e.voucherType,
    ]);
    const theirRows = extras.map((x) => [
      `Theirs (${x.side})`,
      x.date,
      x.number,
      formatInr(x.amount),
      x.note || "",
    ]);
    return {
      title: "Statement match",
      subtitle: `${party.name} · ${from} → ${to} · Ours ${formatInr(ourClosing)} · Theirs ${formatInr(theirClosingNum)} · Diff ${formatInr(diff.difference)} · Unexplained ${formatInr(diff.unexplained)}`,
      filename: `statement-match-${party.name}-${from}-${to}.pdf`,
      columns: ["Side", "Date", "Ref", "Amount", "Note"],
      rows: [...ourRows, ...theirRows],
    };
  }, [
    party,
    diff,
    entries,
    matchedIds,
    extras,
    from,
    to,
    ourClosing,
    theirClosingNum,
  ]);

  if (!session || !checkCapability(session, db, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  if (party?.type === "supplier" && !isOwner) {
    return (
      <AccountsShell>
        <AdminAccessDenied title={t("accounts.ownerOnlySupplierAmounts")} />
      </AccountsShell>
    );
  }

  return (
    <AccountsShell>
      <AccountsPageHeader
        title={t("accounts.matchStatement")}
        hint={t("accounts.matchStatementHint")}
      />

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <select
          className="tt-select"
          value={partyType}
          onChange={(e) =>
            setPartyType(e.target.value as "all" | "customer" | "supplier")
          }
        >
          <option value="all">All</option>
          <option value="customer">Customers</option>
          {isOwner ? <option value="supplier">Suppliers</option> : null}
        </select>
        <SearchSelect
          className="min-w-[220px]"
          options={partyOptions}
          value={partyId}
          onChange={(v) => {
            setPartyId(v);
            resetWorking();
          }}
          placeholder="Search party…"
          emptyLabel="Select party…"
        />
        <DateRangeBar value={range} onChange={setRange} />
        <label className="flex items-center gap-2 text-sm">
          <span className="text-[var(--ink-muted)]">Their closing</span>
          <NumberField
            className="tt-input w-36"
            emptyAs={null}
            placeholder="0"
            value={theirClosing}
            onValueChange={(v) =>
              setTheirClosing(v === "" ? "" : String(v))
            }
            disabled={!party}
          />
        </label>
      </div>

      {party && savedSessions.length > 0 ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-[var(--ink-muted)]">Resume:</span>
          {savedSessions.slice(0, 5).map((m) => (
            <button
              key={m.id}
              type="button"
              className="tt-btn tt-btn-outline text-xs"
              onClick={() => loadSession(m.id)}
            >
              {m.from} → {m.to}
              {m.status === "reconciled" ? " ✓" : ""}
            </button>
          ))}
        </div>
      ) : null}

      {msg ? (
        <p className="mt-3 text-sm text-[var(--ok)]">{msg}</p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      {!party ? (
        <p className="mt-6 text-sm text-[var(--ink-muted)]">
          Pick a party and enter the closing balance from their statement.
        </p>
      ) : (
        <>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="tt-panel p-4">
              <p className="text-xs text-[var(--ink-muted)]">Our closing</p>
              <p className="tt-display text-2xl text-[var(--brand-deep)]">
                {formatInr(ourClosing)}
              </p>
            </div>
            <div className="tt-panel p-4">
              <p className="text-xs text-[var(--ink-muted)]">Their closing</p>
              <p className="tt-display text-2xl text-[var(--brand-deep)]">
                {formatInr(theirClosingNum)}
              </p>
            </div>
            <div className="tt-panel p-4">
              <p className="text-xs text-[var(--ink-muted)]">Difference</p>
              <p className="tt-display text-2xl text-[var(--brand-deep)]">
                {formatInr(diff?.difference ?? 0)}
              </p>
            </div>
            <div
              className={`tt-panel p-4 ${
                balanced
                  ? "ring-1 ring-[var(--ok)]"
                  : "ring-1 ring-[var(--danger)]"
              }`}
            >
              <p className="text-xs text-[var(--ink-muted)]">Unexplained</p>
              <p
                className={`tt-display text-2xl ${
                  balanced ? "text-[var(--ok)]" : "text-[var(--danger)]"
                }`}
              >
                {formatInr(diff?.unexplained ?? 0)}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={matchAll}
            >
              Tick all ours
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={clearMatches}
            >
              Clear ticks
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-dark"
              onClick={() => onSave("open")}
            >
              Save
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              disabled={!balanced}
              onClick={() => onSave("reconciled")}
            >
              Mark reconciled
            </button>
            <ExportButtons options={exportOptions} />
            <Link
              href={`/admin/accounts/party-statement?party=${party.id}&type=${party.type}`}
              className="tt-btn tt-btn-outline"
            >
              Full statement
            </Link>
          </div>

          <div className="tt-panel mt-5 overflow-x-auto">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--line)] px-4 py-3">
              <p className="text-sm font-semibold">Our ledger in period</p>
              <p className="shrink-0 text-xs text-[var(--ink-muted)]">
                {matchedIds.size} / {entries.length} matched · Unticked total{" "}
                {formatInr(diff?.unmatchedOurTotal ?? 0)}
              </p>
            </div>
            <table className="tt-table min-w-[720px]">
              <thead>
                <tr>
                  <th className="w-10">✓</th>
                  <th>Date</th>
                  <th>Voucher</th>
                  <th>Debit</th>
                  <th>Credit</th>
                  <th>Effect</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => {
                  const effect = entryBalanceEffect(party, e);
                  return (
                    <tr
                      key={e.id}
                      className={
                        matchedIds.has(e.id) ? "bg-[color-mix(in_srgb,var(--ok)_8%,transparent)]" : ""
                      }
                    >
                      <td>
                        <input
                          type="checkbox"
                          checked={matchedIds.has(e.id)}
                          onChange={() => toggleMatch(e.id)}
                          aria-label={`Match ${e.voucherNumber}`}
                        />
                      </td>
                      <td>{e.date}</td>
                      <td className="font-mono text-sm">
                        <VoucherNumberLink id={e.voucherId} number={e.voucherNumber} />{" "}· {e.voucherType}
                      </td>
                      <td>{e.debit ? formatInr(e.debit) : ""}</td>
                      <td>{e.credit ? formatInr(e.credit) : ""}</td>
                      <td className="tabular-nums">{formatInr(effect)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!entries.length ? (
              <p className="p-4 text-sm text-[var(--ink-muted)]">
                No ledger lines in this period.
              </p>
            ) : null}
          </div>

          <div className="tt-panel mt-5 p-4">
            <p className="text-sm font-semibold">
              On their statement, not ours
            </p>
            <p className="mt-1 text-xs text-[var(--ink-muted)]">
              Increase = raises what they claim we owe / they owe. Decrease =
              payment or credit on their side.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                type="date"
                className="tt-input"
                value={extraDate}
                onChange={(e) => setExtraDate(e.target.value)}
              />
              <input
                className="tt-input w-28"
                placeholder="Bill #"
                value={extraNumber}
                onChange={(e) => setExtraNumber(e.target.value)}
              />
              <NumberField
                className="tt-input w-28"
                emptyAs={null}
                placeholder="Amount"
                value={extraAmount}
                onValueChange={(v) =>
                  setExtraAmount(v === "" ? "" : String(v))
                }
              />
              <select
                className="tt-select"
                value={extraSide}
                onChange={(e) =>
                  setExtraSide(e.target.value as "increase" | "decrease")
                }
              >
                <option value="increase">Increase balance</option>
                <option value="decrease">Decrease balance</option>
              </select>
              <input
                className="tt-input min-w-[140px] flex-1"
                placeholder="Note"
                value={extraNote}
                onChange={(e) => setExtraNote(e.target.value)}
              />
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                onClick={addExtra}
              >
                Add
              </button>
            </div>

            {extras.length > 0 ? (
              <div className="mt-4 overflow-x-auto">
              <table className="tt-table min-w-[640px]">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Ref</th>
                    <th>Side</th>
                    <th>Amount</th>
                    <th>Note</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {extras.map((x) => {
                    const voucher = suggestedVoucherForExtra(party, x);
                    return (
                      <tr key={x.id}>
                        <td>{x.date}</td>
                        <td className="font-mono text-sm">{x.number}</td>
                        <td>{x.side}</td>
                        <td>{formatInr(x.amount)}</td>
                        <td className="text-sm">{x.note || "—"}</td>
                        <td className="space-x-2 whitespace-nowrap">
                          <Link
                            href={`/admin/accounts/vouchers?new=${voucher}&party=${party.id}`}
                            className="inline-flex min-h-11 items-center text-sm underline"
                          >
                            Create {voucher.replace("_", " ")}
                          </Link>
                          <button
                            type="button"
                            className="inline-flex min-h-11 items-center px-2 text-sm text-[var(--danger)]"
                            onClick={() => removeExtra(x.id)}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--ink-muted)]">
                None yet — add lines that appear only on their statement.
              </p>
            )}
          </div>
        </>
      )}
    </AccountsShell>
  );
}

export default function MatchStatementPage() {
  return (
    <Suspense
      fallback={
        <AccountsShell>
          <p className="p-4 text-sm">Loading…</p>
        </AccountsShell>
      }
    >
      <MatchStatementInner />
    </Suspense>
  );
}
