"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminShell } from "@/components/AdminShell";
import { useDb, useSession } from "@/lib/hooks";
import {
  approvalKindLabel,
  pendingOwnerApprovals,
  type SellingRateSnapshot,
  type SchemeAssignSnapshot,
} from "@/lib/owner-approvals";
import { formatInr } from "@/lib/pricing";
import { checkCapability, decideOwnerApproval } from "@/lib/store/db";
import type { OwnerApproval, Scheme } from "@/lib/types";

function RateDiff({
  approval,
  locale,
}: {
  approval: OwnerApproval;
  locale: "en" | "hi";
}) {
  const before = approval.snapshot.before as SellingRateSnapshot | undefined;
  const proposed = approval.snapshot.proposed as SellingRateSnapshot | undefined;
  if (!proposed) return null;
  const ids = new Set([
    ...(before?.variations ?? []).map((v) => v.id),
    ...proposed.variations.map((v) => v.id),
  ]);
  return (
    <div className="mt-2 overflow-x-auto text-sm">
      <table className="tt-table min-w-[280px]">
        <thead>
          <tr>
            <th></th>
            <th>{locale === "hi" ? "लाइव" : "Live"}</th>
            <th>{locale === "hi" ? "प्रस्तावित" : "Proposed"}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>baseRate</td>
            <td className="tabular-nums">{formatInr(before?.baseRate ?? 0, locale)}</td>
            <td className="tabular-nums font-semibold text-[var(--brand-deep)]">
              {formatInr(proposed.baseRate, locale)}
            </td>
          </tr>
          {[...ids].map((id) => {
            const b = before?.variations.find((v) => v.id === id);
            const p = proposed.variations.find((v) => v.id === id);
            return (
              <tr key={id}>
                <td className="font-mono text-xs">{id}</td>
                <td className="tabular-nums">{formatInr(b?.rate ?? 0, locale)}</td>
                <td className="tabular-nums font-semibold text-[var(--brand-deep)]">
                  {formatInr(p?.rate ?? 0, locale)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SchemeDiff({ approval, locale }: { approval: OwnerApproval; locale: "en" | "hi" }) {
  const before = approval.snapshot.before as Scheme | undefined;
  const proposed = approval.snapshot.proposed as Scheme | undefined;
  const row = (label: string, from: string, to: string) => (
    <div className="flex flex-wrap justify-between gap-2 text-sm">
      <span className="text-[var(--ink-muted)]">{label}</span>
      <span>
        <span className="tabular-nums">{from || "—"}</span>
        <span className="px-1 text-[var(--ink-muted)]">→</span>
        <span className="font-semibold text-[var(--brand-deep)]">{to || "—"}</span>
      </span>
    </div>
  );
  if (approval.kind === "scheme_delete") {
    return (
      <p className="mt-2 text-sm text-[var(--danger)]">
        {locale === "hi" ? "स्कीम लाइव सूची से हट जाएगी।" : "Scheme will be removed from the live list."}
        {before?.name?.[locale] || before?.name?.en
          ? ` (${before.name[locale] || before.name.en})`
          : ""}
      </p>
    );
  }
  if (approval.kind === "scheme_assign") {
    const proposedAssign = approval.snapshot.proposed as SchemeAssignSnapshot | undefined;
    return (
      <p className="mt-2 text-sm">
        {proposedAssign?.assigned === false
          ? locale === "hi"
            ? "स्कीम डीलर से हटेगी।"
            : "Scheme will be unassigned from the dealer."
          : locale === "hi"
            ? "स्कीम डीलर को असाइन होगी।"
            : "Scheme will be assigned to the dealer."}
      </p>
    );
  }
  if (!proposed) return null;
  return (
    <div className="mt-2 space-y-1">
      {row(
        locale === "hi" ? "नाम" : "Name",
        before?.name?.[locale] || before?.name?.en || "",
        proposed.name?.[locale] || proposed.name?.en || ""
      )}
      {row(
        locale === "hi" ? "सक्रिय" : "Active",
        before ? (before.active ? "yes" : "no") : "—",
        proposed.active ? "yes" : "no"
      )}
      {row("type", before?.rewardType || "", proposed.rewardType)}
    </div>
  );
}

export default function OwnerApprovalsPage() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const { session } = useSession();
  const { db, refresh } = useDb();
  const [note, setNote] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState("");

  const isOwner = checkCapability(session, db, "view_financials");
  const canView =
    isOwner ||
    checkCapability(session, db, "manage_products") ||
    checkCapability(session, db, "manage_schemes");

  const pending = useMemo(
    () => pendingOwnerApprovals(db?.ownerApprovals),
    [db?.ownerApprovals]
  );

  if (!session || !canView) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  const decide = (id: string, status: "approved" | "rejected") => {
    try {
      decideOwnerApproval(id, status, note[id]);
      setMsg(
        status === "approved"
          ? locale === "hi"
            ? "अप्रूव — लाइव कैटलॉग अपडेट"
            : "Approved — live catalog updated"
          : locale === "hi"
            ? "रिजेक्ट"
            : "Rejected"
      );
      refresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed");
    }
  };

  return (
    <AdminShell>
      <div>
        <p className="text-xs font-bold uppercase tracking-wide text-[var(--ink-muted)]">
          {isOwner ? "Owner" : "Staff"}
        </p>
        <h1 className="tt-h2 mt-1">{t("admin.approvals")}</h1>
        <p className="mt-1 text-sm text-[var(--ink-muted)]">{t("admin.approvalsHint")}</p>
        {!isOwner ? (
          <p className="mt-2 text-sm text-[var(--brand-deep)]">{t("admin.approvalReadOnly")}</p>
        ) : null}
      </div>

      {msg ? (
        <p className="mt-3 text-sm font-medium text-[var(--brand-deep)]">{msg}</p>
      ) : null}

      {pending.length === 0 ? (
        <p className="tt-panel mt-5 p-5 text-sm text-[var(--ink-muted)]">
          {t("admin.approvalEmpty")}
        </p>
      ) : (
        <ul className="mt-5 space-y-4">
          {pending.map((row) => (
            <li key={row.id} className="tt-panel p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-[var(--brand)]">
                    {approvalKindLabel(row.kind, locale)}
                  </p>
                  <h2 className="mt-0.5 font-semibold">{row.title}</h2>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {row.requestedByName || row.requestedBy} ·{" "}
                    {row.requestedAt.slice(0, 16).replace("T", " ")}
                  </p>
                </div>
              </div>
              {row.kind === "product_rates" ? (
                <RateDiff approval={row} locale={locale} />
              ) : (
                <SchemeDiff approval={row} locale={locale} />
              )}
              {isOwner ? (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <input
                    className="tt-input max-w-xs"
                    placeholder={t("admin.approvalNote")}
                    value={note[row.id] ?? ""}
                    onChange={(e) =>
                      setNote((prev) => ({ ...prev, [row.id]: e.target.value }))
                    }
                  />
                  <button
                    type="button"
                    className="tt-btn tt-btn-dark"
                    onClick={() => decide(row.id, "approved")}
                  >
                    {t("admin.approve")}
                  </button>
                  <button
                    type="button"
                    className="tt-btn tt-btn-outline text-[var(--danger)]"
                    onClick={() => decide(row.id, "rejected")}
                  >
                    {t("admin.reject")}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </AdminShell>
  );
}
