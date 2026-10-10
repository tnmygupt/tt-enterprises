"use client";

import { Suspense, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link } from "@/i18n/routing";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import {
  allOpenReceivables,
  creditLimitBreach,
  invoiceSettlementLines,
  leftoverReceipts,
  partyAging,
  partyBalance,
} from "@/lib/accounting";
import { ExportButtons } from "@/components/ExportButtons";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { checkCapability } from "@/lib/store/db";
import type { AppDatabase } from "@/lib/store/db";

function lastReceiptForInvoice(db: AppDatabase, invoiceId: string) {
  return [...invoiceSettlementLines(invoiceId, db.vouchers, db.billAllocations ?? [])]
    .reverse()
    .find((s) => s.kind === "receipt" || s.kind === "payment");
}

function partyIsOverLimit(db: AppDatabase, partyId?: string) {
  if (!partyId) return false;
  const party = db.parties.find((p) => p.id === partyId);
  if (!party) return false;
  const recv = partyBalance(party, db.ledgerEntries);
  return !creditLimitBreach(party, recv, 0).ok;
}

export default function ReceivablesPage() {
  return (
    <Suspense
      fallback={
        <AccountsShell>
          <p>Loading…</p>
        </AccountsShell>
      }
    >
      <ReceivablesInner />
    </Suspense>
  );
}

