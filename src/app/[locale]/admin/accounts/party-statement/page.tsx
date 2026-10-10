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
  invoiceSettlementLines,
  openInvoicesForParty,
  partyAging,
  partyBalance,
  partyGoodsLines,
} from "@/lib/accounting";
import { ExportButtons } from "@/components/ExportButtons";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr, roundMoney, unitLabel } from "@/lib/pricing";
import { canViewFinancials, checkCapability } from "@/lib/store/db";
import {
  contractLockMode,
  contractQtyLeft,
  contractValueLeft,
  isContractOpen,
} from "@/lib/contracts";
import {
  notifyPartyStatementWhatsApp,
  whatsappCountryCode,
  whatsappResultCopy,
} from "@/lib/whatsapp";

function PartyStatementInner() {
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
  const [range, setRange] = useAdminDateRange("mtd");
  const from = range.from;
  const to = range.to;
  const [partyId, setPartyId] = useState("");
  const [partyType, setPartyType] = useState<"all" | "customer" | "supplier">(
    "customer"
  );
  const [view, setView] = useState<"money" | "goods">("money");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    // URL query drives selected party — intentional sync
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
  // A supplier id can still arrive via the URL — block the data, not just the picker
  const blocked = party?.type === "supplier" && !canSeeSuppliers;
  const controlId =
    party?.type === "supplier" ? ACCT.creditors : ACCT.debtors;
  const allocations = useMemo(
    () => db?.billAllocations ?? [],
    [db]
  );

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
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [db, partyId, controlId, from, to]);

  const open = useMemo(() => {
    if (!db || !party) return [];
    return openInvoicesForParty(
      party.id,
      db.vouchers,
      allocations,
      to,
      party.type === "supplier" ? "purchase" : "sale",
      db.orders
    );
  }, [db, party, to, allocations]);

  const aging = useMemo(() => {
    if (!db || !party) return null;
    return partyAging(
      party.id,
      db.vouchers,
      allocations,
      to,
      party.type === "supplier" ? "purchase" : "sale",
      db.orders
    );
  }, [db, party, to, allocations]);

  const entriesWithBal = useMemo(() => {
    const out: { e: (typeof entries)[number]; bal: number }[] = [];
    let running = 0;
    for (const e of entries) {
      running = roundMoney(running + e.debit - e.credit);
      out.push({ e, bal: running });
    }
    return out;
  }, [entries]);

  const goods = useMemo(() => {
    if (!db || !party || blocked) return [];
    return partyGoodsLines(party, db.vouchers, from, to, db.orders);
  }, [blocked, db, from, party, to]);

  const openContracts = useMemo(() => {
    if (!db || !party || party.type !== "supplier" || blocked) return [];
    return (db.supplierContracts ?? []).filter(
      (c) => c.supplierId === party.id && isContractOpen(c, to)
    );
  }, [blocked, db, party, to]);

  const balance = party
    ? partyBalance(party, db?.ledgerEntries ?? [], to)
    : 0;

  const exportOptions = useMemo(() => {
    if (!party || blocked) {
      return {
        title: t("accounts.partyStatement"),
        filename: "party-statement.pdf",
        columns: ["Date", "Voucher", "Narration", "Debit", "Credit", "Balance"],
        rows: [] as string[][],
      };
    }
    if (view === "goods") {
      return {
        title: t("accounts.partyStatement"),
        subtitle: `${party.name} · Goods · ${from} → ${to}`,
        filename: `party-goods-${party.name}-${from}-${to}.pdf`,
        columns: [
          "Date",
          "Voucher",
          "Item",
          "Bundles",
          "Kg / Pcs",
          "Rate",
          "Amount",
        ],
        rows: goods.map((g) => [
          g.date,
          g.voucherNumber,
          g.itemLabel,
          g.bundles,
          `${g.secondaryQty}${g.unit ? ` ${unitLabel(g.unit as "kg", locale)}` : ""}`,
          formatInr(g.rate, locale),
          formatInr(g.amount, locale),
        ]),
      };
    }
    const moneyRows = entriesWithBal.map(({ e, bal }) => [
      e.date,
      e.voucherNumber,
      e.narration || e.voucherType,
      e.debit ? formatInr(e.debit, locale) : "",
      e.credit ? formatInr(e.credit, locale) : "",
      formatInr(bal, locale),
    ]);
    for (const r of open) {
      const due = r.voucher.dueDate || r.voucher.date;
      const days = Math.max(
        0,
        Math.floor(
          (new Date(to + "T00:00:00").getTime() -
            new Date(due + "T00:00:00").getTime()) /
            (24 * 60 * 60 * 1000)
        )
      );
      moneyRows.push([
        r.voucher.date,
        r.voucher.number,
        `Outstanding · due ${due} · ${days}d`,
        "",
        "",
        formatInr(r.outstanding, locale),
      ]);
    }
    for (const c of openContracts) {
      moneyRows.push([
        c.validFrom,
        c.number,
        `Contract · ${c.itemLabel} · left ${contractQtyLeft(c)} / ${formatInr(contractValueLeft(c), locale)}`,
        "",
        "",
        "",
      ]);
    }
    return {
      title: t("accounts.partyStatement"),
      subtitle: `${party.name} · ${from} → ${to} · Balance ${formatInr(balance, locale)}`,
      filename: `party-statement-${party.name}-${from}-${to}.pdf`,
      columns: ["Date", "Voucher", "Narration", "Debit", "Credit", "Balance"],
      rows: moneyRows,
    };
  }, [
    balance,
    blocked,
    entriesWithBal,
    from,
    goods,
    locale,
    open,
    openContracts,
    party,
    t,
    to,
    view,
  ]);

  if (!session || !checkCapability(session, db, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const sendStatement = () => {
    if (!party || !db || blocked) return;
    setMsg("");
    if (!party.phone?.trim()) {
      setMsg("Party has no phone number");
      return;
    }
    void notifyPartyStatementWhatsApp({
      phone: party.phone,
      partyName: party.name,
      companyName: db.settings.companyName,
      locale,
      from,
      to,
      balance,
      countryCode: whatsappCountryCode(db.settings),
      partyId: party.id,
      audience: "customer",
      outstandingLines: open.map((r) => ({
        number: r.voucher.number,
        due: r.voucher.dueDate || r.voucher.date,
        amount: r.outstanding,
      })),
    }).then((result) => {
      setMsg(
        whatsappResultCopy(result, {
          sent: t("common.whatsappSent"),
          opened: t("common.whatsappOpened"),
          fail: t("common.whatsappSendFailed"),
          noPhone: t("common.whatsappNoPhone"),
        })
      );
    });
  };

  return (
    <AccountsShell>
      <AccountsPageHeader
        title={
          partyType === "customer"
            ? t("accounts.customerLedger")
            : t("accounts.partyStatement")
        }
        hint={t("accounts.statementHint")}
      />

      <div className="mt-4 flex flex-wrap items-end gap-3 print:hidden">
        {canSeeSuppliers ? (
          <select
            className="tt-select"
            value={partyType}
            onChange={(e) =>
              setPartyType(e.target.value as "all" | "customer" | "supplier")
            }
          >
            <option value="all">{t("common.all")}</option>
            <option value="customer">{t("accounts.customers")}</option>
            <option value="supplier">{t("accounts.suppliers")}</option>
          </select>
        ) : null}
        <SearchSelect
          className="min-w-[220px]"
          options={partyOptions}
          value={partyId}
          onChange={setPartyId}
          placeholder={t("accounts.searchParty")}
          emptyLabel={t("accounts.selectParty")}
        />
        <DateRangeBar value={range} onChange={setRange} />
        <button
          type="button"
          className="tt-btn tt-btn-outline"
          onClick={() => window.print()}
        >
          {t("accounts.print")}
        </button>
        <ExportButtons options={exportOptions} disabled={!party || blocked} />
        <div className="flex rounded-xl border border-[var(--line)] p-0.5">
          <button
            type="button"
            className={`tt-btn ${view === "money" ? "tt-btn-dark" : "tt-btn-outline"} border-0`}
            onClick={() => setView("money")}
          >
            {t("accounts.viewMoney")}
          </button>
          <button
            type="button"
            className={`tt-btn ${view === "goods" ? "tt-btn-dark" : "tt-btn-outline"} border-0`}
            onClick={() => setView("goods")}
          >
            {t("accounts.viewGoods")}
          </button>
        </div>
        <button
          type="button"
          className="tt-btn tt-btn-dark"
          disabled={!party || blocked}
          onClick={sendStatement}
        >
          {t("accounts.sendStatement")}
        </button>
        {party && !blocked ? (
          <Link
            href={`/admin/accounts/match-statement?party=${party.id}&type=${party.type}`}
            className="tt-btn tt-btn-outline"
          >
            {t("accounts.matchTheirStatement")}
          </Link>
        ) : null}
      </div>

      {msg ? (
        <p className="mt-3 text-sm text-[var(--ok)] print:hidden">{msg}</p>
      ) : null}

      {blocked ? (
        <p className="mt-6 text-sm text-[var(--danger)]">
          {t("owner.ownerOnly")}
        </p>
      ) : party ? (
        <>
          <p className="mt-3 break-words text-sm">
            <strong>{party.name}</strong>
            {party.type === "customer" ? " · Debtor" : " · Creditor"}
            {party.phone ? ` · ${party.phone}` : ""}
            {party.gstin ? ` · ${party.gstin}` : ""}
            {" · "}
            {locale === "hi" ? "बकाया" : "Balance"}:{" "}
            <strong>{formatInr(balance, locale)}</strong>
          </p>
          {aging ? (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--ink-muted)]">
              <span>C {formatInr(aging.current, locale)}</span>
              <span>1–30 {formatInr(aging.d1_30, locale)}</span>
              <span>31–60 {formatInr(aging.d31_60, locale)}</span>
              <span>61–90 {formatInr(aging.d61_90, locale)}</span>
              <span>90+ {formatInr(aging.d90_plus, locale)}</span>
            </div>
          ) : null}

          <div className="mt-4">
            {view === "money" ? (
              <>
                <div className="tt-acct-cards sm:hidden">
                  {entriesWithBal.map(({ e, bal }) => (
                    <div key={e.id} className="tt-panel tt-acct-card">
                      <p className="text-xs text-[var(--ink-muted)]">
                        {e.date} · {e.voucherType}
                      </p>
                      <p className="font-mono text-sm font-semibold">
                        <VoucherNumberLink
                          id={e.voucherId}
                          number={e.voucherNumber}
                        />
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
                  ))}
                </div>
                <div className="tt-panel tt-acct-table-wrap hidden sm:block">
                  <table className="tt-table min-w-[720px]">
                    <thead>
                      <tr>
                        <th>{t("accounts.colDate")}</th>
                        <th>{t("accounts.colVoucher")}</th>
                        <th>{t("accounts.colDebit")}</th>
                        <th>{t("accounts.colCredit")}</th>
                        <th>{t("accounts.colBalance")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {entriesWithBal.map(({ e, bal }) => (
                        <tr key={e.id}>
                          <td>{e.date}</td>
                          <td className="font-mono text-sm">
                            <VoucherNumberLink
                              id={e.voucherId}
                              number={e.voucherNumber}
                            />{" "}
                            · {e.voucherType}
                          </td>
                          <td>{e.debit ? formatInr(e.debit, locale) : ""}</td>
                          <td>{e.credit ? formatInr(e.credit, locale) : ""}</td>
                          <td>{formatInr(bal, locale)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="tt-panel tt-acct-table-wrap">
              <table className="tt-table min-w-[880px]">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Voucher</th>
                    <th>Item</th>
                    <th>Bundles</th>
                    <th>Kg / Pcs</th>
                    <th>Rate</th>
                    <th>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {goods.map((g, i) => (
                    <tr key={`${g.voucherId}-${i}`}>
                      <td>{g.date}</td>
                      <td className="font-mono text-sm">
                        <VoucherNumberLink
                          id={g.voucherId}
                          number={g.voucherNumber}
                        />
                      </td>
                      <td className="max-w-[14rem] truncate text-sm">
                        {g.itemLabel}
                      </td>
                      <td className="tabular-nums">{g.bundles}</td>
                      <td className="tabular-nums">
                        {g.secondaryQty}
                        {g.unit
                          ? ` ${unitLabel(g.unit as "kg", locale)}`
                          : ""}
                      </td>
                      <td className="tabular-nums">
                        {formatInr(g.rate, locale)}
                      </td>
                      <td className="tabular-nums font-semibold">
                        {formatInr(g.amount, locale)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
            {view === "goods" && !goods.length ? (
              <AccountsEmpty message={t("accounts.emptyStatementNone")} />
            ) : null}
          </div>

          {openContracts.length ? (
            <div className="tt-panel mt-4 tt-acct-table-wrap">
              <p className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
                {locale === "hi" ? "खुले कॉन्ट्रैक्ट" : "Open contracts"}
              </p>
              <table className="tt-table min-w-[780px]">
                <thead>
                  <tr>
                    <th>No.</th>
                    <th>Item</th>
                    <th>Lock</th>
                    {isOwner ? <th>Rate</th> : null}
                    <th>Qty left</th>
                    {isOwner ? <th>₹ left</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {openContracts.map((c) => (
                    <tr key={c.id}>
                      <td className="font-mono text-sm">{c.number}</td>
                      <td className="text-sm">{c.itemLabel}</td>
                      <td className="capitalize">{contractLockMode(c)}</td>
                      {isOwner ? (
                        <td>
                          {formatInr(c.rate, locale)}/
                          {unitLabel(c.unit, locale)}
                        </td>
                      ) : null}
                      <td className="font-semibold">
                        {contractQtyLeft(c)} {unitLabel(c.unit, locale)}
                      </td>
                      {isOwner ? (
                        <td className="font-semibold">
                          {formatInr(contractValueLeft(c), locale)}
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          <div className="tt-panel mt-4 tt-acct-table-wrap">
            <p className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
              {t("accounts.outstanding")} (bill-wise)
            </p>
            <table className="tt-table min-w-[640px]">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>{t("accounts.dueDate")}</th>
                  <th>Days</th>
                  <th>{t("accounts.outstanding")}</th>
                  <th>{t("accounts.stmtLastReceipt")}</th>
                </tr>
              </thead>
              <tbody>
                {open.map((r) => {
                  const due = r.voucher.dueDate || r.voucher.date;
                  const days = Math.max(
                    0,
                    Math.floor(
                      (new Date(to + "T00:00:00").getTime() -
                        new Date(due + "T00:00:00").getTime()) /
                        (24 * 60 * 60 * 1000)
                    )
                  );
                  const lastPay = db
                    ? [...invoiceSettlementLines(
                        r.voucher.id,
                        db.vouchers,
                        allocations
                      )]
                        .reverse()
                        .find(
                          (s) => s.kind === "receipt" || s.kind === "payment"
                        )
                    : undefined;
                  return (
                    <tr key={r.voucher.id}>
                      <td className="font-mono text-sm">
                        <VoucherNumberLink
                          id={r.voucher.id}
                          number={r.voucher.number}
                        />
                      </td>
                      <td>{r.voucher.date}</td>
                      <td>{due}</td>
                      <td
                        className={
                          days > 30 ? "font-semibold text-[var(--danger)]" : ""
                        }
                      >
                        {days}
                      </td>
                      <td>{formatInr(r.outstanding, locale)}</td>
                      <td className="text-sm">
                        {lastPay ? (
                          <>
                            <VoucherNumberLink
                              id={lastPay.voucherId}
                              number={lastPay.number}
                            />
                            <span className="ml-1 text-[var(--ink-muted)]">
                              {formatInr(lastPay.amount, locale)}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!open.length ? (
              <AccountsEmpty message={t("accounts.emptyStatementNone")} />
            ) : null}
          </div>
        </>
      ) : (
        <AccountsEmpty message={t("accounts.emptyStatement")} />
      )}
    </AccountsShell>
  );
}

export default function PartyStatementPage() {
  return (
    <Suspense
      fallback={
        <AccountsShell>
          <p className="p-4 text-sm">Loading…</p>
        </AccountsShell>
      }
    >
      <PartyStatementInner />
    </Suspense>
  );
}
