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
} from "@/lib/whatsapp";
import { toDateInputValue } from "@/lib/date-range";

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
    isOwner || (!!session && checkCapability(session, db?.users, "view_financials"));
  const today = toDateInputValue();
  const [partyId, setPartyId] = useState("");
  const [partyType, setPartyType] = useState<"all" | "customer" | "supplier">(
    "customer"
  );
  const [view, setView] = useState<"money" | "goods">("money");
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

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
      .filter((p) => {
        const hay = `${p.name} ${p.phone} ${p.gstin ?? ""}`.toLowerCase();
        return hay.includes(q.trim().toLowerCase());
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [db, partyType, q, canSeeSuppliers]);

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
      party.type === "supplier" ? "purchase" : "sale"
    );
  }, [db, party, to, allocations]);

  const aging = useMemo(() => {
    if (!db || !party) return null;
    return partyAging(
      party.id,
      db.vouchers,
      allocations,
      to,
      party.type === "supplier" ? "purchase" : "sale"
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
    return partyGoodsLines(party, db.vouchers, from, to);
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

  if (!session || !checkCapability(session, db?.users, "manage_accounts")) {
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
    }).then((ok) => {
      setMsg(
        ok
          ? t("common.whatsappOpened")
          : "Could not open WhatsApp"
      );
    });
  };

  return (
    <AccountsShell>
      <h1 className="tt-display text-2xl sm:text-4xl text-[var(--brand-deep)] print:text-2xl">
        {partyType === "customer"
          ? t("accounts.customerLedger")
          : t("accounts.partyStatement")}
      </h1>
      <p className="mt-1 text-sm text-[var(--ink-muted)] print:hidden">
        {locale === "hi"
          ? "ग्राहक चुनें — लेजर देखें, PDF लें या WhatsApp पर भेजें"
          : "Pick a customer to see ledger, export PDF, or send on WhatsApp"}
      </p>

      <div className="mt-4 flex flex-wrap gap-3 print:hidden">
        <input
          className="tt-input min-w-[180px]"
          placeholder={t("accounts.searchParty")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
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
        <select
          className="tt-select min-w-[220px]"
          value={partyId}
          onChange={(e) => setPartyId(e.target.value)}
        >
          <option value="">
            {locale === "hi" ? "पार्टी चुनें…" : "Select party…"}
          </option>
          {parties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} ({p.type === "customer" ? "Debtor" : "Creditor"})
            </option>
          ))}
        </select>
        <input
          type="date"
          className="tt-input"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
        <input
          type="date"
          className="tt-input"
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
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
            {locale === "hi" ? "पैसे" : "Money"}
          </button>
          <button
            type="button"
            className={`tt-btn ${view === "goods" ? "tt-btn-dark" : "tt-btn-outline"} border-0`}
            onClick={() => setView("goods")}
          >
            {locale === "hi" ? "माल (रेट/किग्रा)" : "Goods (rate/kg)"}
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
            Match their statement
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

          <div className="tt-panel mt-4 overflow-x-auto">
            {view === "money" ? (
              <table className="tt-table min-w-[720px]">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Voucher</th>
                    <th>Debit</th>
                    <th>Credit</th>
                    <th>Balance</th>
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
            ) : (
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
            )}
            {view === "goods" && !goods.length ? (
              <p className="p-4 text-sm text-[var(--ink-muted)]">
                {t("common.empty")}
              </p>
            ) : null}
          </div>

          {openContracts.length ? (
            <div className="tt-panel mt-4 overflow-x-auto">
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

          <div className="tt-panel mt-4 overflow-x-auto">
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
        </>
      ) : (
        <p className="mt-6 text-sm text-[var(--ink-muted)]">
          {locale === "hi"
            ? "स्टेटमेंट देखने के लिए पार्टी चुनें।"
            : "Select a party to view the statement."}
        </p>
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
