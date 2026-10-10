"use client";

import { FormEvent, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { VoucherNumberLink } from "@/components/VoucherNumberLink";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { ExportButtons } from "@/components/ExportButtons";
import { FilePick } from "@/components/FilePick";
import { NumberField } from "@/components/NumberField";
import { ACCT, EXPENSE_PRESETS, accountBalance, cashBankAccounts } from "@/lib/accounting";
import { toDateInputValue } from "@/lib/date-range";
import { fileToDataUrl, useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import {
  canViewFinancials,
  checkCapability,
  recordExpense,
} from "@/lib/store/db";

export default function ExpensesPage() {
  const t = useTranslations();
  const { session } = useSession();
  const { db, refresh } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;
  const today = toDateInputValue();

  const [presetId, setPresetId] = useState(EXPENSE_PRESETS[0].id);
  const [accountId, setAccountId] = useState(EXPENSE_PRESETS[0].accountId);
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [payFrom, setPayFrom] = useState<string>(ACCT.cash);
  const [narration, setNarration] = useState("");
  const [billFile, setBillFile] = useState<File | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const presets = useMemo(
    () => EXPENSE_PRESETS.filter((p) => !p.ownerOnly || isOwner),
    [isOwner]
  );

  const otherExpenseHeads = useMemo(() => {
    if (!db) return [];
    const presetIds = new Set(EXPENSE_PRESETS.map((p) => p.accountId));
    return db.accounts
      .filter(
        (a) =>
          a.active &&
          a.type === "expense" &&
          !presetIds.has(a.id) &&
          a.id !== ACCT.purchase &&
          a.id !== ACCT.cogs &&
          (isOwner || !["acct_salary"].includes(a.id))
      )
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [db, isOwner]);

  const recent = useMemo(() => {
    if (!db) return [];
    const expenseIds = new Set(
      db.accounts.filter((a) => a.type === "expense").map((a) => a.id)
    );
    return db.vouchers
      .filter(
        (v) =>
          !v.voided &&
          v.type === "payment" &&
          v.lines[0]?.accountId &&
          expenseIds.has(v.lines[0].accountId)
      )
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .slice(0, 30);
  }, [db]);

  const payFromOpts = useMemo(
    () => cashBankAccounts(db?.accounts ?? []),
    [db]
  );

  const payFromBalances = useMemo(() => {
    if (!db) return [];
    return payFromOpts.map((a) => ({
      id: a.id,
      name: a.name.en,
      bal: accountBalance(a, db.ledgerEntries, today),
    }));
  }, [db, payFromOpts, today]);

  const exportOptions = useMemo(
    () => ({
      title: "Expenses",
      filename: `expenses-${today}.pdf`,
      columns: ["Date", "Voucher", "Head", "Paid from", "Amount", "Note"],
      rows: recent.map((v) => {
        const head = db?.accounts.find((a) => a.id === v.lines[0]?.accountId);
        const paid = db?.accounts.find((a) => a.id === v.cashAccountId);
        return [
          v.date,
          v.number,
          head?.name.en || v.lines[0]?.itemLabel || "—",
          paid?.name.en || "Cash",
          formatInr(v.total),
          v.narration || "",
        ];
      }),
    }),
    [db, recent, today]
  );

  if (!session || !checkCapability(session, db, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const pickPreset = (id: string) => {
    const p = EXPENSE_PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPresetId(id);
    setAccountId(p.accountId);
  };

  const onSave = async (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    setError("");
    setSaving(true);
    try {
      let packingSlipDataUrl: string | undefined;
      let packingSlipName: string | undefined;
      if (billFile) {
        packingSlipDataUrl = await fileToDataUrl(billFile);
        packingSlipName = billFile.name;
      }
      const v = recordExpense({
        accountId,
        amount: Number(amount) || 0,
        date,
        cashAccountId: payFrom,
        narration: narration || undefined,
        packingSlipDataUrl,
        packingSlipName,
        createdBy: session.id,
      });
      setMsg(`Saved ${v.number} · ${formatInr(v.total)}`);
      setAmount("");
      setNarration("");
      setBillFile(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AccountsShell focusMode>
      <AccountsPageHeader
        title={t("accounts.expenseTitle")}
        hint={t("accounts.expenseHint")}
        actions={
          <>
            <ExportButtons options={exportOptions} disabled={!recent.length} />
            <Link
              href="/admin/accounts/journal"
              className="tt-btn tt-btn-outline"
            >
              {t("accounts.journal")}
            </Link>
          </>
        }
      />

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {payFromBalances.map((b) => (
          <div key={b.id} className="tt-panel p-4">
            <p className="text-xs text-[var(--ink-muted)]">{b.name}</p>
            <p className="tt-display text-2xl text-[var(--brand-deep)]">
              {formatInr(b.bal)}
            </p>
          </div>
        ))}
      </div>

      {msg ? <p className="mt-3 text-sm text-[var(--ok)]">{msg}</p> : null}
      {error ? (
        <p className="mt-3 text-sm text-[var(--danger)]">{error}</p>
      ) : null}

      <form onSubmit={onSave} className="tt-panel mt-5 space-y-4 p-5">
        <div>
          <p className="tt-label mb-2">What did you pay for?</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`tt-btn min-h-12 min-w-[7rem] ${
                  presetId === p.id ? "tt-btn-dark" : "tt-btn-outline"
                }`}
                onClick={() => pickPreset(p.id)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {presetId === "misc" && otherExpenseHeads.length > 0 ? (
          <div>
            <label className="tt-label">Expense head</label>
            <select
              className="tt-select max-w-md"
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            >
              <option value={ACCT.miscExpense}>Misc. Expense</option>
              {otherExpenseHeads.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.code} · {a.name.en}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="tt-label">Amount</label>
            <NumberField
              className="tt-input text-lg"
              emptyAs={null}
              value={amount}
              onValueChange={(v) => setAmount(v === "" ? "" : String(v))}
              required
              autoFocus
            />
          </div>
          <div>
            <label className="tt-label">Date</label>
            <input
              type="date"
              className="tt-input"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="tt-label">Paid from</label>
            <select
              className="tt-select mt-1"
              value={payFrom}
              onChange={(e) => setPayFrom(e.target.value)}
            >
              {payFromOpts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name.en}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="tt-label">Note (optional)</label>
          <input
            className="tt-input"
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="e.g. Tempo to godown"
          />
        </div>

        <FilePick
          kind="photoOrPdf"
          value={billFile}
          onChange={(files) => setBillFile(files[0] || null)}
          label="Bill photo (optional)"
        />

        <button
          type="submit"
          className="tt-btn tt-btn-dark min-h-12 w-full sm:w-auto"
          disabled={saving}
        >
          {saving ? t("accounts.saving") : "Save expense"}
        </button>
      </form>

      <div className="tt-panel mt-5 tt-acct-table-wrap">
        <p className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">
          Recent expenses
        </p>
        <table className="tt-table min-w-[640px]">
          <thead>
            <tr>
              <th>Date</th>
              <th>Voucher</th>
              <th>Head</th>
              <th>From</th>
              <th>Amount</th>
              <th>Bill</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((v) => {
              const head = db?.accounts.find(
                (a) => a.id === v.lines[0]?.accountId
              );
              return (
                <tr key={v.id}>
                  <td>{v.date}</td>
                  <td><VoucherNumberLink id={v.id} number={v.number} /></td>
                  <td>{head?.name.en || v.lines[0]?.itemLabel}</td>
                  <td>
                    {db?.accounts.find((a) => a.id === v.cashAccountId)?.name
                      .en || "Cash"}
                  </td>
                  <td>{formatInr(v.total)}</td>
                  <td>
                    {v.packingSlipDataUrl ? (
                      <a
                        href={v.packingSlipDataUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm underline"
                      >
                        View
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!recent.length ? (
          <p className="p-4 text-sm text-[var(--ink-muted)]">
            No expenses logged yet.
          </p>
        ) : null}
      </div>
    </AccountsShell>
  );
}
