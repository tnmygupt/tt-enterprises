"use client";

import {
  useEffect,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AccountsEmpty } from "@/components/AccountsEmpty";
import { AccountsPageHeader } from "@/components/AccountsPageHeader";
import { AdminShell } from "@/components/AdminShell";
import { NumberField } from "@/components/NumberField";
import { ACCT } from "@/lib/accounting";
import { useDb, useSession } from "@/lib/hooks";
import {
  advanceExceedsNet,
  buildHrPunch,
  computePayroll,
  dateInIst,
  dayAttendanceStatusKey,
  deriveDayAttendance,
  ensureStaffHrTerms,
  inclusiveLeaveDays,
  isActivePayslip,
  isHrMonthLocked,
  isIssuedAdvance,
  leaveHasOverlap,
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
  checkCapability,
  isStaff as roleIsStaff,
  loadDb,
  recordExpense,
  saveDb,
  voidVoucher,
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
type StaffPerson = { id: string; name: string; role?: string };
type DbMut = (mut: (d: NonNullable<ReturnType<typeof loadDb>>) => void) => void;

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

function attChipClass(key: ReturnType<typeof dayAttendanceStatusKey>) {
  if (key === "present") return "tt-hr-chip tt-hr-chip-ok";
  if (key === "presentLate" || key === "half" || key === "halfMissing") {
    return "tt-hr-chip tt-hr-chip-warn";
  }
  if (key === "absentOutside") return "tt-hr-chip tt-hr-chip-bad";
  return "tt-hr-chip";
}

function weekOffLabel(t: ReturnType<typeof useTranslations>, day: number) {
  const keys = [
    "admin.hrSun",
    "admin.hrMon",
    "admin.hrTue",
    "admin.hrWed",
    "admin.hrThu",
    "admin.hrFri",
    "admin.hrSat",
  ] as const;
  return t(keys[((day % 7) + 7) % 7]);
}

function payRateText(t: ReturnType<typeof useTranslations>, terms?: HrTerms) {
  const basis: HrPayBasis = terms?.payBasis || "monthly";
  const rate =
    basis === "daily"
      ? terms?.dailyWage ?? 0
      : basis === "hourly"
        ? terms?.hourlyRate ?? 0
        : terms?.monthlySalary ?? 0;
  const unit =
    basis === "daily"
      ? t("admin.hrDaily")
      : basis === "hourly"
        ? t("admin.hrHourly")
        : t("admin.hrMonthly");
  return `${unit} · ${formatInr(rate)}`;
}

function HrField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`tt-hr-field ${className}`.trim()}>
      <span className="tt-hr-label">{label}</span>
      {children}
    </label>
  );
}

