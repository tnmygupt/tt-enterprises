"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import {
  allOpenReceivables,
  partyAging,
  partyBalance,
} from "@/lib/accounting";
import { ExportButtons } from "@/components/ExportButtons";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { checkCapability } from "@/lib/store/db";

export default function ReceivablesPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db } = useDb();
  const [partyId, setPartyId] = useState("");
  const asOf = new Date().toISOString().slice(0, 10);

  const open = useMemo(() => {
    if (!db) return [];
    const rows = allOpenReceivables(
      db.parties,
      db.vouchers,
      db.billAllocations ?? [],
      asOf
    );
    return partyId ? rows.filter((r) => r.voucher.partyId === partyId) : rows;
  }, [db, partyId, asOf]);

  const exportOptions = useMemo(
    () => ({
      title: t("accounts.receivables"),
      subtitle: `As of ${asOf}`,
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
          "sale"
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
      "sale"
    );
  }, [db, partyId, asOf]);

  if (!session || !checkCapability(session, db?.users, "manage_accounts")) {
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
      <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)]">
        {t("accounts.receivables")}
      </h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        {locale === "hi"
          ? "बिल-वार बकाया और एजिंग"
          : "Bill-wise outstanding and aging"}
      </p>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="tt-label">{t("accounts.customers")}</label>
          <select
            className="tt-select min-w-[220px]"
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
          >
            <option value="">
              {locale === "hi" ? "सभी ग्राहक" : "All customers"}
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
            ["current", locale === "hi" ? "चालू" : "Current"],
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

      <div className="tt-panel mt-4 overflow-x-auto">
        <table className="tt-table min-w-[820px]">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>Date</th>
              <th>Due</th>
              <th>Party</th>
              <th>Total</th>
              <th>{t("accounts.outstanding")}</th>
              <th>Aging</th>
            </tr>
          </thead>
          <tbody>
            {open.map((row) => {
              const party = db?.parties.find(
                (p) => p.id === row.voucher.partyId
              );
              return (
                <tr key={row.voucher.id}>
                  <td className="font-mono text-sm"><VoucherNumberLink id={row.voucher.id} number={row.voucher.number} /></td>
                  <td>{row.voucher.date}</td>
                  <td>{row.voucher.dueDate || row.voucher.date}</td>
                  <td>{party?.name || "—"}</td>
                  <td>{formatInr(row.voucher.total, locale)}</td>
                  <td className="font-semibold">
                    {formatInr(row.outstanding, locale)}
                  </td>
                  <td className="text-sm">
                    {row.bucket === "current"
                      ? locale === "hi"
                        ? "चालू"
                        : "Current"
                      : `${row.daysOverdue}d`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!open.length ? (
          <p className="p-4 text-sm text-[var(--ink-muted)]">
            {t("common.empty")}
          </p>
        ) : null}
      </div>
    </AccountsShell>
  );
}
