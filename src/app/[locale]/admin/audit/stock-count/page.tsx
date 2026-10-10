"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { TableWrap } from "@/components/admin/TableWrap";
import { AdminShell } from "@/components/AdminShell";
import { CountAuditHowTo } from "@/components/HrAuditHowTo";
import { NumberField } from "@/components/NumberField";
import { printAuditPage } from "@/lib/audit-print";
import { useDb, useSession } from "@/lib/hooks";
import { monthCloseStamp } from "@/lib/owner-monthly-audit";
import { formatInr } from "@/lib/pricing";
import {
  canEnterPhysicalCountNow,
  canViewFinancials,
  isSalesDeskStaff,
  loadDb,
  saveDb,
  startMonthCounts,
  approveStockCountLines,
} from "@/lib/store/db";
import {
  cashMismatch,
  isShortage,
  isSurplus,
  isUncountedLine,
  lineVariance,
  ownerExceptionLines,
  shortageValue,
  surplusLines,
  uncountedLines,
} from "@/lib/stock-count";

type LineFilter = "all" | "uncounted" | "shortages";

export default function StockCountPage() {
  const t = useTranslations();
  const { session, ready } = useSession();
  const { db, refresh } = useDb();
  const monthDefault = new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(monthDefault);
  const [cat, setCat] = useState("");
  const [lineFilter, setLineFilter] = useState<LineFilter>("all");
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [cashNote, setCashNote] = useState("");

  const canEnter = canEnterPhysicalCountNow(session, db);
  const isOwner = session ? canViewFinancials(session.role) : false;

  const sessionRow =
    (db?.stockCounts ?? []).find(
      (c) => c.month === month && (c.status === "draft" || c.status === "submitted")
    ) || (db?.stockCounts ?? []).find((c) => c.month === month);
  const cashRow = (db?.cashCounts ?? []).find((c) => c.month === month);
  const stamp = monthCloseStamp(db?.monthlyAudits, month);

  const lines = useMemo(() => {
    let all = sessionRow?.lines ?? [];
    if (cat) all = all.filter((l) => (l.category || "") === cat);
    if (lineFilter === "uncounted") all = all.filter(isUncountedLine);
    if (lineFilter === "shortages") {
      all = all.filter(
        (l) => isShortage(l) || isUncountedLine(l) || isSurplus(l)
      );
    }
    return all;
  }, [sessionRow, cat, lineFilter]);

  if (ready && (isSalesDeskStaff(session, db) || (!canEnter && !isOwner))) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  const persist = (mut: (d: NonNullable<typeof db>) => void) => {
    const live = loadDb();
    mut(live);
    saveDb(live);
    refresh();
  };

  const statusLabel =
    sessionRow?.status === "draft"
      ? t("admin.auditStatusDraft")
      : sessionRow?.status === "submitted"
        ? t("admin.auditStatusSubmitted")
        : sessionRow?.status === "owner_reviewed"
          ? t("admin.auditStatusReviewed")
          : "";

  const exceptions = sessionRow ? ownerExceptionLines(sessionRow) : [];
  const leftoverUncounted = sessionRow ? uncountedLines(sessionRow) : [];
  const leftoverSurplus = sessionRow ? surplusLines(sessionRow) : [];

  return (
    <AdminShell wide>
      <AccountsPageHeader
        title={t("admin.stockCount")}
        hint={t("admin.stockCountHint")}
        backHref="/admin/audit"
        backLabel={t("admin.auditHub")}
        actions={
          <button
            type="button"
            className="tt-btn tt-btn-outline"
            onClick={() => printAuditPage()}
          >
            {t("admin.auditPrintSheet")}
          </button>
        }
      />
      <div className="print:hidden">
        <CountAuditHowTo
          step={
            !sessionRow
              ? 1
              : sessionRow.status === "draft"
                ? 2
                : sessionRow.status === "submitted"
                  ? isOwner
                    ? 5
                    : 4
                  : 5
          }
          showOwnerStep={isOwner}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-end gap-2 print:hidden">
        <label className="text-sm">
          {t("admin.auditMonth")}
          <input
            className="tt-input ml-2"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="tt-btn tt-btn-dark"
          onClick={() => {
            if (!session) return;
            startMonthCounts(month, session.id);
            refresh();
          }}
        >
          {t("admin.startCount")}
        </button>
        {sessionRow?.status === "draft" ? (
          <>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={() => {
                persist((d) => {
                  const row = d.stockCounts?.find((c) => c.id === sessionRow.id);
                  if (row) row.updatedAt = new Date().toISOString();
                });
                setMsg(t("admin.saveDraft"));
              }}
            >
              {t("admin.saveDraft")}
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-dark"
              onClick={() => {
                persist((d) => {
                  const row = d.stockCounts?.find((c) => c.id === sessionRow.id);
                  if (row) {
                    row.status = "submitted";
                    row.submittedAt = new Date().toISOString();
                    row.submittedBy = session?.id;
                    row.updatedAt = row.submittedAt;
                  }
                  const cash = d.cashCounts?.find((c) => c.month === month);
                  if (cash && cash.status === "draft") {
                    cash.status = "submitted";
                    cash.submittedAt = new Date().toISOString();
                    cash.submittedBy = session?.id;
                    cash.updatedAt = cash.submittedAt;
                  }
                });
                setMsg(t("admin.submitCount"));
              }}
            >
              {t("admin.submitCount")}
            </button>
          </>
        ) : null}
      </div>
      {sessionRow || stamp ? (
        <p className="mt-3 text-sm">
          {statusLabel}
          {stamp
            ? ` · ${t("admin.auditMonthClosed")} · ${t("admin.auditMonthClosedBy")} ${
                db?.users.find((u) => u.id === stamp.closedBy)?.name || stamp.closedBy
              }`
            : ""}
        </p>
      ) : null}
      {msg ? <p className="mt-2 text-sm print:hidden">{msg}</p> : null}

      {!sessionRow ? (
        <AccountsEmpty message={t("admin.auditEmptyNoCount")} />
      ) : null}

      {cashRow ? (
        <div className="tt-panel mt-6 p-4 print:hidden">
          <h2 className="font-semibold">{t("admin.cashCount")}</h2>
          <p className="text-sm text-[var(--ink-muted)]">
            {t("admin.auditBookCash")} {isOwner ? formatInr(cashRow.bookCash) : "—"} ·{" "}
            {t("admin.auditBank")} {isOwner ? formatInr(cashRow.bookBank) : "—"}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              {t("admin.countedCash")}
              <NumberField
                className="tt-input mt-1 w-full"
                value={cashRow.countedCash ?? ""}
                disabled={cashRow.status !== "draft"}
                onValueChange={(v) => {
                  persist((d) => {
                    const row = d.cashCounts?.find((c) => c.id === cashRow.id);
                    if (row && row.status === "draft") {
                      row.countedCash = v === "" ? 0 : Number(v) || 0;
                      row.updatedAt = new Date().toISOString();
                    }
                  });
                }}
              />
            </label>
            <label className="text-sm">
              {t("admin.statementBank")}
              <NumberField
                className="tt-input mt-1 w-full"
                value={cashRow.statementBank ?? ""}
                disabled={cashRow.status !== "draft"}
                onValueChange={(v) => {
                  persist((d) => {
                    const row = d.cashCounts?.find((c) => c.id === cashRow.id);
                    if (row && row.status === "draft") {
                      row.statementBank = v === "" ? 0 : Number(v) || 0;
                      row.updatedAt = new Date().toISOString();
                    }
                  });
                }}
              />
            </label>
          </div>
          <input
            className="tt-input mt-3 w-full"
            placeholder={t("admin.auditNote")}
            value={cashRow.note || cashNote}
            disabled={cashRow.status !== "draft" && !isOwner}
            onChange={(e) => {
              setCashNote(e.target.value);
              persist((d) => {
                const row = d.cashCounts?.find((c) => c.id === cashRow.id);
                if (!row) return;
                if (row.status === "draft" || isOwner) {
                  row.note = e.target.value;
                  row.updatedAt = new Date().toISOString();
                }
              });
            }}
          />
          {isOwner && cashRow.countedCash != null ? (
            <p className="mt-2 text-sm">
              {t("admin.auditCashDiff")} {formatInr(cashMismatch(cashRow).cashDiff)} ·{" "}
              {t("admin.auditBankDiff")} {formatInr(cashMismatch(cashRow).bankDiff)}
            </p>
          ) : null}
          {cashRow.ownerDecision === "approved" ? (
            <p className="mt-2 text-sm">{t("admin.auditCashAccepted")}</p>
          ) : null}
          {cashRow.ownerDecision === "rejected" ? (
            <p className="mt-2 text-sm">{t("admin.auditCashRejected")}</p>
          ) : null}
          {isOwner && cashRow.status !== "draft" && cashRow.ownerDecision !== "approved" ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="tt-btn tt-btn-dark"
                onClick={() =>
                  persist((d) => {
                    const row = d.cashCounts?.find((c) => c.id === cashRow.id);
                    if (!row) return;
                    row.ownerDecision = "approved";
                    row.rejectReason = undefined;
                    row.updatedAt = new Date().toISOString();
                  })
                }
              >
                {t("admin.auditAcceptCash")}
              </button>
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                onClick={() =>
                  persist((d) => {
                    const row = d.cashCounts?.find((c) => c.id === cashRow.id);
                    if (!row) return;
                    row.ownerDecision = "rejected";
                    row.rejectReason = "Recount";
                    row.status = "draft";
                    row.updatedAt = new Date().toISOString();
                  })
                }
              >
                {t("admin.rejectRecount")}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {sessionRow ? (
        <div className="mt-4 flex flex-wrap gap-2 print:hidden">
          <select
            className="tt-input"
            value={lineFilter}
            onChange={(e) => setLineFilter(e.target.value as LineFilter)}
          >
            <option value="all">{t("admin.auditFilterAll")}</option>
            <option value="uncounted">{t("admin.auditFilterUncounted")}</option>
            <option value="shortages">{t("admin.auditFilterShortages")}</option>
          </select>
          <select
            className="tt-input"
            value={cat}
            onChange={(e) => setCat(e.target.value)}
          >
            <option value="">{t("admin.auditAllCategories")}</option>
            {[...new Set((sessionRow.lines ?? []).map((l) => l.category).filter(Boolean))].map(
              (c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              )
            )}
          </select>
        </div>
      ) : null}

      {isOwner && sessionRow && sessionRow.status !== "draft" ? (
        <div className="tt-panel mt-4 p-4 print:hidden">
          <h2 className="font-semibold text-[var(--danger)]">{t("admin.auditOwnerExceptions")}</h2>
          {exceptions.length ? (
            <ul className="mt-2 text-sm">
              {exceptions.slice(0, 40).map((l) => (
                <li key={l.id}>
                  {l.label} {t("admin.bookQty")} {l.bookQty} {t("admin.countedQty")}{" "}
                  {l.countedQty ?? "—"}
                  {isOwner ? ` ${formatInr(shortageValue(l))}` : ""}
                  {isUncountedLine(l) ? ` · ${t("admin.auditUncounted")}` : ""}
                  {isSurplus(l) ? ` · ${t("admin.auditSurplus")}` : ""}
                </li>
              ))}
            </ul>
          ) : (
            <AccountsEmpty message={t("admin.auditEmptyShortages")} />
          )}
          {leftoverUncounted.length ? (
            <p className="mt-2 text-sm">
              {t("admin.auditUncounted")}: {leftoverUncounted.length}
            </p>
          ) : null}
          {leftoverSurplus.length ? (
            <p className="mt-2 text-sm">
              {t("admin.auditSurplus")}: {leftoverSurplus.length}
            </p>
          ) : null}
          <button
            type="button"
            className="tt-btn tt-btn-dark mt-3"
            onClick={() => {
              if (!session) return;
              const ids = Object.entries(selected)
                .filter(([, v]) => v)
                .map(([k]) => k);
              const n = approveStockCountLines({
                countId: sessionRow.id,
                lineIds: ids.length ? ids : sessionRow.lines.map((l) => l.id),
                actor: db!.users.find((u) => u.id === session.id)!,
                ctx: { rolePresets: db?.rolePresets, staffJobs: db?.staffJobs },
              });
              setMsg(`${t("admin.auditPosted")} ${n}`);
              refresh();
            }}
          >
            {t("admin.approvePost")}
          </button>
          <button
            type="button"
            className="tt-btn tt-btn-outline mt-3 ml-2"
            onClick={() => {
              persist((d) => {
                const row = d.stockCounts?.find((c) => c.id === sessionRow.id);
                if (!row) return;
                const ids = new Set(
                  Object.entries(selected)
                    .filter(([, v]) => v)
                    .map(([k]) => k)
                );
                row.lines = row.lines.map((l) =>
                  ids.has(l.id)
                    ? { ...l, ownerDecision: "rejected", rejectReason: "Recount" }
                    : l
                );
                row.status = "draft";
                row.updatedAt = new Date().toISOString();
              });
            }}
          >
            {t("admin.rejectRecount")}
          </button>
        </div>
      ) : null}

      {sessionRow && lines.length ? (
        <TableWrap className="tt-panel mt-4 print:hidden">
          <table className="tt-table min-w-[720px]">
            <thead>
              <tr>
                {isOwner ? <th></th> : null}
                <th>{t("admin.auditSku")}</th>
                <th>{t("admin.bookQty")}</th>
                <th>{t("admin.countedQty")}</th>
                <th>{t("admin.auditVar")}</th>
                {isOwner ? <th>{t("admin.auditShortValue")}</th> : null}
                <th>{t("admin.auditNote")}</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  {isOwner ? (
                    <td>
                      <input
                        type="checkbox"
                        checked={!!selected[l.id]}
                        onChange={(e) =>
                          setSelected((s) => ({ ...s, [l.id]: e.target.checked }))
                        }
                      />
                    </td>
                  ) : null}
                  <td>
                    {l.label}
                    <div className="text-xs text-[var(--ink-muted)]">{l.sku}</div>
                  </td>
                  <td className="tabular-nums">{l.bookQty}</td>
                  <td>
                    <NumberField
                      className="tt-input w-24"
                      value={l.countedQty ?? ""}
                      disabled={sessionRow.status !== "draft"}
                      onValueChange={(v) => {
                        persist((d) => {
                          const row = d.stockCounts?.find((c) => c.id === sessionRow.id);
                          const line = row?.lines.find((x) => x.id === l.id);
                          if (row?.status === "draft" && line) {
                            line.countedQty = v === "" ? 0 : Number(v) || 0;
                            line.counted = true;
                            row.updatedAt = new Date().toISOString();
                          }
                        });
                      }}
                    />
                  </td>
                  <td className="tabular-nums">{lineVariance(l)}</td>
                  {isOwner ? (
                    <td className="tabular-nums">{shortageValue(l)}</td>
                  ) : null}
                  <td>
                    <input
                      className="tt-input w-36"
                      value={l.note || ""}
                      disabled={sessionRow.status !== "draft"}
                      onChange={(e) => {
                        persist((d) => {
                          const row = d.stockCounts?.find((c) => c.id === sessionRow.id);
                          const line = row?.lines.find((x) => x.id === l.id);
                          if (row?.status === "draft" && line) {
                            line.note = e.target.value;
                          }
                        });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : sessionRow ? (
        <div className="print:hidden">
          <AccountsEmpty message={t("admin.auditEmptyLines")} />
        </div>
      ) : null}

      {sessionRow ? (
        <div className="mt-4 hidden print:block">
          <h2 className="font-semibold">
            {t("admin.auditCountSheet")} · {month}
          </h2>
          <table className="tt-table mt-3 min-w-full">
            <thead>
              <tr>
                <th>{t("admin.auditSku")}</th>
                <th>{t("admin.bookQty")}</th>
                <th>{t("admin.countedQty")}</th>
              </tr>
            </thead>
            <tbody>
              {(sessionRow.lines ?? []).map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.label}
                    <div className="text-xs">{l.sku}</div>
                  </td>
                  <td>{l.bookQty}</td>
                  <td></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </AdminShell>
  );
}