function ReceivablesInner() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db } = useDb();
  const search = useSearchParams();
  const [partyId, setPartyId] = useState("");
  const [overdueOnly, setOverdueOnly] = useState(search.get("overdue") === "1");
  const asOf = new Date().toISOString().slice(0, 10);

  const open = useMemo(() => {
    if (!db) return [];
    let rows = allOpenReceivables(
      db.parties,
      db.vouchers,
      db.billAllocations ?? [],
      asOf,
      db.orders
    );
    if (partyId) rows = rows.filter((r) => r.voucher.partyId === partyId);
    if (overdueOnly) rows = rows.filter((r) => r.daysOverdue > 0);
    return rows;
  }, [db, partyId, asOf, overdueOnly]);

  const leftoverByParty = useMemo(() => {
    const map = new Map<string, number>();
    if (!db) return map;
    for (const row of leftoverReceipts(
      db.vouchers,
      db.billAllocations ?? []
    )) {
      const pid = row.voucher.partyId;
      if (!pid) continue;
      map.set(pid, (map.get(pid) || 0) + row.leftover);
    }
    return map;
  }, [db]);

  const exportOptions = useMemo(
    () => ({
      title: t("accounts.receivables"),
      subtitle: `${t("common.asOf")} ${asOf}`,
      filename: `receivables-${asOf}.pdf`,
      columns: [
        "Invoice",
        "Date",
        "Due",
        "Party",
        "Total",
        "Outstanding",
        "Aging",
      ],
      rows: open.map((row) => {
        const party =
          db?.parties.find((p) => p.id === row.voucher.partyId)?.name || "—";
        return [
          row.voucher.number,
          row.voucher.date,
          row.voucher.dueDate || row.voucher.date,
          party,
          formatInr(row.voucher.total, locale),
          formatInr(row.outstanding, locale),
          row.bucket === "current"
            ? locale === "hi"
              ? "चालू"
              : "Current"
            : `${row.daysOverdue}d`,
        ];
      }),
    }),
    [asOf, db, locale, open, t]
  );

  const aging = useMemo(() => {
    if (!db || !partyId) {
      const empty = {
        current: 0,
        d1_30: 0,
        d31_60: 0,
        d61_90: 0,
        d90_plus: 0,
        total: 0,
      };
      if (!db) return empty;
      for (const p of db.parties.filter(
        (x) => x.active && x.type === "customer"
      )) {
        const a = partyAging(
          p.id,
          db.vouchers,
          db.billAllocations ?? [],
          asOf,
          "sale",
          db.orders
        );
        empty.current += a.current;
        empty.d1_30 += a.d1_30;
        empty.d31_60 += a.d31_60;
        empty.d61_90 += a.d61_90;
        empty.d90_plus += a.d90_plus;
        empty.total += a.total;
      }
      return empty;
    }
    return partyAging(
      partyId,
      db.vouchers,
      db.billAllocations ?? [],
      asOf,
      "sale",
      db.orders
    );
  }, [db, partyId, asOf]);

  if (!session || !checkCapability(session, db, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const customers =
    db?.parties.filter((p) => p.active && p.type === "customer") ?? [];

  return (
    <AccountsShell>
      <AccountsPageHeader
        title={t("accounts.receivables")}
        hint={t("accounts.receivablesHint")}
      />

      <div className="mt-4 flex flex-wrap items-end gap-3 print:hidden">
        <div>
          <label className="tt-label">{t("accounts.customers")}</label>
          <select
            className="tt-select min-w-[220px]"
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
          >
            <option value="">
              {t("accounts.allCustomers")}
            </option>
            {customers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.creditLimit
                  ? ` · limit ${formatInr(p.creditLimit, locale)}`
                  : ""}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(e) => setOverdueOnly(e.target.checked)}
          />
          {t("accounts.overdueOnly")}
        </label>
        <button
          type="button"
          className="tt-btn tt-btn-outline"
          onClick={() => window.print()}
        >
          {t("accounts.print")}
        </button>
        <ExportButtons options={exportOptions} />
        <Link
          href="/admin/accounts/vouchers?new=receipt"
          className="tt-btn tt-btn-dark"
        >
          {t("accounts.newReceipt")}
        </Link>
        <Link
          href={
            partyId
              ? `/admin/accounts/party-statement?party=${encodeURIComponent(partyId)}&type=customer`
              : "/admin/accounts/party-statement?type=customer"
          }
          className="tt-btn tt-btn-outline"
        >
          {t("accounts.customerLedger")}
        </Link>
        <Link
          href={
            partyId
              ? `/admin/accounts/vouchers?new=credit_note&party=${encodeURIComponent(partyId)}`
              : "/admin/accounts/vouchers?new=credit_note"
          }
          className="tt-btn tt-btn-outline"
        >
          {t("accounts.postReturn")}
        </Link>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {(
          [
            ["current", t("accounts.agingCurrent")],
            ["d1_30", "1–30"],
            ["d31_60", "31–60"],
            ["d61_90", "61–90"],
            ["d90_plus", "90+"],
            ["total", t("common.total")],
          ] as const
        ).map(([key, label]) => (
          <div key={key} className="tt-panel p-3">
            <p className="text-xs font-bold uppercase text-[var(--ink-muted)]">
              {label}
            </p>
            <p className="mt-1 text-lg font-semibold text-[var(--brand-deep)]">
              {formatInr(aging[key], locale)}
            </p>
          </div>
        ))}
      </div>

      {partyId ? (
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          {locale === "hi" ? "पार्टी बकाया" : "Party balance"}:{" "}
          <strong>
            {formatInr(
              partyBalance(
                customers.find((p) => p.id === partyId)!,
                db?.ledgerEntries ?? []
              ),
              locale
            )}
          </strong>
        </p>
      ) : null}

      <div className="tt-acct-cards mt-4 sm:hidden">
        {open.map((row) => {
          const party = db?.parties.find((p) => p.id === row.voucher.partyId);
          const last = db
            ? lastReceiptForInvoice(db, row.voucher.id)
            : undefined;
          return (
            <div key={row.voucher.id} className="tt-panel tt-acct-card">
              <p className="font-mono text-sm font-semibold">
                <VoucherNumberLink
                  id={row.voucher.id}
                  number={row.voucher.number}
                />
              </p>
              <p className="text-sm">
                {party?.name || "—"}
                {db && partyIsOverLimit(db, party?.id) ? (
                  <span className="ml-2 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--danger)]">
                    {t("accounts.overLimitBadge")}
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                {row.voucher.date} · due {row.voucher.dueDate || row.voucher.date}
              </p>
              <p className="mt-1 text-sm font-semibold tabular-nums">
                {formatInr(row.outstanding, locale)}
                <span className="ml-2 text-xs font-normal text-[var(--ink-muted)]">
                  {row.bucket === "current"
                    ? t("accounts.agingCurrent")
                    : `${row.daysOverdue}d`}
                </span>
              </p>
              {last ? (
                <p className="mt-1 text-xs text-[var(--ink-muted)]">
                  {t("accounts.stmtLastReceipt")}{" "}
                  <VoucherNumberLink
                    id={last.voucherId}
                    number={last.number}
                  />{" "}
                  {formatInr(last.amount, locale)}
                </p>
              ) : null}
              {leftoverByParty.get(row.voucher.partyId || "") ? (
                <p className="mt-1 text-xs font-semibold text-[var(--brand-deep)]">
                  {t("accounts.onAccount")}{" "}
                  {formatInr(
                    leftoverByParty.get(row.voucher.partyId || "") || 0,
                    locale
                  )}
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="tt-panel tt-acct-table-wrap mt-4 hidden sm:block">
        <table className="tt-table min-w-[820px]">
          <thead>
            <tr>
              <th>{t("accounts.colInvoice")}</th>
              <th>{t("accounts.colDate")}</th>
              <th>{t("accounts.colDue")}</th>
              <th>{t("accounts.colParty")}</th>
              <th>{t("accounts.colTotal")}</th>
              <th>{t("accounts.outstanding")}</th>
              <th>{t("accounts.stmtLastReceipt")}</th>
              <th>{t("accounts.colAging")}</th>
            </tr>
          </thead>
          <tbody>
            {open.map((row) => {
              const party = db?.parties.find(
                (p) => p.id === row.voucher.partyId
              );
              const last = db
                ? lastReceiptForInvoice(db, row.voucher.id)
                : undefined;
              return (
                <tr key={row.voucher.id}>
                  <td className="font-mono text-sm"><VoucherNumberLink id={row.voucher.id} number={row.voucher.number} /></td>
                  <td>{row.voucher.date}</td>
                  <td>{row.voucher.dueDate || row.voucher.date}</td>
                  <td>
                    {party?.name || "—"}
                    {db && partyIsOverLimit(db, party?.id) ? (
                      <span className="ml-2 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--danger)]">
                        {t("accounts.overLimitBadge")}
                      </span>
                    ) : null}
                  </td>
                  <td>{formatInr(row.voucher.total, locale)}</td>
                  <td className="font-semibold">
                    {formatInr(row.outstanding, locale)}
                  </td>
                  <td className="text-sm">
                    {last ? (
                      <>
                        <VoucherNumberLink
                          id={last.voucherId}
                          number={last.number}
                        />
                        <span className="ml-1 text-[var(--ink-muted)]">
                          {formatInr(last.amount, locale)}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="text-sm">
                    {row.bucket === "current"
                      ? t("accounts.agingCurrent")
                      : `${row.daysOverdue}d`}
                    {leftoverByParty.get(row.voucher.partyId || "") ? (
                      <span className="ml-2 rounded-full bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--brand-deep)]">
                        {t("accounts.onAccount")}{" "}
                        {formatInr(
                          leftoverByParty.get(row.voucher.partyId || "") || 0,
                          locale
                        )}
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!open.length ? (
          <AccountsEmpty
            message={t("accounts.emptyReceivables")}
            href="/admin/accounts/vouchers?new=receipt"
            cta={t("accounts.emptyReceivablesCta")}
          />
        ) : null}
      </div>
    </AccountsShell>
  );
}
