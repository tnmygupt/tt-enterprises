"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsShell } from "@/components/AccountsShell";
import {
  allOpenPayables,
  creditorsClosingList,
  partyAging,
  partyBalance,
  paymentPlanPayables,
} from "@/lib/accounting";
import { ExportButtons } from "@/components/ExportButtons";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import { canViewFinancials, checkCapability } from "@/lib/store/db";

export default function PayablesPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db } = useDb();
  // Supplier payables (money owed) are owner-only
  const canSeeAmounts = session ? canViewFinancials(session.role) : false;
  const [partyId, setPartyId] = useState("");
  const [tab, setTab] = useState<"outstanding" | "plan" | "creditors">("plan");
  const asOf = new Date().toISOString().slice(0, 10);

  const open = useMemo(() => {
    if (!db) return [];
    if (tab === "creditors") return [];
    const rows =
      tab === "plan"
        ? paymentPlanPayables(
            db.parties,
            db.vouchers,
            db.billAllocations ?? [],
            asOf
          )
        : allOpenPayables(
            db.parties,
            db.vouchers,
            db.billAllocations ?? [],
            asOf
          );
    return partyId ? rows.filter((r) => r.voucher.partyId === partyId) : rows;
  }, [db, partyId, asOf, tab]);

  const creditors = useMemo(() => {
    if (!db) return [];
    const rows = creditorsClosingList(
      db.parties,
      db.vouchers,
      db.billAllocations ?? [],
      db.ledgerEntries,
      asOf
    );
    return partyId ? rows.filter((r) => r.partyId === partyId) : rows;
  }, [db, partyId, asOf]);

  const creditorsTotal = useMemo(
    () => creditors.reduce((s, r) => s + r.closing, 0),
    [creditors]
  );

  const exportOptions = useMemo(
    () => ({
      title: `${t("accounts.payables")} — ${tab === "plan" ? t("accounts.paymentPlan") : t("accounts.outstanding")}`,
      subtitle: `As of ${asOf}`,
      filename: `payables-${tab}-${asOf}.pdf`,
      columns: [
        "Bill",
        "Date",
        "Due",
        "Supplier",
        "Total",
        "Outstanding",
        "Status",
      ],
      rows: open.map((row) => {
        const party =
          db?.parties.find((p) => p.id === row.voucher.partyId)?.name || "—";
        const due = row.voucher.dueDate || row.voucher.date;
        const status =
          due < asOf
            ? locale === "hi"
              ? "ओवरड्यू"
              : "Overdue"
            : due === asOf
              ? locale === "hi"
                ? "आज"
                : "Due today"
              : locale === "hi"
                ? "नियोजित"
                : "Planned";
        const amt = (n: number) =>
          canSeeAmounts ? formatInr(n, locale) : "••••";
        return [
          row.voucher.number,
          row.voucher.date,
          due,
          party,
          amt(row.voucher.total),
          amt(row.outstanding),
          status,
        ];
      }),
    }),
    [asOf, canSeeAmounts, db, locale, open, t, tab]
  );

  const aging = useMemo(() => {
    const empty = {
      current: 0,
      d1_30: 0,
      d31_60: 0,
      d61_90: 0,
      d90_plus: 0,
      total: 0,
    };
    if (!db) return empty;
    const suppliers = db.parties.filter(
      (x) => x.active && x.type === "supplier"
    );
    const list = partyId
      ? suppliers.filter((p) => p.id === partyId)
      : suppliers;
    for (const p of list) {
      const a = partyAging(
        p.id,
        db.vouchers,
        db.billAllocations ?? [],
        asOf,
        "purchase"
      );
      empty.current += a.current;
      empty.d1_30 += a.d1_30;
      empty.d31_60 += a.d31_60;
      empty.d61_90 += a.d61_90;
      empty.d90_plus += a.d90_plus;
      empty.total += a.total;
    }
    return empty;
  }, [db, partyId, asOf]);

  if (!session || !checkCapability(session, db?.users, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const suppliers =
    db?.parties.filter((p) => p.active && p.type === "supplier") ?? [];

  const money = (n: number) =>
    canSeeAmounts ? formatInr(n, locale) : "••••";

  return (
    <AccountsShell>
      <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)]">
        {t("accounts.payables")}
      </h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)]">
        {t("accounts.payablesHint")}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className={`tt-btn ${tab === "plan" ? "tt-btn-dark" : "tt-btn-outline"}`}
          onClick={() => setTab("plan")}
        >
          {t("accounts.paymentPlan")}
        </button>
        <button
          type="button"
          className={`tt-btn ${tab === "outstanding" ? "tt-btn-dark" : "tt-btn-outline"}`}
          onClick={() => setTab("outstanding")}
        >
          Bills payable
        </button>
        <button
          type="button"
          className={`tt-btn ${tab === "creditors" ? "tt-btn-dark" : "tt-btn-outline"}`}
          onClick={() => setTab("creditors")}
        >
          Creditors closing
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="tt-label">{t("accounts.suppliers")}</label>
          <select
            className="tt-select min-w-[220px]"
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
          >
            <option value="">
              {locale === "hi" ? "सभी सप्लायर" : "All suppliers"}
            </option>
            {suppliers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        {tab !== "creditors" ? (
          <ExportButtons options={exportOptions} />
        ) : null}
        <Link
          href="/admin/accounts/vouchers?new=payment"
          className="tt-btn tt-btn-dark"
        >
          {t("accounts.newPayment")}
        </Link>
      </div>

      {tab !== "creditors" ? (
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
              {money(aging[key])}
            </p>
          </div>
        ))}
      </div>
      ) : null}

      {partyId ? (
        <p className="mt-3 text-sm text-[var(--ink-muted)]">
          {locale === "hi" ? "सप्लायर बकाया" : "Supplier payable"}:{" "}
          <strong>
            {money(
              partyBalance(
                suppliers.find((p) => p.id === partyId)!,
                db?.ledgerEntries ?? []
              )
            )}
          </strong>
        </p>
      ) : null}

      {tab === "plan" ? (
        <p className="mt-3 text-xs text-[var(--ink-muted)]">
          {locale === "hi"
            ? "ओवरड्यू पहले, फिर देय तिथि के अनुसार — भुगतान योजना।"
            : "Overdue first, then by due date — your payment plan."}
        </p>
      ) : null}

      {tab === "creditors" ? (
        <>
          <div className="tt-panel mt-4 flex flex-wrap items-end justify-between gap-3 p-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
                Creditors control closing
              </p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--brand-deep)]">
                {money(creditorsTotal)}
              </p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">
                Party ledger closing vs open bills. Advance payments lower
                closing below bill totals.
              </p>
            </div>
            <ExportButtons
              options={{
                title: "Creditors closing",
                subtitle: `As of ${asOf}`,
                filename: `creditors-closing-${asOf}.pdf`,
                columns: [
                  "Supplier",
                  "Closing",
                  "Bills outstanding",
                  "Open bills",
                ],
                rows: creditors.map((r) => [
                  r.name,
                  canSeeAmounts ? formatInr(r.closing, locale) : "••••",
                  canSeeAmounts
                    ? formatInr(r.billsOutstanding, locale)
                    : "••••",
                  r.billCount,
                ]),
              }}
            />
          </div>
          <div className="tt-panel mt-4 overflow-x-auto">
            <table className="tt-table min-w-[720px]">
              <thead>
                <tr>
                  <th>Supplier</th>
                  <th className="text-right">Closing amount</th>
                  <th className="text-right">Bills payable</th>
                  <th className="text-right">Open bills</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {creditors.map((r) => (
                  <tr key={r.partyId}>
                    <td className="font-medium">{r.name}</td>
                    <td className="text-right font-semibold tabular-nums">
                      {money(r.closing)}
                    </td>
                    <td className="text-right tabular-nums">
                      {money(r.billsOutstanding)}
                    </td>
                    <td className="text-right tabular-nums">{r.billCount}</td>
                    <td className="text-right">
                      <Link
                        href={`/admin/accounts/vouchers?new=payment&party=${r.partyId}`}
                        className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand)]"
                      >
                        {t("accounts.payNow")}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!creditors.length ? (
              <p className="p-4 text-sm text-[var(--ink-muted)]">
                {t("common.empty")}
              </p>
            ) : null}
          </div>
        </>
      ) : (
        <div className="tt-panel mt-4 overflow-x-auto">
          <table className="tt-table min-w-[860px]">
            <thead>
              <tr>
                <th>Bill</th>
                <th>Date</th>
                <th>Due</th>
                <th>{t("accounts.suppliers")}</th>
                <th>Total</th>
                <th>{t("accounts.outstanding")}</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {open.map((row) => {
                const party = db?.parties.find(
                  (p) => p.id === row.voucher.partyId
                );
                const due = (row.voucher.dueDate || row.voucher.date).slice(
                  0,
                  10
                );
                const overdue = due < asOf;
                const dueToday = due === asOf;
                return (
                  <tr key={row.voucher.id}>
                    <td className="font-mono text-sm">
                      <VoucherNumberLink
                        id={row.voucher.id}
                        number={row.voucher.number}
                      />
                    </td>
                    <td>{row.voucher.date}</td>
                    <td
                      className={
                        overdue
                          ? "font-semibold text-[var(--danger)]"
                          : dueToday
                            ? "font-semibold text-[var(--brand-deep)]"
                            : ""
                      }
                    >
                      {due}
                    </td>
                    <td>{party?.name || "—"}</td>
                    <td>{money(row.voucher.total)}</td>
                    <td className="font-semibold">{money(row.outstanding)}</td>
                    <td className="text-sm">
                      {overdue
                        ? locale === "hi"
                          ? `ओवरड्यू ${row.daysOverdue}द`
                          : `Overdue ${row.daysOverdue}d`
                        : dueToday
                          ? locale === "hi"
                            ? "आज देय"
                            : "Due today"
                          : locale === "hi"
                            ? "आने वाला"
                            : "Upcoming"}
                    </td>
                    <td>
                      <Link
                        href={`/admin/accounts/vouchers?new=payment&party=${row.voucher.partyId}`}
                        className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand)]"
                      >
                        {t("accounts.payNow")}
                      </Link>
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
      )}
    </AccountsShell>
  );
}
