"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AdminShell } from "@/components/AdminShell";
import { MonthCloseHowTo } from "@/components/HrAuditHowTo";
import { exportMonthlyAuditPdf, printAuditPage } from "@/lib/audit-print";
import { useDb, useSession } from "@/lib/hooks";
import { buildMonthlyAuditReport, type MonthCloseBlocker } from "@/lib/owner-monthly-audit";
import { formatInr } from "@/lib/pricing";
import { checkCapability, loadDb, saveDb } from "@/lib/store/db";

function blockerLabel(
  t: ReturnType<typeof useTranslations>,
  reason: MonthCloseBlocker
) {
  if (reason === "noSubmittedCount") return t("admin.auditNotReadyCount");
  if (reason === "pendingShortages") return t("admin.auditNotReadyShortages");
  return t("admin.auditNotReadyCash");
}

function AuditInner() {
  const t = useTranslations();
  const locale = useLocale() as "en" | "hi";
  const search = useSearchParams();
  const { session, ready } = useSession();
  const { db, refresh } = useDb();
  const initial = search.get("month") || new Date().toISOString().slice(0, 7);
  const [month, setMonth] = useState(initial);

  const report = useMemo(
    () => (db ? buildMonthlyAuditReport(db, month) : null),
    [db, month]
  );

  if (ready && (!session || !checkCapability(session, db, "view_financials"))) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

  return (
    <AdminShell wide>
      <AccountsPageHeader
        title={t("admin.monthlyAudit")}
        hint={`${t("admin.auditExceptions")} first, then ${t("admin.auditBooks")}.`}
        backHref="/admin/audit"
        backLabel={t("admin.auditHub")}
        actions={
          <>
          <Link
            href={`/admin/owner#audit`}
            className="tt-btn tt-btn-outline"
          >
            {locale === "hi" ? "कॉकपिट" : "Cockpit"}
          </Link>
          <input
              className="tt-input"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={() => printAuditPage()}
            >
              {t("admin.auditPrintA4")}
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-dark"
              onClick={() => {
                if (!report || !db) return;
                void exportMonthlyAuditPdf({
                  settings: db.settings,
                  month,
                  report,
                });
              }}
            >
              {t("admin.auditPdf")}
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              disabled={!!report?.stamp}
              onClick={() => {
                if (!session || report?.stamp) return;
                const live = loadDb();
                live.monthlyAudits = [
                  {
                    id: `ma_${month}`,
                    month,
                    closedAt: new Date().toISOString(),
                    closedBy: session.id,
                  },
                  ...(live.monthlyAudits ?? []).filter((m) => m.month !== month),
                ];
                saveDb(live);
                refresh();
              }}
            >
              {t("admin.closeMonthStamp")}
            </button>
          </>
        }
      />

      <div className="print:hidden">
        <MonthCloseHowTo month={month} />
      </div>

      {!report ? (
        <p className="mt-6 text-sm">{t("admin.auditLoading")}</p>
      ) : (
        <div className="mt-6 space-y-8 text-[15px] print:text-black">
          {report.stamp ? (
            <p className="rounded-lg bg-[var(--surface)] px-3 py-2 text-sm">
              {t("admin.auditAlreadyClosed")} · {t("admin.auditMonthClosedBy")}{" "}
              {report.stamp.closedByName} · {report.stamp.closedAt.slice(0, 10)}
              {report.stamp.note ? ` · ${report.stamp.note}` : ""}
            </p>
          ) : (
            <p className="text-sm print:hidden">
              {report.ready.ready
                ? t("admin.auditReadyStamp")
                : report.ready.reasons.map((r) => blockerLabel(t, r)).join(" ")}
            </p>
          )}

          <section className="print:break-after-page">
            <h2 className="text-xl font-bold uppercase">{t("admin.auditExceptions")}</h2>
            <h3 className="mt-4 font-semibold">{t("admin.auditStockShortages")}</h3>
            {report.stockShortages.length ? (
              <table className="tt-table mt-2 min-w-full">
                <thead>
                  <tr>
                    <th>{t("admin.auditSku")}</th>
                    <th>{t("admin.bookQty")}</th>
                    <th>{t("admin.countedQty")}</th>
                    <th>{t("admin.auditVar")}</th>
                    <th>₹</th>
                    <th>{t("admin.auditDecision")}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.stockShortages.map((s, i) => (
                    <tr key={i}>
                      <td>
                        {s.label}
                        {s.uncounted ? ` (${t("admin.auditNotCounted")})` : ""}
                      </td>
                      <td>{s.bookQty}</td>
                      <td>{s.countedQty ?? "—"}</td>
                      <td>{s.variance}</td>
                      <td>{formatInr(s.shortageValue, locale)}</td>
                      <td>{s.decision || t("admin.auditPending")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <AccountsEmpty message={t("admin.auditEmptyShortages")} />
            )}

            <h3 className="mt-6 font-semibold">{t("admin.auditUncounted")}</h3>
            {report.uncountedLines.length ? (
              <ul className="mt-2 list-disc pl-5 text-sm">
                {report.uncountedLines.map((u, i) => (
                  <li key={i}>
                    {u.label} · {t("admin.bookQty")} {u.bookQty}
                  </li>
                ))}
              </ul>
            ) : (
              <AccountsEmpty message={t("admin.auditEmptyUncounted")} />
            )}

            <h3 className="mt-6 font-semibold">{t("admin.auditSurplus")}</h3>
            {report.surplusLines.length ? (
              <ul className="mt-2 list-disc pl-5 text-sm">
                {report.surplusLines.map((s, i) => (
                  <li key={i}>
                    {s.label} · {t("admin.bookQty")} {s.bookQty}{" "}
                    {t("admin.countedQty")} {s.countedQty ?? "—"}{" "}
                    {t("admin.auditVar")} {s.variance}
                  </li>
                ))}
              </ul>
            ) : (
              <AccountsEmpty message={t("admin.auditEmptySurplus")} />
            )}

            {report.cash ? (
              <p className="mt-4 font-semibold">
                {t("admin.auditCashDiff")} {formatInr(report.cash.cashDiff, locale)} ·{" "}
                {t("admin.auditBankDiff")} {formatInr(report.cash.bankDiff, locale)}
                {report.cashDecision === "approved"
                  ? ` · ${t("admin.auditCashAccepted")}`
                  : report.cashDecision === "rejected"
                    ? ` · ${t("admin.auditCashRejected")}`
                    : ` · ${t("admin.auditCashPending")}`}
              </p>
            ) : null}

            <h3 className="mt-6 font-semibold">{t("admin.auditGpsFlags")}</h3>
            {report.gpsFlags.length ? (
              <ul className="mt-2 list-disc pl-5">
                {report.gpsFlags.map((g, i) => (
                  <li key={i}>
                    {g.userName} {g.at.replace("T", " ").slice(0, 16)} {g.kind}{" "}
                    {g.insideFence ? "" : t("admin.auditOutside")}{" "}
                    {g.weakGps ? t("admin.hrWeakGps") : ""} ±
                    {g.accuracyM ?? "?"}m
                  </li>
                ))}
              </ul>
            ) : (
              <AccountsEmpty message={t("admin.auditEmptyGps")} />
            )}

            <h3 className="mt-6 font-semibold">{t("admin.auditMissingOut")}</h3>
            {report.missingClockOut.length ? (
              <ul className="mt-2 list-disc pl-5">
                {report.missingClockOut.map((m, i) => (
                  <li key={i}>
                    {m.userName} {m.date}
                  </li>
                ))}
              </ul>
            ) : (
              <AccountsEmpty message={t("admin.auditEmptyMissingOut")} />
            )}

            <h3 className="mt-6 font-semibold">{t("admin.auditAbsenteeism")}</h3>
            {report.absenteeism.length ? (
              <ul className="mt-2 list-disc pl-5">
                {report.absenteeism.map((m, i) => (
                  <li key={i}>
                    {m.userName} {m.absentDays} {t("admin.auditDays")}
                  </li>
                ))}
              </ul>
            ) : (
              <AccountsEmpty message={t("admin.auditEmptyAbsent")} />
            )}
          </section>
          <section>
            <h2 className="text-xl font-bold uppercase">{t("admin.auditBooks")}</h2>
            <dl className="mt-4 grid gap-2 sm:grid-cols-2">
              <div>
                {t("admin.auditPlIncome")} {formatInr(report.pl.income, locale)}
              </div>
              <div>
                {t("admin.auditExpense")} {formatInr(report.pl.expense, locale)}
              </div>
              <div>
                {t("admin.hrNet")} {formatInr(report.pl.net, locale)}
              </div>
              <div>
                {t("admin.auditCashClose")} {formatInr(report.cashClose, locale)}
              </div>
              <div>
                {t("admin.auditBankClose")} {formatInr(report.bankClose, locale)}
              </div>
              <div>
                {t("admin.auditAr")} {formatInr(report.ar, locale)}
              </div>
              <div>
                {t("admin.auditAp")} {formatInr(report.ap, locale)}
              </div>
              <div>
                {t("admin.auditOverdueAr")} {formatInr(report.overdueAr, locale)}
              </div>
              <div>
                {t("admin.auditStockBook")} {formatInr(report.stockBookValue, locale)}
              </div>
              <div>
                {t("admin.auditStockCounted")} {formatInr(report.stockCountedValue, locale)}
              </div>
              <div>
                {t("admin.auditPayrollNet")} {formatInr(report.payrollNet, locale)}
              </div>
            </dl>
            <div className="mt-16 grid grid-cols-3 gap-8 text-sm">
              <div>
                {t("admin.countedBy")}
                <div className="mt-8 border-t border-[var(--line)] pt-1">___________</div>
              </div>
              <div>
                {t("admin.checkedBy")}
                <div className="mt-8 border-t border-[var(--line)] pt-1">___________</div>
              </div>
              <div>
                {t("admin.ownerSign")}
                <div className="mt-8 border-t border-[var(--line)] pt-1">___________</div>
              </div>
            </div>
          </section>
        </div>
      )}
    </AdminShell>
  );
}

export default function MonthlyAuditPage() {
  const t = useTranslations();
  return (
    <Suspense
      fallback={
        <AdminShell>
          <p>{t("admin.auditLoading")}</p>
        </AdminShell>
      }
    >
      <AuditInner />
    </Suspense>
  );
}
