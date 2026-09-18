"use client";

import { useState, type Dispatch, type SetStateAction } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { PageTabs } from "@/components/admin/PageTabs";
import { TableWrap } from "@/components/admin/TableWrap";
import { AdminShell } from "@/components/AdminShell";
import { NumberField } from "@/components/NumberField";
import { ACCT } from "@/lib/accounting";
import { useDb, useSession } from "@/lib/hooks";
import {
  canManageHr,
  computePayroll,
  dateInIst,
  dayAttendanceStatusKey,
  deriveDayAttendance,
  inclusiveLeaveDays,
  isIssuedAdvance,
  leaveOverlapsMonth,
  leaveQuotaBlocked,
  leaveQuotaRemaining,
  monthDateList,
  punchesForDay,
} from "@/lib/hr";
import {
  exportPayslipPdf,
  exportRegisterPdf,
  exportStaffAttendancePdf,
  printHrPage,
} from "@/lib/hr-print";
import { formatInr } from "@/lib/pricing";
import {
  isStaff as roleIsStaff,
  loadDb,
  recordExpense,
  saveDb,
} from "@/lib/store/db";
import type {
  HrAdvance,
  HrLeave,
  HrLeaveKind,
  HrPayBasis,
  HrShift,
  HrSite,
  HrTerms,
} from "@/lib/types";

type Tab = "people" | "shifts" | "sites" | "attendance" | "leave" | "pay";

function attStatusLabel(
  t: ReturnType<typeof useTranslations>,
  key: ReturnType<typeof dayAttendanceStatusKey>
) {
  const map = {
    presentLate: t("admin.hrStatusPresentLate"),
    present: t("admin.hrStatusPresent"),
    halfMissing: t("admin.hrStatusHalfMissing"),
    half: t("admin.hrStatusHalf"),
    absentOutside: t("admin.hrStatusAbsentOutside"),
    none: t("admin.hrStatusNone"),
  } as const;
  return map[key];
}