function summarizeMonthAttendance(
  month: string,
  userId: string,
  db: ReturnType<typeof loadDb> | null
) {
  const dates = monthDateList(month);
  const terms = (db?.hrTerms ?? []).find((x) => x.userId === userId);
  const shift = (db?.hrShifts ?? []).find((s) => s.id === terms?.shiftId);
  let present = 0;
  let half = 0;
  let late = 0;
  let missing = 0;
  let outside = 0;
  let weak = 0;
  let minutes = 0;
  let absent = 0;
  let paidLeave = 0;
  for (const date of dates) {
    const att = deriveDayAttendance(
      db?.hrPunches ?? [],
      userId,
      date,
      shift,
      terms?.halfDayHours
    );
    const onLeave = (db?.hrLeaves ?? []).some(
      (l) =>
        l.userId === userId &&
        l.status === "approved" &&
        (l.kind === "casual" || l.kind === "sick") &&
        date >= l.from &&
        date <= l.to
    );
    if (onLeave) paidLeave += 1;
    if (att.present) present += 1;
    if (att.half) half += 1;
    if (att.late) late += 1;
    if (att.missingOut) missing += 1;
    if (att.outsideFence) outside += 1;
    if (att.weakGps) weak += 1;
    minutes += att.workedMinutes;
    if (!att.present && !att.half && !onLeave) absent += 1;
  }
  return { present, half, late, missing, outside, weak, minutes, absent, paidLeave };
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

  const ownerHr = checkCapability(session, db, "manage_hr");
  const allowed = session ? roleIsStaff(session.role) : false;
  const staff = (db?.users ?? []).filter((u) => u.role !== "customer" && u.active);

  const persist: DbMut = (mut) => {
    const live = loadDb();
    mut(live);
    saveDb(live);
    refresh();
  };

  useEffect(() => {
    if (!ownerHr || !db) return;
    const missing = staff.some(
      (u) => !(db.hrTerms ?? []).some((row) => row.userId === u.id)
    );
    if (!missing) return;
    persist((d) => {
      ensureStaffHrTerms(d, staff);
    });
    // persist already refreshes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerHr, db, staff.length]);

  if (ready && !allowed) {
    return (
      <AdminShell>
        <AdminAccessDenied />
      </AdminShell>
    );
  }

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
  const needsMonth = tab === "attendance" || tab === "leave" || tab === "pay";
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
      <div className="tt-hr-toolbar print:hidden">
        <div className="tt-hr-tabs" role="tablist">
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`tt-btn ${tab === id ? "tt-btn-dark" : "tt-btn-outline"}`}
              onClick={() => {
                setTab(id);
                setDetailUserId(null);
              }}
            >
              {t(
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
              )}
            </button>
          ))}
        </div>
        {needsMonth ? (
          <HrField label={t("admin.hrMonth")} className="tt-hr-month">
            <input
              className="tt-input tt-hr-month"
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
          </HrField>
        ) : null}
      </div>
      {msg ? <p className="mt-2 text-sm print:hidden">{msg}</p> : null}

      {tab === "people" ? (
        staff.length ? (
          <PeopleDesk staff={staff} db={db} persist={persist} />
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
          persist={persist}
          sessionId={session?.id || ""}
          setMsg={setMsg}
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
            if (leaveHasOverlap(db?.hrLeaves ?? [], row)) {
              setMsg(t("admin.hrLeaveOverlap"));
              return;
            }
            persist((d) => {
              d.hrLeaves = [
                {
                  ...row,
                  status: "approved",
                  decidedBy: session?.id,
                  decidedAt: new Date().toISOString(),
                },
                ...(d.hrLeaves ?? []),
              ];
            });
          }}
          onDecide={(id, status, rejectReason) =>
            persist((d) => {
              const row = (d.hrLeaves ?? []).find((l) => l.id === id);
              if (
                status === "approved" &&
                row &&
                leaveQuotaBlocked(
                  d.hrLeaves ?? [],
                  (d.hrTerms ?? []).find((x) => x.userId === row.userId),
                  row
                )
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
          onCancel={(id) =>
            persist((d) => {
              d.hrLeaves = (d.hrLeaves ?? []).map((l) =>
                l.id === id
                  ? {
                      ...l,
                      status: "cancelled",
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

function PeopleDesk({
  staff,
  db,
  persist,
}: {
  staff: StaffPerson[];
  db: ReturnType<typeof loadDb> | null;
  persist: DbMut;
}) {
  const t = useTranslations();
  const [editId, setEditId] = useState<string | null>(null);
  const person = staff.find((u) => u.id === editId);
  const terms = person
    ? (db?.hrTerms ?? []).find((x) => x.userId === person.id)
    : undefined;
  const basis: HrPayBasis = terms?.payBasis || "monthly";
  const rateValue =
    basis === "daily"
      ? terms?.dailyWage ?? 0
      : basis === "hourly"
        ? terms?.hourlyRate ?? 0
        : terms?.monthlySalary ?? 0;
  const sites = db?.hrSites ?? [];
  const assigned = terms?.siteIds ?? [];
  const allSites = assigned.length === 0;

  return (
    <div className="tt-hr-people">
      <div className="tt-acct-cards">
        {staff.map((u) => {
          const row = (db?.hrTerms ?? []).find((x) => x.userId === u.id);
          const shift = (db?.hrShifts ?? []).find((s) => s.id === row?.shiftId);
          return (
            <button
              key={u.id}
              type="button"
              className={`tt-panel tt-acct-card ${editId === u.id ? "tt-hr-selected" : ""}`}
              onClick={() => setEditId(editId === u.id ? null : u.id)}
            >
              <p className="font-semibold">{u.name}</p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                {payRateText(t, row)} · {shift?.name || t("admin.hrNoShift")} ·{" "}
                {weekOffLabel(t, row?.weekOff ?? 0)}
              </p>
            </button>
          );
        })}
      </div>
      {person ? (
        <div className="tt-panel p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{person.name}</p>
              <p className="mt-1 text-xs text-[var(--ink-muted)]">{t("admin.hrAutosave")}</p>
            </div>
            <button
              type="button"
              className="tt-btn tt-btn-outline"
              onClick={() => setEditId(null)}
            >
              {t("admin.hrDone")}
            </button>
          </div>

          <p className="tt-hr-section mt-5">{t("admin.hrPayTerms")}</p>
          <div className="tt-hr-grid">
            <HrField label={t("admin.hrPayBasis")}>
              <select
                className="tt-input"
                value={basis}
                onChange={(e) =>
                  persist((d) =>
                    upsertTerms(d, person.id, {
                      payBasis: e.target.value as HrPayBasis,
                    })
                  )
                }
              >
                <option value="monthly">{t("admin.hrMonthly")}</option>
                <option value="daily">{t("admin.hrDaily")}</option>
                <option value="hourly">{t("admin.hrHourly")}</option>
              </select>
            </HrField>
            <HrField label={t("admin.hrPayRate")}>
              <NumberField
                className="tt-input"
                value={rateValue}
                onValueChange={(v) =>
                  persist((d) =>
                    upsertTerms(
                      d,
                      person.id,
                      basis === "daily"
                        ? { dailyWage: Number(v) || 0 }
                        : basis === "hourly"
                          ? { hourlyRate: Number(v) || 0 }
                          : { monthlySalary: Number(v) || 0 }
                    )
                  )
                }
              />
            </HrField>
            <HrField label={t("admin.hrOtRate")}>
              <NumberField
                className="tt-input"
                value={terms?.otRatePerHour ?? 0}
                onValueChange={(v) =>
                  persist((d) =>
                    upsertTerms(d, person.id, { otRatePerHour: Number(v) || 0 })
                  )
                }
              />
            </HrField>
            <HrField label={t("admin.hrOtMult")}>
              <select
                className="tt-input"
                value={String(terms?.otMultiplier ?? 1)}
                onChange={(e) =>
                  persist((d) =>
                    upsertTerms(d, person.id, {
                      otMultiplier: Number(e.target.value) || 1,
                    })
                  )
                }
              >
                <option value="1">1×</option>
                <option value="1.5">1.5×</option>
                <option value="2">2×</option>
              </select>
            </HrField>
          </div>

          <p className="tt-hr-section mt-5">{t("admin.hrSchedule")}</p>
          <div className="tt-hr-grid">
            <HrField label={t("admin.hrWeekOff")}>
              <select
                className="tt-input"
                value={terms?.weekOff ?? 0}
                onChange={(e) =>
                  persist((d) =>
                    upsertTerms(d, person.id, { weekOff: Number(e.target.value) })
                  )
                }
              >
                {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                  <option key={d} value={d}>
                    {weekOffLabel(t, d)}
                  </option>
                ))}
              </select>
            </HrField>
            <HrField label={t("admin.hrShift")}>
              <select
                className="tt-input"
                value={terms?.shiftId || ""}
                onChange={(e) =>
                  persist((d) => upsertTerms(d, person.id, { shiftId: e.target.value }))
                }
              >
                <option value="">{t("admin.hrNoShift")}</option>
                {(db?.hrShifts ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </HrField>
            <HrField label={t("admin.hrJoinDate")}>
              <input
                className="tt-input"
                type="date"
                value={terms?.joinDate || ""}
                onChange={(e) =>
                  persist((d) => upsertTerms(d, person.id, { joinDate: e.target.value }))
                }
              />
            </HrField>
            <HrField label={t("admin.hrHalfDayHours")}>
              <NumberField
                className="tt-input"
                value={terms?.halfDayHours ?? ""}
                emptyAs={null}
                onValueChange={(v) =>
                  persist((d) =>
                    upsertTerms(d, person.id, {
                      halfDayHours: typeof v === "number" && v > 0 ? v : undefined,
                    })
                  )
                }
              />
            </HrField>
          </div>

          <p className="tt-hr-section mt-5">{t("admin.hrLeaveQuotaLabel")}</p>
          <div className="tt-hr-grid">
            <HrField label={t("admin.hrCasual")}>
              <NumberField
                className="tt-input"
                value={terms?.casualDaysPerYear ?? 6}
                onValueChange={(v) =>
                  persist((d) =>
                    upsertTerms(d, person.id, {
                      casualDaysPerYear: Number(v) || 0,
                    })
                  )
                }
              />
            </HrField>
            <HrField label={t("admin.hrSick")}>
              <NumberField
                className="tt-input"
                value={terms?.sickDaysPerYear ?? 6}
                onValueChange={(v) =>
                  persist((d) =>
                    upsertTerms(d, person.id, { sickDaysPerYear: Number(v) || 0 })
                  )
                }
              />
            </HrField>
            <label className="tt-hr-check sm:col-span-2">
              <input
                type="checkbox"
                checked={!!terms?.requireSelfie}
                onChange={(e) =>
                  persist((d) =>
                    upsertTerms(d, person.id, { requireSelfie: e.target.checked })
                  )
                }
              />
              {t("admin.hrRequireSelfie")}
            </label>
          </div>

          <p className="tt-hr-section mt-5">{t("admin.hrAssignedSites")}</p>
          <p className="mb-2 text-xs text-[var(--ink-muted)]">{t("admin.hrSitesHint")}</p>
          <div className="tt-hr-sites">
            <label className="tt-hr-check">
              <input
                type="checkbox"
                checked={allSites}
                onChange={() =>
                  persist((d) => upsertTerms(d, person.id, { siteIds: undefined }))
                }
              />
              {t("admin.hrAllSites")}
            </label>
            {sites.map((s) => {
              const on = assigned.includes(s.id);
              return (
                <label key={s.id} className="tt-hr-check">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const next = on
                        ? assigned.filter((id) => id !== s.id)
                        : [...assigned, s.id];
                      persist((d) =>
                        upsertTerms(d, person.id, {
                          siteIds: next.length ? next : undefined,
                        })
                      );
                    }}
                  />
                  {s.name}
                </label>
              );
            })}
          </div>
        </div>
      ) : (
        <p className="text-sm text-[var(--ink-muted)]">{t("admin.hrTapPerson")}</p>
      )}
    </div>
  );
}

function OwnerAttendance({
  month,
  staff,
  db,
  detailUserId,
  onOpen,
  persist,
  sessionId,
  setMsg,
}: {
  month: string;
  staff: StaffPerson[];
  db: ReturnType<typeof loadDb> | null;
  detailUserId: string | null;
  onOpen: (id: string | null) => void;
  persist: DbMut;
  sessionId: string;
  setMsg: (s: string) => void;
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
        <div className="tt-panel mt-3 px-4 print:hidden">
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
            const key = dayAttendanceStatusKey(att);
            return (
              <AttendanceDayRow
                key={date}
                date={date}
                inAt={att.inAt}
                outAt={att.outAt}
                hours={(att.workedMinutes / 60).toFixed(1)}
                ot={(att.otMinutes / 60).toFixed(1)}
                status={attStatusLabel(t, key)}
                chipClass={attChipClass(key)}
                weakGps={!!att.weakGps}
                photo={photo}
                userId={detail.id}
                sessionId={sessionId}
                db={db}
                persist={persist}
                setMsg={setMsg}
              />
            );
          })}
        </div>
        <div className="tt-panel tt-acct-table-wrap mt-3 hidden print:block">
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
              {dates.map((date) => {
                const att = deriveDayAttendance(
                  db?.hrPunches ?? [],
                  detail.id,
                  date,
                  shift,
                  terms?.halfDayHours
                );
                return (
                  <tr key={date}>
                    <td>{date}</td>
                    <td>{att.inAt ? att.inAt.slice(11, 16) : "—"}</td>
                    <td>{att.outAt ? att.outAt.slice(11, 16) : "—"}</td>
                    <td>{(att.workedMinutes / 60).toFixed(1)}</td>
                    <td>{(att.otMinutes / 60).toFixed(1)}</td>
                    <td>{attStatusLabel(t, dayAttendanceStatusKey(att))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const exportBar = (
    <div className="mb-3 flex flex-wrap gap-2 print:hidden">
      <button type="button" className="tt-btn tt-btn-outline" onClick={() => printHrPage()}>
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
      <button
        type="button"
        className="tt-btn tt-btn-outline"
        onClick={() => downloadAttendanceCsv(month, staff, db, t)}
      >
        {t("admin.hrCsvAttendance")}
      </button>
    </div>
  );

  return (
    <div className="mt-4">
      {exportBar}
      <div className="tt-acct-cards lg:hidden">
        {staff.map((u) => {
          const s = summarizeMonthAttendance(month, u.id, db);
          return (
            <button
              key={u.id}
              type="button"
              className="tt-panel tt-acct-card"
              onClick={() => onOpen(u.id)}
            >
              <p className="font-semibold">{u.name}</p>
              <div className="tt-hr-kpis mt-3">
                <div className="tt-hr-kpi">
                  <p className="text-[0.7rem] font-bold uppercase text-[var(--ink-muted)]">
                    {t("admin.hrPresent")}
                  </p>
                  <p className="tt-hr-kpi-n">{s.present}</p>
                </div>
                <div className="tt-hr-kpi">
                  <p className="text-[0.7rem] font-bold uppercase text-[var(--ink-muted)]">
                    {t("admin.hrHours")}
                  </p>
                  <p className="tt-hr-kpi-n">{(s.minutes / 60).toFixed(1)}</p>
                </div>
                <div className="tt-hr-kpi">
                  <p className="text-[0.7rem] font-bold uppercase text-[var(--ink-muted)]">
                    {t("admin.hrAbsent")}
                  </p>
                  <p className="tt-hr-kpi-n">{s.absent}</p>
                </div>
              </div>
              <p className="mt-2 text-xs text-[var(--ink-muted)]">
                {t("admin.hrLate")} {s.late} · {t("admin.hrMissingOut")} {s.missing} ·{" "}
                {t("admin.hrPaidLeave")} {s.paidLeave}
              </p>
            </button>
          );
        })}
      </div>
      <div className="tt-panel tt-acct-table-wrap hidden lg:block">
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
              <th>{t("admin.hrAbsent")}</th>
              <th>{t("admin.hrPaidLeave")}</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((u) => {
              const s = summarizeMonthAttendance(month, u.id, db);
              return (
                <tr
                  key={u.id}
                  className="cursor-pointer hover:bg-[var(--brand-soft)]"
                  onClick={() => onOpen(u.id)}
                >
                  <td>{u.name}</td>
                  <td>{s.present}</td>
                  <td>{s.half}</td>
                  <td>{(s.minutes / 60).toFixed(1)}</td>
                  <td>{s.late}</td>
                  <td>{s.missing}</td>
                  <td>{s.outside}</td>
                  <td>{s.weak}</td>
                  <td>{s.absent}</td>
                  <td>{s.paidLeave}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AttendanceDayRow({
  date,
  inAt,
  outAt,
  hours,
  ot,
  status,
  chipClass,
  weakGps,
  photo,
  userId,
  sessionId,
  db,
  persist,
  setMsg,
}: {
  date: string;
  inAt?: string;
  outAt?: string;
  hours: string;
  ot: string;
  status: string;
  chipClass: string;
  weakGps: boolean;
  photo?: string;
  userId: string;
  sessionId: string;
  db: ReturnType<typeof loadDb> | null;
  persist: DbMut;
  setMsg: (s: string) => void;
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  return (
    <div className="tt-hr-day-wrap border-b border-[var(--line)] last:border-b-0">
      <div className="tt-hr-day">
        <p className="font-semibold tabular-nums">{date.slice(5)}</p>
        <div className="min-w-0">
          <p className="text-sm tabular-nums">
            {inAt ? inAt.slice(11, 16) : "—"} – {outAt ? outAt.slice(11, 16) : "—"}
          </p>
          <p className="text-xs text-[var(--ink-muted)]">
            {hours}h · {t("admin.hrOtShort")} {ot}h
            {weakGps ? ` · ${t("admin.hrWeakGps")}` : ""}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={chipClass}>{status}</span>
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="h-8 w-8 rounded object-cover" />
          ) : null}
          <button
            type="button"
            className="text-xs font-semibold text-[var(--brand-deep)] underline"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? t("admin.hrHideCorrect") : t("admin.hrCorrectDay")}
          </button>
        </div>
      </div>
      {open ? (
        <div className="pb-3 print:hidden">
          <OwnerPunchCorrect
            userId={userId}
            date={date}
            sessionId={sessionId}
            db={db}
            persist={persist}
            setMsg={setMsg}
          />
        </div>
      ) : null}
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
  staff: StaffPerson[];
  db: ReturnType<typeof loadDb> | null;
  sessionId: string;
  advDraft: Record<string, string>;
  setAdvDraft: Dispatch<SetStateAction<Record<string, string>>>;
  persist: DbMut;
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
        (p) => p.userId === u.id && p.month === month && isActivePayslip(p)
      );
      const slips = (db?.hrPayslips ?? []).filter(
        (p) => p.userId === u.id && p.month === month
      );
      const pending = (db?.hrAdvances ?? []).filter(
        (a) => a.userId === u.id && a.status === "pending"
      );
      return { u, terms, pay, existing, pending, slips };
    })
    .filter(Boolean) as {
    u: StaffPerson;
    terms: HrTerms;
    pay: ReturnType<typeof computePayroll>;
    existing?: { id: string; expenseVoucherId?: string };
    pending: HrAdvance[];
    slips: {
      id: string;
      net: number;
      voided?: boolean;
      expenseVoucherId?: string;
      createdAt: string;
    }[];
  }[];

  if (!cards.length) {
    return <AccountsEmpty message={t("admin.hrEmptyPeople")} />;
  }

  return (
    <div className="mt-4 space-y-3">
      {cards.map(({ u, pay, existing, pending, slips }) => (
        <div
          key={u.id}
          className={`tt-panel p-4 print:break-after-page ${printTarget && printTarget !== u.id ? "print:hidden" : ""}`}
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-semibold">
                {t("admin.hrPayslipTitle")} · {u.name}
              </p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">{month}</p>
              <span className={`mt-2 ${existing ? "tt-hr-chip tt-hr-chip-ok" : "tt-hr-chip"}`}>
                {existing ? t("admin.hrIssued") : t("admin.hrNotIssued")}
              </span>
            </div>
            <div className="text-right">
              <p className="text-xs font-bold uppercase text-[var(--ink-muted)]">
                {t("admin.hrNet")}
              </p>
              <p className="tt-hr-net">{formatInr(pay.net)}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-[var(--ink-muted)]">
            {t("admin.hrFormula")}: {pay.formula}
          </p>
          <dl className="tt-hr-dl">
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
            <div className="mt-3 rounded-lg bg-[var(--surface-2)] p-3 text-sm">
              <p className="font-medium">{t("admin.hrPendingAdvances")}</p>
              {pending.map((a) => (
                <div key={a.id} className="mt-2 flex flex-wrap items-center gap-2">
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
                          if (advanceExceedsNet(a.amount, pay.net + a.amount)) {
                            setMsg(t("admin.hrAdvanceCap"));
                            return;
                          }
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
          <div className="mt-4 grid gap-3 print:hidden sm:grid-cols-2">
            <HrField label={t("admin.hrAdvanceAmount")}>
              <NumberField
                className="tt-input"
                value={advDraft[u.id] ?? ""}
                emptyAs={null}
                onValueChange={(v) =>
                  setAdvDraft((s) => ({ ...s, [u.id]: v === "" ? "" : String(v) }))
                }
              />
            </HrField>
            <div className="flex flex-wrap items-end gap-2">
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                onClick={() => {
                  const amt = Number(advDraft[u.id] || 0);
                  if (!sessionId || !(amt > 0)) return;
                  if (advanceExceedsNet(amt, pay.net)) {
                    setMsg(t("admin.hrAdvanceCap"));
                    return;
                  }
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
            </div>
          </div>
          <p className="tt-hr-section mt-4 print:hidden">{t("admin.hrActions")}</p>
          <div className="flex flex-wrap gap-2 print:hidden">
            <button
              type="button"
              className="tt-btn tt-btn-dark"
              disabled={!!existing}
              onClick={() => {
                if (!sessionId || existing) return;
                let expenseVoucherId: string | undefined;
                if (pay.net > 0) {
                  try {
                    const v = recordExpense({
                      accountId: ACCT.salary,
                      amount: pay.net,
                      date: `${month}-28`,
                      cashAccountId: ACCT.cash,
                      narration: `Payslip ${month} ${u.name}`,
                      createdBy: sessionId,
                    });
                    expenseVoucherId = v.id;
                  } catch (err) {
                    setMsg(
                      err instanceof Error ? err.message : t("admin.hrPayslipExpenseSkip")
                    );
                  }
                }
                persist((d) => {
                  const slip = {
                    id: `ps_${crypto.randomUUID()}`,
                    userId: u.id,
                    month,
                    ...pay,
                    expenseVoucherId,
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
                setMsg(`${t("admin.hrPayslipSaved")} ${u.name} ${month}`);
              }}
            >
              {t("admin.hrIssuePayslip")}
            </button>
            {existing ? (
              <button
                type="button"
                className="tt-btn tt-btn-outline"
                onClick={() => {
                  persist((d) => {
                    const slip = (d.hrPayslips ?? []).find((p) => p.id === existing.id);
                    if (!slip || slip.voided) return;
                    slip.voided = true;
                    slip.voidedAt = new Date().toISOString();
                    slip.voidedBy = sessionId;
                    for (const a of d.hrAdvances ?? []) {
                      if (a.payslipId === slip.id) a.payslipId = undefined;
                    }
                  });
                  if (existing.expenseVoucherId) {
                    try {
                      voidVoucher(existing.expenseVoucherId, sessionId);
                    } catch {
                      /* already voided */
                    }
                  }
                  refresh();
                  setMsg(t("admin.hrPayslipVoided"));
                }}
              >
                {t("admin.hrVoidPayslip")}
              </button>
            ) : null}
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
          {slips.length ? (
            <ul className="mt-3 space-y-1 text-xs print:hidden">
              <li className="font-semibold">{t("admin.hrIssuedPayslips")}</li>
              {slips.map((s) => (
                <li key={s.id}>
                  {s.createdAt.slice(0, 10)} · {formatInr(s.net)}
                  {s.voided ? ` · ${t("admin.hrPayslipVoided")}` : ""}
                  {s.expenseVoucherId && !s.voided
                    ? ` · ${t("admin.hrExpenseVoucher")} ${s.expenseVoucherId.slice(-6)}`
                    : ""}
                </li>
              ))}
            </ul>
          ) : null}
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
  persist: DbMut;
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
      <div className="tt-hr-toolbar print:hidden">
        <div className="tt-hr-tabs">
          {tabs.map(([id, key]) => (
            <button
              key={id}
              type="button"
              className={`tt-btn ${tab === id ? "tt-btn-dark" : "tt-btn-outline"}`}
              onClick={() => setTab(id)}
            >
              {t(key)}
            </button>
          ))}
        </div>
        <HrField label={t("admin.hrMonth")} className="tt-hr-month">
          <input
            className="tt-input tt-hr-month"
            type="month"
            value={month}
            onChange={(e) => onMonth(e.target.value)}
          />
        </HrField>
        <button type="button" className="tt-btn tt-btn-outline" onClick={() => printHrPage()}>
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
        <div className="tt-panel mt-4 px-4 print:hidden">
          {days.map(({ date, att }) => {
            const key = dayAttendanceStatusKey(att);
            return (
              <div key={date} className="tt-hr-day">
                <p className="font-semibold tabular-nums">{date.slice(5)}</p>
                <div>
                  <p className="text-sm tabular-nums">
                    {att.inAt ? att.inAt.slice(11, 16) : "—"} –{" "}
                    {att.outAt ? att.outAt.slice(11, 16) : "—"}
                  </p>
                  <p className="text-xs text-[var(--ink-muted)]">
                    {(att.workedMinutes / 60).toFixed(1)}h · {t("admin.hrOtShort")}{" "}
                    {(att.otMinutes / 60).toFixed(1)}h
                  </p>
                </div>
                <span className={attChipClass(key)}>{attStatusLabel(t, key)}</span>
              </div>
            );
          })}
        </div>
      ) : null}

      {tab === "overtime" ? (
        <div className="mt-4 space-y-3 print:hidden">
          <div className="tt-panel p-4">
            <p className="font-semibold">{t("admin.hrOvertime")}</p>
            <p className="tt-hr-net mt-1">{otHours.toFixed(1)}h</p>
          </div>
          {otDays.length ? (
            <div className="tt-panel px-4">
              {otDays.map(({ date, att }) => (
                <div key={date} className="tt-hr-day">
                  <p className="font-semibold tabular-nums">{date}</p>
                  <p className="text-sm">{(att.otMinutes / 60).toFixed(1)} h</p>
                  <span />
                </div>
              ))}
            </div>
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
              if (leaveHasOverlap(leaves, { ...row, userId: sessionId })) {
                setLeaveMsg(t("admin.hrLeaveOverlap"));
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
            onCancel={(id) =>
              persist((d) => {
                d.hrLeaves = (d.hrLeaves ?? []).map((l) =>
                  l.id === id && l.userId === sessionId && l.status === "pending"
                    ? { ...l, status: "cancelled" }
                    : l
                );
              })
            }
          />
        </div>
      ) : null}

      {tab === "advances" ? (
        <div className="tt-panel mt-4 p-4 print:hidden">
          <p className="font-semibold">{t("admin.hrAdvances")}</p>
          <div className="tt-hr-grid mt-3">
            <HrField label={t("admin.hrAdvanceAmount")}>
              <NumberField
                className="tt-input"
                value={advAmt}
                emptyAs={null}
                onValueChange={(v) => setAdvAmt(v === "" ? "" : String(v))}
              />
            </HrField>
            <HrField label={t("admin.hrAdvanceNote")}>
              <input
                className="tt-input"
                value={advNote}
                onChange={(e) => setAdvNote(e.target.value)}
              />
            </HrField>
          </div>
          <button
            type="button"
            className="tt-btn tt-btn-dark mt-3"
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
          {advances.length ? (
            <ul className="mt-3 space-y-2 text-sm">
              {advances.map((a) => (
                <li key={a.id} className="rounded-lg bg-[var(--surface-2)] p-3">
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
  const idx = list.findIndex((row) => row.userId === userId);
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
  d.hrTerms = list.map((row, i) => (i === idx ? { ...row, ...patch, updatedAt: now } : row));
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
            <div key={s.id} className="tt-panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <HrField label={t("admin.hrShiftName")} className="sm:col-span-2 lg:col-span-1">
                <input
                  className="tt-input"
                  value={s.name}
                  onChange={(e) => onChange(s.id, { name: e.target.value })}
                />
              </HrField>
              <HrField label={t("admin.hrShiftStart")}>
                <input
                  className="tt-input"
                  type="time"
                  value={s.start}
                  onChange={(e) => onChange(s.id, { start: e.target.value })}
                />
              </HrField>
              <HrField label={t("admin.hrShiftEnd")}>
                <input
                  className="tt-input"
                  type="time"
                  value={s.end}
                  onChange={(e) => onChange(s.id, { end: e.target.value })}
                />
              </HrField>
              <HrField label={t("admin.hrGrace")}>
                <NumberField
                  className="tt-input"
                  value={s.graceMinutes}
                  onValueChange={(v) => onChange(s.id, { graceMinutes: Number(v) || 0 })}
                />
              </HrField>
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
            <div key={s.id} className="tt-panel grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
              <HrField label={t("admin.hrSiteName")}>
                <input
                  className="tt-input"
                  value={s.name}
                  onChange={(e) => onChange(s.id, { name: e.target.value })}
                />
              </HrField>
              <HrField label={t("admin.hrLat")}>
                <NumberField
                  className="tt-input"
                  value={s.lat}
                  onValueChange={(v) => onChange(s.id, { lat: Number(v) || 0 })}
                />
              </HrField>
              <HrField label={t("admin.hrLng")}>
                <NumberField
                  className="tt-input"
                  value={s.lng}
                  onValueChange={(v) => onChange(s.id, { lng: Number(v) || 0 })}
                />
              </HrField>
              <HrField label={t("admin.hrRadiusM")}>
                <NumberField
                  className="tt-input"
                  value={s.radiusM}
                  onValueChange={(v) => onChange(s.id, { radiusM: Number(v) || 150 })}
                />
              </HrField>
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
  onCancel,
}: {
  staff: StaffPerson[];
  leaves: HrLeave[];
  allLeaves: HrLeave[];
  terms: HrTerms[];
  lockUserId?: string;
  canDecide?: boolean;
  onSave: (row: HrLeave) => void;
  onDecide: (id: string, status: "approved" | "rejected", rejectReason?: string) => void;
  onCancel?: (id: string) => void;
}) {
  const t = useTranslations();
  const [userId, setUserId] = useState(lockUserId || staff[0]?.id || "");
  const [kind, setKind] = useState<HrLeaveKind>("casual");
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(from);
  const [reason, setReason] = useState("");
  const [rejectNotes, setRejectNotes] = useState<Record<string, string>>({});
  const targetId = lockUserId || userId;
  const year = from.slice(0, 4);
  const personTerms = terms.find((x) => x.userId === targetId);
  const left =
    kind === "unpaid"
      ? null
      : leaveQuotaRemaining(allLeaves, personTerms, targetId, kind, year);
  return (
    <div className="mt-4">
      <div className="tt-panel p-4 print:hidden">
        <p className="font-semibold">
          {canDecide ? t("admin.hrOwnerLeave") : t("admin.hrRequestLeave")}
        </p>
        <div className="tt-hr-grid tt-hr-grid-3 mt-3">
          {lockUserId ? null : (
            <HrField label={t("admin.hrStaff")}>
              <select
                className="tt-input"
                value={userId}
                onChange={(e) => setUserId(e.target.value)}
              >
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </HrField>
          )}
          <HrField label={t("admin.hrLeave")}>
            <select
              className="tt-input"
              value={kind}
              onChange={(e) => setKind(e.target.value as HrLeaveKind)}
            >
              <option value="casual">{t("admin.hrLeaveCasual")}</option>
              <option value="sick">{t("admin.hrLeaveSick")}</option>
              <option value="unpaid">{t("admin.hrLeaveUnpaid")}</option>
            </select>
          </HrField>
          <HrField label={t("admin.hrFrom")}>
            <input
              className="tt-input"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </HrField>
          <HrField label={t("admin.hrTo")}>
            <input
              className="tt-input"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </HrField>
          <HrField label={t("admin.hrLeaveReason")} className="sm:col-span-2">
            <input
              className="tt-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </HrField>
        </div>
        <button
          type="button"
          className="tt-btn tt-btn-dark mt-3"
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
          {canDecide ? t("admin.hrOwnerLeave") : t("admin.hrRequestLeave")}
        </button>
        {left != null ? (
          <p className="mt-2 text-xs text-[var(--ink-muted)]">
            {kind === "casual" ? t("admin.hrCasual") : t("admin.hrSick")} {left}{" "}
            {t("admin.hrLeaveLeft")}
          </p>
        ) : null}
      </div>
      {leaves.length ? (
        <ul className="mt-4 space-y-2">
          {leaves.map((l) => (
            <li key={l.id} className="tt-panel p-4">
              <p className="font-semibold">{staff.find((s) => s.id === l.userId)?.name}</p>
              <p className="mt-1 text-sm">
                {l.kind === "sick"
                  ? t("admin.hrLeaveSick")
                  : l.kind === "unpaid"
                    ? t("admin.hrLeaveUnpaid")
                    : t("admin.hrLeaveCasual")}{" "}
                {l.from}–{l.to} ({l.days}d)
              </p>
              <p className="mt-1 text-sm text-[var(--ink-muted)]">
                {l.status === "approved"
                  ? t("admin.hrLeaveApproved")
                  : l.status === "rejected"
                    ? t("admin.hrLeaveRejected")
                    : l.status === "cancelled"
                      ? t("admin.hrLeaveCancelled")
                      : t("admin.hrLeavePending")}
                {l.reason ? ` · ${l.reason}` : ""}
                {l.rejectReason ? ` · ${l.rejectReason}` : ""}
              </p>
              <div className="mt-3 flex flex-col gap-2 print:hidden">
                {canDecide && l.status === "pending" ? (
                  <>
                    <input
                      className="tt-input"
                      placeholder={t("admin.hrRejectReason")}
                      value={rejectNotes[l.id] ?? ""}
                      onChange={(e) =>
                        setRejectNotes((cur) => ({ ...cur, [l.id]: e.target.value }))
                      }
                    />
                    <div className="flex flex-wrap gap-2">
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
                        onClick={() =>
                          onDecide(l.id, "rejected", rejectNotes[l.id]?.trim() || undefined)
                        }
                      >
                        {t("admin.hrReject")}
                      </button>
                    </div>
                  </>
                ) : null}
                {onCancel && (l.status === "pending" || (canDecide && l.status === "approved")) ? (
                  <button
                    type="button"
                    className="tt-btn tt-btn-outline self-start"
                    onClick={() => onCancel(l.id)}
                  >
                    {t("admin.hrCancelLeave")}
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <AccountsEmpty message={t("admin.hrEmptyLeave")} />
      )}
    </div>
  );
}

function OwnerPunchCorrect({
  userId,
  date,
  sessionId,
  db,
  persist,
  setMsg,
}: {
  userId: string;
  date: string;
  sessionId: string;
  db: ReturnType<typeof loadDb> | null;
  persist: DbMut;
  setMsg: (s: string) => void;
}) {
  const t = useTranslations();
  const [kind, setKind] = useState<"in" | "out">("in");
  const [time, setTime] = useState("09:00");
  return (
    <div className="tt-hr-grid rounded-xl bg-[var(--surface-2)] p-3">
      <HrField label={t("admin.hrCorrectPunch")}>
        <select
          className="tt-input"
          value={kind}
          onChange={(e) => setKind(e.target.value as "in" | "out")}
        >
          <option value="in">{t("admin.hrClockIn")}</option>
          <option value="out">{t("admin.hrClockOut")}</option>
        </select>
      </HrField>
      <HrField label={t("admin.hrPunchTime")}>
        <input
          className="tt-input"
          type="time"
          value={time}
          onChange={(e) => setTime(e.target.value)}
        />
      </HrField>
      <button
        type="button"
        className="tt-btn tt-btn-dark self-end"
        onClick={() => {
          if (
            isHrMonthLocked({
              month: date.slice(0, 7),
              userId,
              audits: db?.monthlyAudits,
              payslips: db?.hrPayslips,
            })
          ) {
            setMsg(t("admin.hrPayrollLocked"));
            return;
          }
          const at = new Date(`${date}T${time}:00+05:30`).toISOString();
          persist((d) => {
            d.hrPunches = (d.hrPunches ?? []).filter(
              (p) =>
                !(p.userId === userId && dateInIst(p.at) === date && p.kind === kind)
            );
            d.hrPunches = [
              buildHrPunch({
                userId,
                kind,
                at,
                sites: d.hrSites ?? [],
                gpsFallback: true,
                correctedBy: sessionId,
              }),
              ...(d.hrPunches ?? []),
            ];
          });
        }}
      >
        {t("common.save")}
      </button>
    </div>
  );
}

function downloadAttendanceCsv(
  month: string,
  staff: StaffPerson[],
  db: ReturnType<typeof loadDb> | null,
  t: ReturnType<typeof useTranslations>
) {
  const rows: (string | number)[][] = [
    [
      t("admin.hrStaff"),
      t("admin.hrPresent"),
      t("admin.hrHalf"),
      t("admin.hrHours"),
      t("admin.hrLate"),
      t("admin.hrMissingOut"),
      t("admin.hrOutsideFence"),
      t("admin.hrWeakGps"),
      t("admin.hrAbsent"),
      t("admin.hrPaidLeave"),
    ],
  ];
  for (const u of staff) {
    const s = summarizeMonthAttendance(month, u.id, db);
    rows.push([
      u.name,
      s.present,
      s.half,
      (s.minutes / 60).toFixed(1),
      s.late,
      s.missing,
      s.outside,
      s.weak,
      s.absent,
      s.paidLeave,
    ]);
  }
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `attendance-${month}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
