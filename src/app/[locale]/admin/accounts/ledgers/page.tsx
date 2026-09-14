"use client";

import { FormEvent, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { ExportButtons } from "@/components/ExportButtons";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { NumberField } from "@/components/NumberField";
import {
  ACCT,
  OWNER_SENSITIVE_ACCOUNTS,
  accountBalance,
} from "@/lib/accounting";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import {
  canViewFinancials,
  checkCapability,
  upsertAccount,
} from "@/lib/store/db";
import type { Account, AccountType } from "@/lib/types";

const SYSTEM_IDS = new Set(Object.values(ACCT));

export default function AccountsLedgersPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;
  const today = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    code: "",
    nameEn: "",
    nameHi: "",
    type: "expense" as AccountType,
    openingBalance: 0,
    bankBook: false,
  });
  const [editId, setEditId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const exportOptions = useMemo(
    () => ({
      title: t("accounts.ledgers"),
      subtitle: `As of ${today}`,
      filename: `ledgers-${today}.pdf`,
      columns: ["Code", "Name", "Type", "Balance"],
      rows: (db?.accounts ?? [])
        .filter((a) => a.active)
        .map((a) => {
          const sensitive =
            !isOwner && OWNER_SENSITIVE_ACCOUNTS.has(a.id);
          return [
            a.code,
            a.name[locale],
            a.type,
            sensitive
              ? "••••"
              : formatInr(
                  accountBalance(a, db?.ledgerEntries ?? [], today),
                  locale
                ),
          ];
        }),
    }),
    [db, isOwner, locale, t, today]
  );

  if (!session || !checkCapability(session, db, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const resetForm = () => {
    setForm({
      code: "",
      nameEn: "",
      nameHi: "",
      type: "expense",
      openingBalance: 0,
      bankBook: false,
    });
    setEditId(null);
  };

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    setMsg("");
    if (editId) {
      const existing = db?.accounts.find((a) => a.id === editId);
      if (!existing) return;
      const isSystem = SYSTEM_IDS.has(editId as (typeof ACCT)[keyof typeof ACCT]);
      upsertAccount({
        ...existing,
        code: form.code.trim() || existing.code,
        name: {
          en: form.nameEn.trim(),
          hi: form.nameHi.trim() || form.nameEn.trim(),
        },
        type: isSystem ? existing.type : form.type,
        openingBalance: isSystem
          ? existing.openingBalance
          : form.openingBalance,
        bankBook:
          form.type === "asset" || existing.type === "asset"
            ? form.bankBook
            : false,
        active: true,
      });
      setMsg(`Updated ${form.nameEn.trim()}`);
    } else {
      const account: Account = {
        id: `acct_${crypto.randomUUID()}`,
        code: form.code.trim(),
        name: {
          en: form.nameEn.trim(),
          hi: form.nameHi.trim() || form.nameEn.trim(),
        },
        type: form.type,
        openingBalance: form.openingBalance,
        active: true,
        bankBook: form.type === "asset" ? form.bankBook : false,
      };
      upsertAccount(account);
      setMsg(`Created ${account.name.en}`);
    }
    resetForm();
    refresh();
  };

  const startEdit = (a: Account) => {
    setEditId(a.id);
    setForm({
      code: a.code,
      nameEn: a.name.en,
      nameHi: a.name.hi,
      type: a.type,
      openingBalance: a.openingBalance,
      bankBook: !!a.bankBook || a.id === ACCT.bank,
    });
    setMsg("");
  };

  const deactivate = (a: Account) => {
    if (SYSTEM_IDS.has(a.id as (typeof ACCT)[keyof typeof ACCT])) {
      setMsg("System accounts cannot be deactivated");
      return;
    }
    upsertAccount({ ...a, active: false });
    setMsg(`Deactivated ${a.name.en}`);
    refresh();
  };

  return (
    <AccountsShell>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <AccountsPageHeader
            title={t("accounts.ledgers")}
          />
          <p className="mt-1 max-w-2xl text-sm text-[var(--ink-muted)]">
            {t("accounts.ledgersHint")}{" "}
            <Link
              href="/admin/accounts/journal"
              className="underline text-[var(--brand-deep)]"
            >
              {t("accounts.journal")}
            </Link>
            {" · "}
            <Link
              href="/admin/accounts/openings"
              className="underline text-[var(--brand-deep)]"
            >
              {t("accounts.openingBalances")}
            </Link>
          </p>
        </div>
      </div>

      <form
        onSubmit={onCreate}
        className="mt-6 grid max-w-2xl gap-3 rounded-2xl border border-[var(--line)] bg-white p-5 sm:grid-cols-2"
      >
        <p className="sm:col-span-2 text-sm font-semibold text-[var(--brand-deep)]">
          {editId ? t("accounts.editAccount") : t("accounts.addAccount")}
        </p>
        <input
          className="tt-input"
          placeholder="Code"
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
          required
        />
        <select
          className="tt-select"
          value={form.type}
          disabled={!!editId && SYSTEM_IDS.has(editId as never)}
          onChange={(e) =>
            setForm({ ...form, type: e.target.value as AccountType })
          }
        >
          <option value="asset">Asset</option>
          <option value="liability">Liability</option>
          <option value="income">Income</option>
          <option value="expense">Expense</option>
          <option value="equity">Equity</option>
        </select>
        <input
          className="tt-input"
          placeholder="Name EN"
          value={form.nameEn}
          onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
          required
        />
        <input
          className="tt-input"
          placeholder="Name HI"
          value={form.nameHi}
          onChange={(e) => setForm({ ...form, nameHi: e.target.value })}
        />
        <NumberField
          className="tt-input"
          placeholder="Opening balance"
          value={form.openingBalance}
          emptyAs={null}
          disabled={!!editId && SYSTEM_IDS.has(editId as never)}
          onValueChange={(v) =>
            setForm({
              ...form,
              openingBalance: typeof v === "number" ? v : 0,
            })
          }
        />
        {form.type === "asset" ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={form.bankBook}
              onChange={(e) =>
                setForm({ ...form, bankBook: e.target.checked })
              }
            />
            Show in Cash / Bank book &amp; receipt pay-from
          </label>
        ) : (
          <span />
        )}
        <div className="flex flex-wrap gap-2 sm:col-span-2">
          <button type="submit" className="tt-btn tt-btn-dark">
            {editId ? "Update" : t("common.save")}
          </button>
          {editId ? (
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={resetForm}
            >
              Cancel
            </button>
          ) : null}
        </div>
        {msg ? (
          <p className="sm:col-span-2 text-sm text-[var(--ok)]">{msg}</p>
        ) : null}
      </form>

      <div className="mt-4">
        <ExportButtons
          options={exportOptions}
          disabled={!(db?.accounts ?? []).some((a) => a.active)}
        />
      </div>

      <div className="tt-panel mt-6 overflow-x-auto">
        <table className="tt-table min-w-[700px]">
          <thead>
            <tr>
              <th>Code</th>
              <th>Name</th>
              <th>Type</th>
              <th>Balance</th>
              <th className="print:hidden">Actions</th>
            </tr>
          </thead>
          <tbody>
            {(db?.accounts ?? [])
              .filter((a) => a.active)
              .map((a) => {
                const sensitive =
                  !isOwner && OWNER_SENSITIVE_ACCOUNTS.has(a.id);
                const isSystem = SYSTEM_IDS.has(
                  a.id as (typeof ACCT)[keyof typeof ACCT]
                );
                return (
                  <tr key={a.id}>
                    <td className="font-mono text-sm">{a.code}</td>
                    <td>
                      {a.name[locale]}
                      {a.bankBook || a.id === ACCT.bank || a.id === ACCT.cash
                        ? " · cash/bank"
                        : ""}
                    </td>
                    <td className="capitalize">{a.type}</td>
                    <td>
                      {sensitive
                        ? "••••"
                        : formatInr(
                            accountBalance(
                              a,
                              db?.ledgerEntries ?? [],
                              today
                            ),
                            locale
                          )}
                    </td>
                    <td className="print:hidden">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="inline-flex min-h-11 items-center text-sm font-semibold text-[var(--brand-deep)] underline"
                          onClick={() => startEdit(a)}
                        >
                          Edit
                        </button>
                        {!isSystem ? (
                          <button
                            type="button"
                            className="inline-flex min-h-11 items-center text-sm text-[var(--danger)] underline"
                            onClick={() => deactivate(a)}
                          >
                            Deactivate
                          </button>
                        ) : null}
                        <Link
                          href={`/admin/accounts/ledger?account=${encodeURIComponent(a.id)}`}
                          className="inline-flex min-h-11 items-center text-sm underline text-[var(--ink-muted)]"
                        >
                          Ledger
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </AccountsShell>
  );
}