export default function HrDeskPage() {
  const t = useTranslations();
  const { session, ready } = useSession();
  const { db, refresh } = useDb();
  const [tab, setTab] = useState<Tab>("people");
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [msg, setMsg] = useState("");
  const [advDraft, setAdvDraft] = useState<Record<string, string>>({});
  const [detailUserId, setDetailUserId] = useState<string | null>(null);

  const ownerHr = canManageHr(session);
  const allowed = session ? roleIsStaff(session.role) : false;
  const staff = (db?.users ?? []).filter((u) => u.role !== "customer" && u.active);

  if (ready && !allowed) {
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

  if (session && !ownerHr) {
    return (
      <StaffSelfHr
        month={month}
        onMonth={setMonth}
        sessionId={session.id}
        sessionName={session.name}
        db={db}
        persist={persist}
      />
    );
  }

  const tabs: Tab[] = ["people", "shifts", "sites", "attendance", "leave", "pay"];
  const punchBtn = (
    <Link href="/admin/hr/punch" className="tt-btn tt-btn-dark">
      {t("admin.hrPunch")}
    </Link>
  );

  return (
    <AdminShell wide>
      <AccountsPageHeader
        title={t("admin.hrDesk")}
        hint={t("admin.hrHint")}
        backHref="/admin"
        backLabel={t("admin.backToAdmin")}
        actions={punchBtn}
      />
      <PageTabs
        className="mt-4"
        value={tab}
        onChange={(id) => {
          setTab(id as Tab);
          setDetailUserId(null);
        }}
        tabs={tabs.map((id) => ({
          id,
          label: t(
            id === "people"
              ? "admin.hrPeople"
              : id === "shifts"
                ? "admin.hrShifts"
                : id === "sites"
                  ? "admin.hrSites"
                  : id === "attendance"
                    ? "admin.hrAttendance"
                    : id === "leave"
                      ? "admin.hrLeave"
                      : "admin.hrPay"
          ),
        }))}
      />
      <input
        className="tt-input mt-3 print:hidden"
        type="month"
        value={month}
        onChange={(e) => setMonth(e.target.value)}
      />
      {msg ? <p className="mt-2 text-sm print:hidden">{msg}</p> : null}

      {tab === "people" ? (
        staff.length ? (
          <TableWrap className="tt-panel mt-4">
            <table className="tt-table">
              <thead>
                <tr>
                  <th>{t("admin.hrStaff")}</th>
                  <th>{t("admin.hrPayBasis")}</th>
                  <th>{t("admin.hrPayRate")}</th>
                  <th>{t("admin.hrOtRate")}</th>
                  <th>{t("admin.hrOtMult")}</th>
                  <th>{t("admin.hrWeekOff")}</th>
                  <th>{t("admin.hrShift")}</th>
                  <th>{t("admin.hrCasual")}</th>
                  <th>{t("admin.hrSick")}</th>
                  <th>{t("admin.hrSelfieCol")}</th>
                </tr>
              </thead>
              <tbody>
                {staff.map((u) => {
                  const terms = (db?.hrTerms ?? []).find((x) => x.userId === u.id);
                  const basis: HrPayBasis = terms?.payBasis || "monthly";
                  const rateValue =
                    basis === "daily"
                      ? terms?.dailyWage ?? 0
                      : basis === "hourly"
                        ? terms?.hourlyRate ?? 0
                        : terms?.monthlySalary ?? 0;
                  return (
                    <tr key={u.id}>
                      <td>{u.name}</td>
                      <td>
                        <select
                          className="tt-input"
                          value={basis}
                          onChange={(e) =>
                            persist((d) =>
                              upsertTerms(d, u.id, {
                                payBasis: e.target.value as HrPayBasis,
                              })
                            )
                          }
                        >
                          <option value="monthly">{t("admin.hrMonthly")}</option>
                          <option value="daily">{t("admin.hrDaily")}</option>
                          <option value="hourly">{t("admin.hrHourly")}</option>
                        </select>
                      </td>
                      <td>
                        <NumberField
                          className="tt-input w-28"
                          value={rateValue}
                          onValueChange={(v) =>
                            persist((d) =>
                              upsertTerms(
                                d,
                                u.id,
                                basis === "daily"
                                  ? { dailyWage: Number(v) || 0 }
                                  : basis === "hourly"
                                    ? { hourlyRate: Number(v) || 0 }
                                    : { monthlySalary: Number(v) || 0 }
                              )
                            )
                          }
                        />
                      </td>
                      <td>
                        <NumberField
                          className="tt-input w-20"
                          value={terms?.otRatePerHour ?? 0}
                          onValueChange={(v) =>
                            persist((d) =>
                              upsertTerms(d, u.id, { otRatePerHour: Number(v) || 0 })
                            )
                          }
                        />
                      </td>
                      <td>
                        <select
                          className="tt-input"
                          value={String(terms?.otMultiplier ?? 1)}
                          onChange={(e) =>
                            persist((d) =>
                              upsertTerms(d, u.id, {
                                otMultiplier: Number(e.target.value) || 1,
                              })
                            )
                          }
                        >
                          <option value="1">1×</option>
                          <option value="1.5">1.5×</option>
                          <option value="2">2×</option>
                        </select>
                      </td>
                      <td>
                        <select
                          className="tt-input"
                          value={terms?.weekOff ?? 0}
                          onChange={(e) =>
                            persist((d) =>
                              upsertTerms(d, u.id, { weekOff: Number(e.target.value) })
                            )
                          }
                        >
                          <option value={0}>{t("admin.hrSun")}</option>
                          <option value={1}>{t("admin.hrMon")}</option>
                          <option value={6}>{t("admin.hrSat")}</option>
                        </select>
                      </td>
                      <td>
                        <select
                          className="tt-input"
                          value={terms?.shiftId || ""}
                          onChange={(e) =>
                            persist((d) => upsertTerms(d, u.id, { shiftId: e.target.value }))
                          }
                        >
                          <option value="">—</option>
                          {(db?.hrShifts ?? []).map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <NumberField
                          className="tt-input w-16"
                          value={terms?.casualDaysPerYear ?? 6}
                          onValueChange={(v) =>
                            persist((d) =>
                              upsertTerms(d, u.id, {
                                casualDaysPerYear: Number(v) || 0,
                              })
                            )
                          }
                        />
                      </td>
                      <td>
                        <NumberField
                          className="tt-input w-16"
                          value={terms?.sickDaysPerYear ?? 6}
                          onValueChange={(v) =>
                            persist((d) =>
                              upsertTerms(d, u.id, { sickDaysPerYear: Number(v) || 0 })
                            )
                          }
                        />
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          checked={!!terms?.requireSelfie}
                          onChange={(e) =>
                            persist((d) =>
                              upsertTerms(d, u.id, { requireSelfie: e.target.checked })
                            )
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        ) : (
          <AccountsEmpty
            message={t("admin.hrEmptyPeople")}
            href="/admin/users"
            cta={t("admin.users")}
          />
        )
      ) : null}

      {tab === "shifts" ? (
        <ShiftsPanel
          shifts={db?.hrShifts ?? []}
          onAdd={() =>
            persist((d) => {
              d.hrShifts = [
                {
                  id: `sh_${crypto.randomUUID()}`,
                  name: t("admin.hrDefaultShift"),
                  start: "09:00",
                  end: "18:00",
                  graceMinutes: 15,
                },
                ...(d.hrShifts ?? []),
              ];
            })
          }
          onChange={(id, patch) =>
            persist((d) => {
              d.hrShifts = (d.hrShifts ?? []).map((s) =>
                s.id === id ? { ...s, ...patch } : s
              );
            })
          }
        />
      ) : null}

      {tab === "sites" ? (
        <SitesPanel
          sites={db?.hrSites ?? []}
          onAdd={() =>
            persist((d) => {
              d.hrSites = [
                {
                  id: `site_${crypto.randomUUID()}`,
                  name: t("admin.hrDefaultSite"),
                  lat: 26.467,
                  lng: 80.241,
                  radiusM: 150,
                },
                ...(d.hrSites ?? []),
              ];
            })
          }
          onChange={(id, patch) =>
            persist((d) => {
              d.hrSites = (d.hrSites ?? []).map((s) =>
                s.id === id ? { ...s, ...patch } : s
              );
            })
          }
        />
      ) : null}

      {tab === "attendance" ? (
        <OwnerAttendance
          month={month}
          staff={staff}
          db={db}
          detailUserId={detailUserId}
          onOpen={setDetailUserId}
        />
      ) : null}

      {tab === "leave" ? (
        <LeavePanel
          staff={staff}
          leaves={(db?.hrLeaves ?? []).filter((l) => leaveOverlapsMonth(l, month))}
          allLeaves={db?.hrLeaves ?? []}
          terms={db?.hrTerms ?? []}
          canDecide
          onSave={(row) => {
            const terms = (db?.hrTerms ?? []).find((x) => x.userId === row.userId);
            if (leaveQuotaBlocked(db?.hrLeaves ?? [], terms, row)) {
              setMsg(t("admin.hrLeaveQuota"));
              return;
            }
            persist((d) => {
              d.hrLeaves = [row, ...(d.hrLeaves ?? [])];
            });
          }}
          onDecide={(id, status, rejectReason) =>
            persist((d) => {
              const row = (d.hrLeaves ?? []).find((l) => l.id === id);
              if (
                status === "approved" &&
                row &&
                leaveQuotaBlocked(d.hrLeaves ?? [], (d.hrTerms ?? []).find((x) => x.userId === row.userId), row)
              ) {
                setMsg(t("admin.hrLeaveQuota"));
                return;
              }
              d.hrLeaves = (d.hrLeaves ?? []).map((l) =>
                l.id === id
                  ? {
                      ...l,
                      status,
                      rejectReason: status === "rejected" ? rejectReason : undefined,
                      decidedBy: session?.id,
                      decidedAt: new Date().toISOString(),
                    }
                  : l
              );
            })
          }
        />
      ) : null}

      {tab === "pay" ? (
        <OwnerPay
          month={month}
          staff={staff}
          db={db}
          sessionId={session?.id || ""}
          advDraft={advDraft}
          setAdvDraft={setAdvDraft}
          persist={persist}
          refresh={refresh}
          setMsg={setMsg}
        />
      ) : null}
    </AdminShell>
  );
}

function OwnerAttendance({
  month,
  staff,
  db,
  detailUserId,
  onOpen,
}: {
  month: string;
  staff: { id: string; name: string }[];
  db: ReturnType<typeof loadDb> | null;
  detailUserId: string | null;
  onOpen: (id: string | null) => void;
}) {
  const t = useTranslations();
  if (!staff.length) {
    return <AccountsEmpty message={t("admin.hrEmptyAttendance")} />;
  }
  const detail = staff.find((s) => s.id === detailUserId);
  if (detail) {
    const terms = (db?.hrTerms ?? []).find((x) => x.userId === detail.id);
    const shift = (db?.hrShifts ?? []).find((s) => s.id === terms?.shiftId);
    const dates = monthDateList(month);
    return (
      <div className="mt-4">
        <div className="mb-3 flex flex-wrap gap-2 print:hidden">
          <button type="button" className="tt-btn tt-btn-outline" onClick={() => onOpen(null)}>
            {t("admin.hrBackToList")}
          </button>
          <button type="button" className="tt-btn tt-btn-outline" onClick={() => printHrPage()}>
            {t("admin.hrPrintRegister")}
          </button>
        </div>
        <h2 className="font-semibold">
          {detail.name} · {t("admin.hrDailyPunches")}
        </h2>
        <TableWrap className="tt-panel mt-3">
          <table className="tt-table">
            <thead>
              <tr>
                <th>{t("admin.hrDate")}</th>
                <th>{t("admin.hrIn")}</th>
                <th>{t("admin.hrOut")}</th>
                <th>{t("admin.hrHours")}</th>
                <th>{t("admin.hrOtShort")}</th>
                <th>{t("admin.hrStatus")}</th>
                <th>{t("admin.hrSelfieCol")}</th>
              </tr>
            </thead>
            <tbody>
              {dates.map((date) => {
                const att = deriveDayAttendance(
                  db?.hrPunches ?? [],
                  detail.id,
                  date,
                  shift,
                  terms?.halfDayHours
                );
                const day = punchesForDay(db?.hrPunches ?? [], detail.id, date);
                const photo = day.find((p) => p.photoUrl)?.photoUrl;
                return (
                  <tr key={date}>
                    <td>{date}</td>
                    <td>{att.inAt ? att.inAt.slice(11, 16) : "—"}</td>
                    <td>{att.outAt ? att.outAt.slice(11, 16) : "—"}</td>
                    <td>{(att.workedMinutes / 60).toFixed(1)}</td>
                    <td>{(att.otMinutes / 60).toFixed(1)}</td>
                    <td>
                      {attStatusLabel(t, dayAttendanceStatusKey(att))}
                      {att.weakGps ? ` · ${t("admin.hrWeakGps")}` : ""}
                    </td>
                    <td>
                      {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={photo} alt="" className="h-10 w-10 rounded object-cover" />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <div className="mb-3 flex flex-wrap gap-2 print:hidden">
        <button
          type="button"
          className="tt-btn tt-btn-outline"
          onClick={() => printHrPage()}
        >
          {t("admin.hrPrintRegister")}
        </button>
        <button
          type="button"
          className="tt-btn tt-btn-outline"
          onClick={() =>
            void exportRegisterPdf({
              settings: db?.settings,
              month,
              staff,
              terms: db?.hrTerms ?? [],
              shifts: db?.hrShifts ?? [],
              punches: db?.hrPunches ?? [],
              leaves: db?.hrLeaves ?? [],
              advances: db?.hrAdvances ?? [],
            })
          }
        >
          {t("admin.hrPdfRegister")}
        </button>
      </div>
      <TableWrap className="tt-panel">
        <table className="tt-table">
          <thead>
            <tr>
              <th>{t("admin.hrStaff")}</th>
              <th>{t("admin.hrPresent")}</th>
              <th>{t("admin.hrHalf")}</th>
              <th>{t("admin.hrHours")}</th>
              <th>{t("admin.hrLate")}</th>
              <th>{t("admin.hrMissingOut")}</th>
              <th>{t("admin.hrOutsideFence")}</th>
              <th>{t("admin.hrWeakGps")}</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((u) => {
              const dates = monthDateList(month);
              const terms = (db?.hrTerms ?? []).find((x) => x.userId === u.id);
              const shift = (db?.hrShifts ?? []).find((s) => s.id === terms?.shiftId);
              let present = 0;
              let half = 0;
              let late = 0;
              let missing = 0;
              let outside = 0;
              let weak = 0;
              let minutes = 0;
              for (const date of dates) {
                const att = deriveDayAttendance(
                  db?.hrPunches ?? [],
                  u.id,
                  date,
                  shift,
                  terms?.halfDayHours
                );
                if (att.present) present += 1;
                if (att.half) half += 1;
                if (att.late) late += 1;
                if (att.missingOut) missing += 1;
                if (att.outsideFence) outside += 1;
                if (att.weakGps) weak += 1;
                minutes += att.workedMinutes;
              }
              return (
                <tr
                  key={u.id}
                  className="cursor-pointer hover:bg-[var(--brand-soft)]"
                  onClick={() => onOpen(u.id)}
                >
                  <td>{u.name}</td>
                  <td>{present}</td>
                  <td>{half}</td>
                  <td>{(minutes / 60).toFixed(1)}</td>
                  <td>{late}</td>
                  <td>{missing}</td>
                  <td>{outside}</td>
                  <td>{weak}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </div>
  );
}

function OwnerPay({
  month,
  staff,
  db,
  sessionId,
  advDraft,
  setAdvDraft,
  persist,
  refresh,
  setMsg,
}: {
  month: string;
  staff: { id: string; name: string }[];
  db: ReturnType<typeof loadDb> | null;
  sessionId: string;
  advDraft: Record<string, string>;
  setAdvDraft: Dispatch<SetStateAction<Record<string, string>>>;
  persist: (mut: (d: NonNullable<typeof db>) => void) => void;
  refresh: () => void;
  setMsg: (s: string) => void;
}) {
  const t = useTranslations();
  const [printTarget, setPrintTarget] = useState<string | null>(null);
  const cards = staff
    .map((u) => {
      const terms = (db?.hrTerms ?? []).find((x) => x.userId === u.id);
      if (!terms) return null;
      const shift = (db?.hrShifts ?? []).find((s) => s.id === terms.shiftId);
      const pay = computePayroll({
        month,
        terms,
        shift,
        punches: db?.hrPunches ?? [],
        leaves: db?.hrLeaves ?? [],
        advances: (db?.hrAdvances ?? []).filter((a) => a.userId === u.id),
      });
      const existing = (db?.hrPayslips ?? []).find(
        (p) => p.userId === u.id && p.month === month
      );
      const pending = (db?.hrAdvances ?? []).filter(
        (a) => a.userId === u.id && a.status === "pending"
      );
      return { u, terms, pay, existing, pending };
    })
    .filter(Boolean) as {
    u: { id: string; name: string };
    terms: HrTerms;
    pay: ReturnType<typeof computePayroll>;
    existing?: { id: string };
    pending: HrAdvance[];
  }[];

  if (!cards.length) {
    return <AccountsEmpty message={t("admin.hrEmptyPeople")} />;
  }

  return (
    <div className="mt-4 space-y-3">
      {cards.map(({ u, pay, existing, pending }) => (
        <div
          key={u.id}
          className={`tt-panel p-4 print:break-after-page ${printTarget && printTarget !== u.id ? "print:hidden" : ""}`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">
              {t("admin.hrPayslipTitle")} · {u.name} · {month}
            </p>
            <p className="text-sm">
              {pay.formula} · {t("admin.hrHours")} {(pay.workedMinutes / 60).toFixed(1)} ·{" "}
              {t("admin.hrHalfDays")} {pay.halfDays} · {t("admin.hrOtShort")}{" "}
              {(pay.otMinutes / 60).toFixed(1)}h {formatInr(pay.otPay)} · {t("admin.hrAdvShort")}{" "}
              {formatInr(pay.advances)} · {t("admin.hrNet")} {formatInr(pay.net)}
            </p>
          </div>
          <dl className="mt-3 hidden grid-cols-2 gap-x-4 gap-y-1 text-sm print:grid sm:grid-cols-4">
            <dt>{t("admin.hrPresent")}</dt>
            <dd>{pay.presentDays}</dd>
            <dt>{t("admin.hrHalfDays")}</dt>
            <dd>{pay.halfDays}</dd>
            <dt>{t("admin.hrHours")}</dt>
            <dd>{(pay.workedMinutes / 60).toFixed(1)}</dd>
            <dt>{t("admin.hrOtShort")}</dt>
            <dd>
              {(pay.otMinutes / 60).toFixed(1)}h {formatInr(pay.otPay)}
            </dd>
            <dt>{t("admin.hrAdvShort")}</dt>
            <dd>{formatInr(pay.advances)}</dd>
            <dt>{t("admin.hrGross")}</dt>
            <dd>{formatInr(pay.gross)}</dd>
            <dt>{t("admin.hrNet")}</dt>
            <dd>{formatInr(pay.net)}</dd>
          </dl>
          {pending.length ? (
            <div className="mt-2 rounded-lg bg-[var(--surface)] p-2 text-sm">
              <p className="font-medium">{t("admin.hrPendingAdvances")}</p>
              {pending.map((a) => (
                <div key={a.id} className="mt-1 flex flex-wrap items-center gap-2">
                  <span>
                    {formatInr(a.amount)}
                    {a.note ? ` · ${a.note}` : ""}
                  </span>
                  <span className="flex flex-wrap gap-2 print:hidden">
                  <button
                    type="button"
                    className="tt-btn tt-btn-dark"
                    onClick={() =>
                      persist((d) => {
                        d.hrAdvances = (d.hrAdvances ?? []).map((x) =>
                          x.id === a.id
                            ? {
                                ...x,
                                status: "issued",
                                date: dateInIst(new Date().toISOString()),
                                decidedBy: sessionId,
                                decidedAt: new Date().toISOString(),
                              }
                            : x
                        );
                      })
                    }
                  >
                    {t("admin.hrIssueAdvance")}
                  </button>
                  <button
                    type="button"
                    className="tt-btn tt-btn-outline"
                    onClick={() =>
                      persist((d) => {
                        d.hrAdvances = (d.hrAdvances ?? []).map((x) =>
                          x.id === a.id
                            ? {
                                ...x,
                                status: "rejected",
                                decidedBy: sessionId,
                                decidedAt: new Date().toISOString(),
                              }
                            : x
                        );
                      })
                    }
                  >
                    {t("admin.hrReject")}
                  </button>
                  </span>
                </div>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-2 print:hidden">
            <NumberField
              className="tt-input w-28"
              value={advDraft[u.id] ?? ""}
              emptyAs={null}
              onValueChange={(v) =>
                setAdvDraft((s) => ({ ...s, [u.id]: v === "" ? "" : String(v) }))
              }
            />
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={() => {
                const amt = Number(advDraft[u.id] || 0);
                if (!sessionId || !(amt > 0)) return;
                persist((d) => {
                  d.hrAdvances = [
                    {
                      id: `adv_${crypto.randomUUID()}`,
                      userId: u.id,
                      date: dateInIst(new Date().toISOString()),
                      amount: amt,
                      status: "issued",
                      createdBy: sessionId,
                      createdAt: new Date().toISOString(),
                    },
                    ...(d.hrAdvances ?? []),
                  ];
                });
                setAdvDraft((s) => ({ ...s, [u.id]: "" }));
              }}
            >
              {t("admin.hrAddAdvance")}
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-dark"
              disabled={!!existing}
              onClick={() => {
                if (!sessionId || existing) return;
                persist((d) => {
                  const slip = {
                    id: `ps_${crypto.randomUUID()}`,
                    userId: u.id,
                    month,
                    ...pay,
                    createdAt: new Date().toISOString(),
                    createdBy: sessionId,
                  };
                  d.hrPayslips = [slip, ...(d.hrPayslips ?? [])];
                  for (const a of d.hrAdvances ?? []) {
                    if (a.userId === u.id && !a.payslipId && isIssuedAdvance(a)) {
                      a.payslipId = slip.id;
                    }
                  }
                });
                if (pay.net > 0) {
                  try {
                    recordExpense({
                      accountId: ACCT.salary,
                      amount: pay.net,
                      date: `${month}-28`,
                      cashAccountId: ACCT.cash,
                      narration: `Payslip ${month} ${u.name}`,
                      createdBy: sessionId,
                    });
                    refresh();
                  } catch (err) {
                    setMsg(
                      err instanceof Error ? err.message : t("admin.hrPayslipExpenseSkip")
                    );
                  }
                }
                setMsg(`${t("admin.hrPayslipSaved")} ${u.name} ${month}`);
              }}
            >
              {t("admin.hrIssuePayslip")}
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={() => {
                setPrintTarget(u.id);
                window.setTimeout(() => printHrPage(), 50);
              }}
            >
              {t("admin.hrPrintPayslip")}
            </button>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={() =>
                void exportPayslipPdf({
                  settings: db?.settings,
                  staffName: u.name,
                  month,
                  pay,
                })
              }
            >
              {t("admin.hrPdfPayslip")}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function StaffSelfHr({
  month,
  onMonth,
  sessionId,
  sessionName,
  db,
  persist,
}: {
  month: string;
  onMonth: (m: string) => void;
  sessionId: string;
  sessionName: string;
  db: ReturnType<typeof loadDb> | null;
  persist: (mut: (d: ReturnType<typeof loadDb>) => void) => void;
}) {
  const t = useTranslations();
  const [tab, setTab] = useState<"attendance" | "overtime" | "leave" | "advances">(
    "attendance"
  );
  const [advAmt, setAdvAmt] = useState("");
  const [advNote, setAdvNote] = useState("");
  const [leaveMsg, setLeaveMsg] = useState("");
  const dates = monthDateList(month);
  const terms = (db?.hrTerms ?? []).find((x) => x.userId === sessionId);
  const shift = (db?.hrShifts ?? []).find((s) => s.id === terms?.shiftId);
  const punches = (db?.hrPunches ?? []).filter((p) => p.userId === sessionId);
  const leaves = (db?.hrLeaves ?? []).filter((l) => l.userId === sessionId);
  const advances = (db?.hrAdvances ?? []).filter(
    (a) => a.userId === sessionId && a.date.slice(0, 7) === month
  );
  const days = dates.map((date) => ({
    date,
    att: deriveDayAttendance(punches, sessionId, date, shift, terms?.halfDayHours),
  }));
  const otDays = days.filter((d) => d.att.otMinutes > 0);
  const otHours = otDays.reduce((s, d) => s + d.att.otMinutes, 0) / 60;
  const year = month.slice(0, 4);
  const casualLeft = leaveQuotaRemaining(leaves, terms, sessionId, "casual", year);
  const sickLeft = leaveQuotaRemaining(leaves, terms, sessionId, "sick", year);
  const tabs = [
    ["attendance", "admin.hrAttendance"],
    ["overtime", "admin.hrOvertime"],
    ["leave", "admin.hrLeave"],
    ["advances", "admin.hrAdvances"],
  ] as const;

  return (
    <AdminShell wide>
      <AccountsPageHeader
        title={t("admin.hrMyDesk")}
        hint={t("admin.hrMyHint")}
        backHref="/admin"
        backLabel={t("admin.backToAdmin")}
        actions={
          <Link href="/admin/hr/punch" className="tt-btn tt-btn-dark">
            {t("admin.hrPunch")}
          </Link>
        }
      />
      <PageTabs
        className="mt-4"
        value={tab}
        onChange={(id) => setTab(id as typeof tab)}
        tabs={tabs.map(([id, key]) => ({ id, label: t(key) }))}
      />
      <div className="mt-3 flex flex-wrap gap-2 print:hidden">
        <input
          className="tt-input"
          type="month"
          value={month}
          onChange={(e) => onMonth(e.target.value)}
        />
        <button
          type="button"
          className="tt-btn tt-btn-outline"
          onClick={() => printHrPage()}
        >
          {t("admin.hrPrintMine")}
        </button>
        <button
          type="button"
          className="tt-btn tt-btn-outline"
          onClick={() =>
            void exportStaffAttendancePdf({
              settings: db?.settings,
              staffName: sessionName,
              month,
              userId: sessionId,
              punches,
              shift,
              halfDayHours: terms?.halfDayHours,
              advances,
            })
          }
        >
          {t("admin.hrPdfRegister")}
        </button>
      </div>

      <div className="mt-4 hidden print:block">
        <h2 className="font-semibold">
          {sessionName} · {month}
        </h2>
        <table className="tt-table mt-3">
          <thead>
            <tr>
              <th>{t("admin.hrDate")}</th>
              <th>{t("admin.hrIn")}</th>
              <th>{t("admin.hrOut")}</th>
              <th>{t("admin.hrHours")}</th>
              <th>{t("admin.hrOtShort")}</th>
              <th>{t("admin.hrStatus")}</th>
            </tr>
          </thead>
          <tbody>
            {days.map(({ date, att }) => (
              <tr key={date}>
                <td>{date}</td>
                <td>{att.inAt ? att.inAt.slice(11, 16) : "—"}</td>
                <td>{att.outAt ? att.outAt.slice(11, 16) : "—"}</td>
                <td>{(att.workedMinutes / 60).toFixed(1)}</td>
                <td>{(att.otMinutes / 60).toFixed(1)}</td>
                <td>{attStatusLabel(t, dayAttendanceStatusKey(att))}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 font-semibold">{t("admin.hrOvertime")}</p>
        <p className="text-sm">
          {otHours.toFixed(1)} {t("admin.hrHours").toLowerCase()}
        </p>
        <p className="mt-3 font-semibold">{t("admin.hrAdvances")}</p>
        {advances.length ? (
          <ul className="mt-1 space-y-1 text-sm">
            {advances.map((a) => (
              <li key={a.id}>
                {a.date} · {formatInr(a.amount)}
                {a.note ? ` · ${a.note}` : ""}
                {` · ${
                  a.status === "pending"
                    ? t("admin.hrAdvancePending")
                    : a.status === "rejected"
                      ? t("admin.hrAdvanceRejected")
                      : a.payslipId
                        ? t("admin.hrAdvanceSettled")
                        : t("admin.hrAdvanceIssued")
                }`}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm">{t("admin.hrNoAdvances")}</p>
        )}
      </div>

      {tab === "attendance" ? (
        <TableWrap className="tt-panel mt-4 print:hidden">
          <table className="tt-table">
            <thead>
              <tr>
                <th>{t("admin.hrDate")}</th>
                <th>{t("admin.hrIn")}</th>
                <th>{t("admin.hrOut")}</th>
                <th>{t("admin.hrHours")}</th>
                <th>{t("admin.hrOtShort")}</th>
                <th>{t("admin.hrStatus")}</th>
              </tr>
            </thead>
            <tbody>
              {days.map(({ date, att }) => (
                <tr key={date}>
                  <td>{date.slice(8)}</td>
                  <td>{att.inAt ? att.inAt.slice(11, 16) : "—"}</td>
                  <td>{att.outAt ? att.outAt.slice(11, 16) : "—"}</td>
                  <td>{(att.workedMinutes / 60).toFixed(1)}</td>
                  <td>{(att.otMinutes / 60).toFixed(1)}</td>
                  <td>{attStatusLabel(t, dayAttendanceStatusKey(att))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      ) : null}

      {tab === "overtime" ? (
        <div className="mt-4 space-y-3 print:hidden">
          <div className="tt-panel p-4">
            <p className="font-semibold">{t("admin.hrOvertime")}</p>
            <p className="mt-1 text-sm tabular-nums">
              {otHours.toFixed(1)} {t("admin.hrHours").toLowerCase()}
            </p>
          </div>
          {otDays.length ? (
            <TableWrap className="tt-panel">
              <table className="tt-table">
                <thead>
                  <tr>
                    <th>{t("admin.hrDate")}</th>
                    <th>{t("admin.hrOtShort")}</th>
                  </tr>
                </thead>
                <tbody>
                  {otDays.map(({ date, att }) => (
                    <tr key={date}>
                      <td>{date}</td>
                      <td>{(att.otMinutes / 60).toFixed(1)} h</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          ) : (
            <AccountsEmpty message={t("admin.hrNoOvertime")} />
          )}
        </div>
      ) : null}

      {tab === "leave" ? (
        <div className="print:hidden">
          <p className="mt-3 text-sm text-[var(--ink-muted)]">
            {t("admin.hrCasual")} {casualLeft} {t("admin.hrLeaveLeft")} · {t("admin.hrSick")}{" "}
            {sickLeft} {t("admin.hrLeaveLeft")}
          </p>
          {leaveMsg ? <p className="mt-1 text-sm">{leaveMsg}</p> : null}
          <LeavePanel
            staff={[{ id: sessionId, name: t("admin.hrMe") }]}
            leaves={leaves}
            allLeaves={leaves}
            terms={terms ? [terms] : []}
            lockUserId={sessionId}
            canDecide={false}
            onSave={(row) => {
              if (leaveQuotaBlocked(leaves, terms, row)) {
                setLeaveMsg(t("admin.hrLeaveQuota"));
                return;
              }
              persist((d) => {
                d.hrLeaves = [
                  { ...row, userId: sessionId, status: "pending" },
                  ...(d.hrLeaves ?? []),
                ];
              });
            }}
            onDecide={() => undefined}
          />
        </div>
      ) : null}

      {tab === "advances" ? (
        <div className="tt-panel mt-4 p-4 print:hidden">
          <p className="font-semibold">{t("admin.hrAdvances")}</p>
          <div className="mt-3 flex flex-wrap gap-2 print:hidden">
            <NumberField
              className="tt-input w-28"
              value={advAmt}
              emptyAs={null}
              onValueChange={(v) => setAdvAmt(v === "" ? "" : String(v))}
            />
            <input
              className="tt-input"
              placeholder={t("admin.hrAdvanceNote")}
              value={advNote}
              onChange={(e) => setAdvNote(e.target.value)}
            />
            <button
              type="button"
              className="tt-btn tt-btn-dark"
              onClick={() => {
                const amt = Number(advAmt || 0);
                if (!(amt > 0)) return;
                persist((d) => {
                  d.hrAdvances = [
                    {
                      id: `adv_${crypto.randomUUID()}`,
                      userId: sessionId,
                      date: dateInIst(new Date().toISOString()),
                      amount: amt,
                      note: advNote.trim() || undefined,
                      status: "pending",
                      createdBy: sessionId,
                      createdAt: new Date().toISOString(),
                    },
                    ...(d.hrAdvances ?? []),
                  ];
                });
                setAdvAmt("");
                setAdvNote("");
              }}
            >
              {t("admin.hrRequestAdvance")}
            </button>
          </div>
          {advances.length ? (
            <ul className="mt-3 space-y-1 text-sm">
              {advances.map((a) => (
                <li key={a.id}>
                  {a.date} · {formatInr(a.amount)}
                  {a.note ? ` · ${a.note}` : ""}
                  {` · ${
                    a.status === "pending"
                      ? t("admin.hrAdvancePending")
                      : a.status === "rejected"
                        ? t("admin.hrAdvanceRejected")
                        : a.payslipId
                          ? t("admin.hrAdvanceSettled")
                          : t("admin.hrAdvanceIssued")
                  }`}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-[var(--ink-muted)]">{t("admin.hrNoAdvances")}</p>
          )}
        </div>
      ) : null}
    </AdminShell>
  );
}

function upsertTerms(
  d: {
    hrTerms?: HrTerms[];
  },
  userId: string,
  patch: Partial<HrTerms>
) {
  const now = new Date().toISOString();
  const list = d.hrTerms ?? [];
  const idx = list.findIndex((t) => t.userId === userId);
  if (idx < 0) {
    d.hrTerms = [
      {
        id: `ht_${crypto.randomUUID()}`,
        userId,
        payBasis: "monthly",
        monthlySalary: 0,
        joinDate: now.slice(0, 10),
        weekOff: 0,
        otRatePerHour: 0,
        casualDaysPerYear: 6,
        sickDaysPerYear: 6,
        updatedAt: now,
        ...patch,
      },
      ...list,
    ];
    return;
  }
  d.hrTerms = list.map((t, i) => (i === idx ? { ...t, ...patch, updatedAt: now } : t));
}

function ShiftsPanel({
  shifts,
  onAdd,
  onChange,
}: {
  shifts: HrShift[];
  onAdd: () => void;
  onChange: (id: string, patch: Partial<HrShift>) => void;
}) {
  const t = useTranslations();
  return (
    <div className="mt-4">
      <button type="button" className="tt-btn tt-btn-dark print:hidden" onClick={onAdd}>
        {t("admin.hrAddShift")}
      </button>
      {shifts.length ? (
        <div className="mt-3 grid gap-3">
          {shifts.map((s) => (
            <div key={s.id} className="tt-panel flex flex-wrap gap-2 p-3">
              <input
                className="tt-input"
                value={s.name}
                onChange={(e) => onChange(s.id, { name: e.target.value })}
              />
              <input
                className="tt-input"
                type="time"
                value={s.start}
                onChange={(e) => onChange(s.id, { start: e.target.value })}
              />
              <input
                className="tt-input"
                type="time"
                value={s.end}
                onChange={(e) => onChange(s.id, { end: e.target.value })}
              />
              <NumberField
                className="tt-input w-20"
                value={s.graceMinutes}
                onValueChange={(v) => onChange(s.id, { graceMinutes: Number(v) || 0 })}
              />
            </div>
          ))}
        </div>
      ) : (
        <AccountsEmpty message={t("admin.hrEmptyShifts")} />
      )}
    </div>
  );
}

function SitesPanel({
  sites,
  onAdd,
  onChange,
}: {
  sites: HrSite[];
  onAdd: () => void;
  onChange: (id: string, patch: Partial<HrSite>) => void;
}) {
  const t = useTranslations();
  return (
    <div className="mt-4">
      <button type="button" className="tt-btn tt-btn-dark print:hidden" onClick={onAdd}>
        {t("admin.hrAddSite")}
      </button>
      {sites.length ? (
        <div className="mt-3 grid gap-3">
          {sites.map((s) => (
            <div key={s.id} className="tt-panel grid gap-2 p-3 sm:grid-cols-5">
              <input
                className="tt-input"
                value={s.name}
                onChange={(e) => onChange(s.id, { name: e.target.value })}
              />
              <NumberField
                className="tt-input"
                value={s.lat}
                onValueChange={(v) => onChange(s.id, { lat: Number(v) || 0 })}
              />
              <NumberField
                className="tt-input"
                value={s.lng}
                onValueChange={(v) => onChange(s.id, { lng: Number(v) || 0 })}
              />
              <NumberField
                className="tt-input"
                value={s.radiusM}
                onValueChange={(v) => onChange(s.id, { radiusM: Number(v) || 150 })}
              />
            </div>
          ))}
        </div>
      ) : (
        <AccountsEmpty message={t("admin.hrEmptySites")} />
      )}
    </div>
  );
}

function LeavePanel({
  staff,
  leaves,
  allLeaves,
  terms,
  lockUserId,
  canDecide = true,
  onSave,
  onDecide,
}: {
  staff: { id: string; name: string }[];
  leaves: HrLeave[];
  allLeaves: HrLeave[];
  terms: HrTerms[];
  lockUserId?: string;
  canDecide?: boolean;
  onSave: (row: HrLeave) => void;
  onDecide: (id: string, status: "approved" | "rejected", rejectReason?: string) => void;
}) {
  const t = useTranslations();
  const [userId, setUserId] = useState(lockUserId || staff[0]?.id || "");
  const [kind, setKind] = useState<HrLeaveKind>("casual");
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(from);
  const [reason, setReason] = useState("");
  const [rejectNote, setRejectNote] = useState("");
  const targetId = lockUserId || userId;
  const year = from.slice(0, 4);
  const personTerms = terms.find((x) => x.userId === targetId);
  const left =
    kind === "unpaid"
      ? null
      : leaveQuotaRemaining(
          allLeaves,
          personTerms,
          targetId,
          kind,
          year
        );
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2 print:hidden">
        {lockUserId ? null : (
          <select className="tt-input" value={userId} onChange={(e) => setUserId(e.target.value)}>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <select
          className="tt-input"
          value={kind}
          onChange={(e) => setKind(e.target.value as HrLeaveKind)}
        >
          <option value="casual">{t("admin.hrLeaveCasual")}</option>
          <option value="sick">{t("admin.hrLeaveSick")}</option>
          <option value="unpaid">{t("admin.hrLeaveUnpaid")}</option>
        </select>
        <input className="tt-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="tt-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <input
          className="tt-input min-w-[12rem]"
          placeholder={t("admin.hrLeaveReason")}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          type="button"
          className="tt-btn tt-btn-dark"
          onClick={() => {
            const days = inclusiveLeaveDays(from, to);
            if (days < 1) return;
            onSave({
              id: `lv_${crypto.randomUUID()}`,
              userId: targetId,
              kind,
              from,
              to,
              days,
              status: "pending",
              reason: reason.trim() || undefined,
              createdAt: new Date().toISOString(),
            });
          }}
        >
          {t("admin.hrRequestLeave")}
        </button>
      </div>
      {left != null ? (
        <p className="mt-2 text-xs text-[var(--ink-muted)]">
          {kind === "casual" ? t("admin.hrCasual") : t("admin.hrSick")} {left}{" "}
          {t("admin.hrLeaveLeft")}
        </p>
      ) : null}
      {leaves.length ? (
        <ul className="mt-4 space-y-2">
          {leaves.map((l) => (
            <li key={l.id} className="tt-panel flex flex-wrap items-center justify-between gap-2 p-3">
              <span>
                {staff.find((s) => s.id === l.userId)?.name}{" "}
                {l.kind === "sick"
                  ? t("admin.hrLeaveSick")
                  : l.kind === "unpaid"
                    ? t("admin.hrLeaveUnpaid")
                    : t("admin.hrLeaveCasual")}{" "}
                {l.from}–{l.to} ({l.days}d){" "}
                {l.status === "approved"
                  ? t("admin.hrLeaveApproved")
                  : l.status === "rejected"
                    ? t("admin.hrLeaveRejected")
                    : t("admin.hrLeavePending")}
                {l.reason ? ` · ${l.reason}` : ""}
                {l.rejectReason ? ` · ${l.rejectReason}` : ""}
              </span>
              {canDecide && l.status === "pending" ? (
                <span className="flex flex-wrap gap-2">
                  <input
                    className="tt-input"
                    placeholder={t("admin.hrRejectReason")}
                    value={rejectNote}
                    onChange={(e) => setRejectNote(e.target.value)}
                  />
                  <button
                    type="button"
                    className="tt-btn tt-btn-dark"
                    onClick={() => onDecide(l.id, "approved")}
                  >
                    {t("admin.hrApprove")}
                  </button>
                  <button
                    type="button"
                    className="tt-btn tt-btn-outline"
                    onClick={() => onDecide(l.id, "rejected", rejectNote.trim() || undefined)}
                  >
                    {t("admin.hrReject")}
                  </button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <AccountsEmpty message={t("admin.hrEmptyLeave")} />
      )}
    </div>
  );
}
