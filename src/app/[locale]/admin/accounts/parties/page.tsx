"use client";

import { FormEvent, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { ExportButtons } from "@/components/ExportButtons";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AccountsShell } from "@/components/AccountsShell";
import { NumberField } from "@/components/NumberField";
import { partyBalance } from "@/lib/accounting";
import { useDb, useSession } from "@/lib/hooks";
import { formatInr } from "@/lib/pricing";
import {
  canViewFinancials,
  checkCapability,
  setPartyOpeningBalance,
  upsertParty,
} from "@/lib/store/db";
import type { Party, PartyType } from "@/lib/types";

export default function AccountsPartiesPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const isOwner = session ? canViewFinancials(session.role) : false;
  const [form, setForm] = useState({
    name: "",
    phone: "",
    type: "customer" as PartyType,
    address: "",
    pincode: "",
    gstin: "",
    creditLimit: "",
    minOrderQty: "",
    leadTimeDays: "",
    openingBalance: "",
  });

  const exportOptions = useMemo(
    () => ({
      title: t("accounts.parties"),
      filename: `parties-${new Date().toISOString().slice(0, 10)}.pdf`,
      columns: [
        "Name",
        "Type",
        "Phone",
        "Pincode",
        "Credit Limit",
        "Balance",
      ],
      rows: (db?.parties ?? [])
        .filter((p) => p.active)
        .map((p) => [
          p.name,
          p.type,
          p.phone,
          p.pincode || "—",
          p.creditLimit ? formatInr(p.creditLimit, locale) : "—",
          p.type === "supplier" && !isOwner
            ? "••••"
            : formatInr(partyBalance(p, db?.ledgerEntries ?? []), locale),
        ]),
    }),
    [db, isOwner, locale, t]
  );

  if (!session || !checkCapability(session, db, "manage_accounts")) {
    return (
      <AccountsShell>
        <AdminAccessDenied />
      </AccountsShell>
    );
  }

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    const opening =
      isOwner && form.openingBalance
        ? Number(form.openingBalance) || 0
        : 0;
    const party: Party = {
      id: `party_${crypto.randomUUID()}`,
      name: form.name.trim(),
      phone: form.phone.trim(),
      type: form.type,
      openingBalance: 0,
      address: form.address.trim() || undefined,
      pincode: form.pincode.replace(/\D/g, "").slice(0, 6) || undefined,
      gstin: form.gstin.trim() || undefined,
      creditLimit: form.creditLimit
        ? Number(form.creditLimit) || undefined
        : undefined,
      minOrderQty:
        form.type === "supplier" && form.minOrderQty
          ? Number(form.minOrderQty) || undefined
          : undefined,
      leadTimeDays:
        form.type === "supplier" && form.leadTimeDays
          ? Number(form.leadTimeDays) || undefined
          : undefined,
      active: true,
      createdAt: new Date().toISOString(),
    };
    upsertParty(party);
    if (opening > 0) setPartyOpeningBalance(party.id, opening);
    setForm({
      name: "",
      phone: "",
      type: "customer",
      address: "",
      pincode: "",
      gstin: "",
      creditLimit: "",
      minOrderQty: "",
      leadTimeDays: "",
      openingBalance: "",
    });
    refresh();
  };

  return (
    <AccountsShell>
      <AccountsPageHeader
        title={t("accounts.parties")}
        actions={
          isOwner ? (
            <Link
              href="/admin/accounts/openings"
              className="tt-btn tt-btn-outline"
            >
              {t("accounts.openingBalancesLink")}
            </Link>
          ) : null
        }
      />

      <form
        id="new-party"
        onSubmit={onCreate}
        className="mt-6 grid max-w-2xl gap-3 rounded-2xl border border-[var(--line)] bg-white p-5 sm:grid-cols-2"
      >
        <p className="sm:col-span-2 text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
          {t("accounts.newParty")}
        </p>
        <div>
          <label className="tt-label">{t("common.name")}</label>
          <input
            className="tt-input"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="tt-label">{t("common.phone")}</label>
          <input
            className="tt-input"
            value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="tt-label">{t("common.type")}</label>
          <select
            className="tt-select"
            value={form.type}
            onChange={(e) =>
              setForm({ ...form, type: e.target.value as PartyType })
            }
          >
            <option value="customer">{t("accounts.customers")}</option>
            <option value="supplier">{t("accounts.suppliers")}</option>
          </select>
        </div>
        <div>
          <label className="tt-label">{t("checkout.gstAadhar")}</label>
          <input
            className="tt-input"
            value={form.gstin}
            onChange={(e) => setForm({ ...form, gstin: e.target.value })}
          />
        </div>
        <div>
          <label className="tt-label">{t("auth.address")}</label>
          <input
            className="tt-input"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>
        <div>
          <label className="tt-label">{t("auth.pincode")}</label>
          <input
            className="tt-input"
            type="tel"
            inputMode="numeric"
            maxLength={6}
            value={form.pincode}
            onChange={(e) =>
              setForm({
                ...form,
                pincode: e.target.value.replace(/\D/g, "").slice(0, 6),
              })
            }
          />
        </div>
        <div>
          <label className="tt-label">{t("accounts.creditLimit")}</label>
          <NumberField
            className="tt-input"
            min={0}
            emptyAs={null}
            value={form.creditLimit}
            onValueChange={(v) =>
              setForm({
                ...form,
                creditLimit: v === "" ? "" : String(v),
              })
            }
          />
        </div>
        {form.type === "supplier" ? (
          <>
            <div>
              <label className="tt-label">{t("accounts.supplierMoq")}</label>
              <NumberField
                className="tt-input"
                min={0}
                integer
                emptyAs={null}
                value={form.minOrderQty}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    minOrderQty: v === "" ? "" : String(v),
                  })
                }
              />
            </div>
            <div>
              <label className="tt-label">{t("accounts.supplierLeadTime")}</label>
              <NumberField
                className="tt-input"
                min={0}
                integer
                emptyAs={null}
                value={form.leadTimeDays}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    leadTimeDays: v === "" ? "" : String(v),
                  })
                }
              />
            </div>
          </>
        ) : null}
        {isOwner ? (
          <div>
            <label className="tt-label">Opening balance</label>
            <NumberField
              className="tt-input"
              min={0}
              emptyAs={null}
              value={form.openingBalance}
              onValueChange={(v) =>
                setForm({
                  ...form,
                  openingBalance: v === "" ? "" : String(v),
                })
              }
            />
          </div>
        ) : null}
        <button type="submit" className="tt-btn tt-btn-dark sm:col-span-2">
          {t("common.save")}
        </button>
      </form>

      <div className="mt-4">
        <ExportButtons
          options={exportOptions}
          disabled={!(db?.parties ?? []).some((p) => p.active)}
        />
      </div>

      <div className="tt-panel mt-6 overflow-x-auto">
        <table className="tt-table min-w-[820px]">
          <thead>
            <tr>
              <th>{t("common.name")}</th>
              <th>{t("common.type")}</th>
              <th>{t("common.phone")}</th>
              <th>{t("auth.pincode")}</th>
              <th>{t("accounts.creditLimit")}</th>
              <th>{t("accounts.supplierMoq")}</th>
              <th>{t("accounts.supplierLeadTime")}</th>
              <th>{t("common.balance")}</th>
              <th>{locale === "hi" ? "क्रिया" : "Actions"}</th>
            </tr>
          </thead>
          <tbody>
            {(db?.parties ?? [])
              .filter((p) => p.active)
              .map((p) => (
                <tr key={p.id}>
                  <td className="max-w-[12rem]">
                    <div className="truncate font-medium">{p.name}</div>
                    {p.gstin ? (
                      <div className="text-xs text-[var(--ink-muted)]">
                        {p.gstin}
                      </div>
                    ) : null}
                  </td>
                  <td className="capitalize">{p.type}</td>
                  <td className="font-mono text-sm">{p.phone}</td>
                  <td className="font-mono text-sm">{p.pincode || "—"}</td>
                  <td>
                    {p.creditLimit
                      ? formatInr(p.creditLimit, locale)
                      : "—"}
                  </td>
                  <td>
                    {p.type === "supplier" ? (
                      <NumberField
                        className="tt-input w-20"
                        min={0}
                        integer
                        emptyAs={null}
                        value={p.minOrderQty ?? ""}
                        onValueChange={(v) => {
                          upsertParty({
                            ...p,
                            minOrderQty:
                              typeof v === "number" && v > 0 ? v : undefined,
                          });
                          refresh();
                        }}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {p.type === "supplier" ? (
                      <NumberField
                        className="tt-input w-20"
                        min={0}
                        integer
                        emptyAs={null}
                        value={p.leadTimeDays ?? ""}
                        onValueChange={(v) => {
                          upsertParty({
                            ...p,
                            leadTimeDays:
                              typeof v === "number" && v > 0 ? v : undefined,
                          });
                          refresh();
                        }}
                      />
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    {p.type === "supplier" && !isOwner
                      ? "••••"
                      : formatInr(
                          partyBalance(p, db?.ledgerEntries ?? []),
                          locale
                        )}
                  </td>
                  <td>
                    <div className="flex flex-wrap gap-2 text-sm font-semibold">
                      <Link
                        href={`/admin/accounts/party-statement?party=${encodeURIComponent(p.id)}&type=${p.type === "supplier" ? "supplier" : "customer"}`}
                        className="inline-flex min-h-11 items-center text-[var(--brand)] hover:underline"
                      >
                        {p.type === "customer"
                          ? t("accounts.customerLedger")
                          : t("accounts.partyStatement")}
                      </Link>
                      {p.type === "customer" ? (
                        <Link
                          href={`/admin/accounts/vouchers?new=credit_note&party=${encodeURIComponent(p.id)}`}
                          className="inline-flex min-h-11 items-center text-[var(--brand-deep)] hover:underline"
                        >
                          {t("accounts.postReturn")}
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {!(db?.parties ?? []).some((p) => p.active) ? (
          <AccountsEmpty
            message={t("accounts.emptyParties")}
            href="#new-party"
            cta={t("accounts.emptyPartiesCta")}
          />
        ) : null}
      </div>
    </AccountsShell>
  );
}
