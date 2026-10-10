import { roundMoney } from "@/lib/pricing";
import type {
  HrAdvance,
  HrLeave,
  HrPayslip,
  HrPunch,
  HrShift,
  HrSite,
  HrTerms,
  UserProfile,
  UserRole,
} from "@/lib/types";
import { userHasCapability, type CapabilityContext } from "@/lib/capabilities";

export const WEAK_GPS_M = 100;

export type HrAuditCollections = {
  hrTerms?: HrTerms[];
  hrShifts?: HrShift[];
  hrSites?: HrSite[];
  hrPunches?: HrPunch[];
  hrLeaves?: HrLeave[];
  hrAdvances?: HrAdvance[];
  hrPayslips?: HrPayslip[];
};

export function ensureHrAuditCollections<T extends HrAuditCollections>(db: T): T {
  if (!Array.isArray(db.hrTerms)) db.hrTerms = [];
  if (!Array.isArray(db.hrShifts)) db.hrShifts = [];
  if (!Array.isArray(db.hrSites)) db.hrSites = [];
  if (!Array.isArray(db.hrPunches)) db.hrPunches = [];
  if (!Array.isArray(db.hrLeaves)) db.hrLeaves = [];
  if (!Array.isArray(db.hrAdvances)) db.hrAdvances = [];
  if (!Array.isArray(db.hrPayslips)) db.hrPayslips = [];
  return db;
}

export function canManageHr(
  actor: Pick<
    UserProfile,
    "role" | "extraCapabilities" | "deniedCapabilities" | "jobId"
  > | null
  | undefined,
  ctx?: CapabilityContext | null
): boolean {
  return userHasCapability(actor, "manage_hr", ctx);
}

/** Civil weekday of YYYY-MM-DD (0 Sunday … 6 Saturday). */
export function weekdayIst(ymd: string): number {
  const [y, m, d] = ymd.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y || 1970, (m || 1) - 1, d || 1)).getUTCDay();
}

export function defaultHrTerms(userId: string, at = new Date().toISOString()): HrTerms {
  return {
    id: `ht_${crypto.randomUUID()}`,
    userId,
    payBasis: "monthly",
    monthlySalary: 0,
    joinDate: dateInIst(at),
    weekOff: 0,
    otRatePerHour: 0,
    casualDaysPerYear: 6,
    sickDaysPerYear: 6,
    updatedAt: at,
  };
}

/** Create empty terms for staff who have none so they appear on Pay. */
export function ensureStaffHrTerms<T extends { hrTerms?: HrTerms[] }>(
  db: T,
  users: { id: string; role?: string; active?: boolean }[]
): T {
  const list = db.hrTerms ?? [];
  const have = new Set(list.map((t) => t.userId));
  const now = new Date().toISOString();
  let added = false;
  for (const u of users) {
    if (!u.active || u.role === "customer") continue;
    if (have.has(u.id)) continue;
    list.push(defaultHrTerms(u.id, now));
    have.add(u.id);
    added = true;
  }
  if (added) db.hrTerms = list;
  return db;
}

export type PunchGuardReason =
  | "duplicate_in"
  | "duplicate_out"
  | "out_without_in"
  | "month_locked";

export function punchKindGuard(
  punches: HrPunch[],
  userId: string,
  kind: HrPunch["kind"],
  at: string
): PunchGuardReason | null {
  const day = dateInIst(at);
  const existing = punchesForDay(punches, userId, day);
  if (kind === "in" && existing.some((p) => p.kind === "in")) return "duplicate_in";
  if (kind === "out" && existing.some((p) => p.kind === "out")) return "duplicate_out";
  if (kind === "out" && !existing.some((p) => p.kind === "in")) return "out_without_in";
  return null;
}

export function isActivePayslip(p: HrPayslip): boolean {
  return !p.voided;
}

export function isHrMonthLocked(input: {
  month: string;
  userId?: string;
  audits?: { month: string }[];
  payslips?: HrPayslip[];
}): boolean {
  if ((input.audits ?? []).some((a) => a.month === input.month)) return true;
  if (
    input.userId &&
    (input.payslips ?? []).some(
      (p) => p.userId === input.userId && p.month === input.month && isActivePayslip(p)
    )
  ) {
    return true;
  }
  return false;
}

export function leaveIsOpen(leave: Pick<HrLeave, "status">): boolean {
  return leave.status === "pending" || leave.status === "approved";
}

export function leaveRangesOverlap(
  a: Pick<HrLeave, "from" | "to">,
  b: Pick<HrLeave, "from" | "to">
): boolean {
  return a.from <= b.to && a.to >= b.from;
}

export function leaveHasOverlap(
  leaves: HrLeave[],
  row: Pick<HrLeave, "id" | "userId" | "from" | "to" | "status">
): boolean {
  if (!leaveIsOpen(row)) return false;
  return leaves.some(
    (l) =>
      l.id !== row.id &&
      l.userId === row.userId &&
      leaveIsOpen(l) &&
      leaveRangesOverlap(l, row)
  );
}

export function advanceExceedsNet(amount: number, net: number): boolean {
  return amount > Math.max(0, net) + 0.001;
}

/** Staff GET: keep shift / OT rate, hide salary figures. */
export function staffSafeHrTerms(terms: HrTerms[] | undefined): HrTerms[] {
  return (terms ?? []).map((t) => ({
    ...t,
    monthlySalary: 0,
    dailyWage: 0,
    hourlyRate: 0,
  }));
}

/** Staff GET: keep OT hours / advances, hide salary gross and net. */
export function staffSafeHrPayslips(
  slips: HrPayslip[] | undefined
): HrPayslip[] {
  return (slips ?? []).map((s) => ({
    ...s,
    gross: 0,
    net: 0,
    formula: undefined,
  }));
}

export function canGpsPunch(role: UserRole | undefined): boolean {
  return Boolean(role && role !== "customer");
}

/** Haversine distance in metres. */
export function distanceMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const r = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function matchGeofence(
  lat: number | undefined,
  lng: number | undefined,
  sites: HrSite[],
  allowedIds?: string[]
): { insideFence: boolean; siteId?: string; meters?: number } {
  if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { insideFence: false };
  }
  const pool = allowedIds?.length
    ? sites.filter((s) => allowedIds.includes(s.id))
    : sites;
  let best: { siteId: string; meters: number; inside: boolean } | null = null;
  for (const site of pool) {
    const meters = distanceMeters(lat, lng, site.lat, site.lng);
    const inside = meters <= Math.max(10, Number(site.radiusM) || 150);
    if (!best || meters < best.meters) {
      best = { siteId: site.id, meters, inside };
    }
  }
  if (!best) return { insideFence: false };
  return {
    insideFence: best.inside,
    siteId: best.siteId,
    meters: best.meters,
  };
}

export function isWeakGps(accuracyM: number | undefined): boolean {
  return accuracyM != null && Number.isFinite(accuracyM) && accuracyM > WEAK_GPS_M;
}

/** Calendar date in IST (YYYY-MM-DD). */
export function dateInIst(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

export function monthDateList(month: string): string[] {
  const n = daysInMonth(month);
  const out: string[] = [];
  for (let d = 1; d <= n; d++) {
    out.push(`${month}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

function minutesOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function punchMinutesIst(iso: string): number {
  const d = new Date(iso);
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export function shiftLengthMinutes(shift?: HrShift | null): number {
  const start = shift ? minutesOfDay(shift.start) : 9 * 60;
  const end = shift ? minutesOfDay(shift.end) : 18 * 60;
  const len = end >= start ? end - start : end + 24 * 60 - start;
  return Math.max(60, len);
}

export function halfDayThresholdMinutes(
  shift?: HrShift | null,
  halfDayHours?: number
): number {
  if (halfDayHours != null && Number(halfDayHours) > 0) {
    return Math.round(Number(halfDayHours) * 60);
  }
  return Math.round(shiftLengthMinutes(shift) / 2);
}

export type DayAttendance = {
  date: string;
  userId: string;
  inAt?: string;
  outAt?: string;
  present: boolean;
  half: boolean;
  late: boolean;
  otMinutes: number;
  workedMinutes: number;
  missingOut: boolean;
  outsideFence: boolean;
  weakGps: boolean;
};

export function punchesForDay(
  punches: HrPunch[],
  userId: string,
  date: string
): HrPunch[] {
  return punches
    .filter((p) => p.userId === userId && dateInIst(p.at) === date)
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function deriveDayAttendance(
  punches: HrPunch[],
  userId: string,
  date: string,
  shift?: HrShift | null,
  halfDayHours?: number
): DayAttendance {
  const day = punchesForDay(punches, userId, date);
  const ins = day.filter((p) => p.kind === "in");
  const outs = day.filter((p) => p.kind === "out");
  const inAt = ins[0]?.at;
  const outAt = outs.length ? outs[outs.length - 1]!.at : undefined;
  const grace = shift?.graceMinutes ?? 15;
  const start = shift ? minutesOfDay(shift.start) : 9 * 60;
  const end = shift ? minutesOfDay(shift.end) : 18 * 60;
  const halfCut = halfDayThresholdMinutes(shift, halfDayHours);
  const late = Boolean(inAt && punchMinutesIst(inAt) > start + grace);
  let workedMinutes = 0;
  if (inAt && outAt) {
    workedMinutes = Math.max(0, punchMinutesIst(outAt) - punchMinutesIst(inAt));
  }
  const missingOut = Boolean(inAt && !outAt);
  const shortHours = Boolean(inAt && outAt && workedMinutes < halfCut);
  const half = missingOut || shortHours;
  const presentPaid = Boolean(inAt && outAt && !shortHours);
  let otMinutes = 0;
  if (outAt && punchMinutesIst(outAt) > end) {
    otMinutes = Math.max(0, punchMinutesIst(outAt) - end);
  }
  return {
    date,
    userId,
    inAt,
    outAt,
    present: presentPaid,
    half,
    late,
    otMinutes,
    workedMinutes,
    missingOut,
    outsideFence: day.some((p) => p.insideFence === false),
    weakGps: day.some((p) => p.weakGps || isWeakGps(p.accuracyM)),
  };
}

export function dayAttendanceStatusKey(
  att: DayAttendance
):
  | "presentLate"
  | "present"
  | "halfMissing"
  | "half"
  | "absentOutside"
  | "none" {
  if (att.present) return att.late ? "presentLate" : "present";
  if (att.half) return att.missingOut ? "halfMissing" : "half";
  if (att.outsideFence) return "absentOutside";
  return "none";
}

export function isIssuedAdvance(a: HrAdvance): boolean {
  return a.status !== "pending" && a.status !== "rejected";
}

export function leaveOverlapsMonth(leave: HrLeave, month: string): boolean {
  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
  return leave.from <= end && leave.to >= start;
}

export function leaveDaysAgainstQuota(
  leaves: HrLeave[],
  userId: string,
  kind: "casual" | "sick",
  year: string,
  exceptId?: string
): number {
  return (leaves ?? [])
    .filter(
      (l) =>
        l.userId === userId &&
        l.kind === kind &&
        (l.status === "approved" || l.status === "pending") &&
        l.id !== exceptId &&
        (l.from || "").slice(0, 4) === year
    )
    .reduce((s, l) => s + (Number(l.days) || 0), 0);
}

export function leaveQuotaRemaining(
  leaves: HrLeave[],
  terms: HrTerms | undefined,
  userId: string,
  kind: "casual" | "sick",
  year: string,
  exceptId?: string
): number {
  const cap =
    kind === "casual"
      ? Number(terms?.casualDaysPerYear ?? 6)
      : Number(terms?.sickDaysPerYear ?? 6);
  return Math.max(0, cap - leaveDaysAgainstQuota(leaves, userId, kind, year, exceptId));
}

/** Returns an i18n key suffix when the request exceeds yearly casual/sick days. */
export function leaveQuotaBlocked(
  leaves: HrLeave[],
  terms: HrTerms | undefined,
  row: Pick<HrLeave, "id" | "userId" | "kind" | "from" | "days">
): boolean {
  if (row.kind !== "casual" && row.kind !== "sick") return false;
  const year = (row.from || "").slice(0, 4);
  const remaining = leaveQuotaRemaining(
    leaves,
    terms,
    row.userId,
    row.kind,
    year,
    row.id
  );
  return (Number(row.days) || 0) > remaining;
}

export function inclusiveLeaveDays(from: string, to: string): number {
  const a = from.slice(0, 10);
  const b = to.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b) || b < a) {
    return 0;
  }
  const aMs = Date.UTC(Number(a.slice(0, 4)), Number(a.slice(5, 7)) - 1, Number(a.slice(8, 10)));
  const bMs = Date.UTC(Number(b.slice(0, 4)), Number(b.slice(5, 7)) - 1, Number(b.slice(8, 10)));
  return Math.floor((bMs - aMs) / 86400000) + 1;
}

function leaveCovers(leave: HrLeave, date: string): boolean {
  return leave.status === "approved" && date >= leave.from && date <= leave.to;
}

export type PayrollInput = {
  month: string;
  terms: HrTerms;
  shift?: HrShift | null;
  punches: HrPunch[];
  leaves: HrLeave[];
  advances: HrAdvance[];
};

export type PayrollResult = {
  workingDays: number;
  paidDays: number;
  presentDays: number;
  halfDays: number;
  leavePaid: number;
  leaveUnpaid: number;
  absentDays: number;
  lateDays: number;
  otMinutes: number;
  workedMinutes: number;
  paidLeaveHours: number;
  payBasis: "monthly" | "daily" | "hourly";
  formula: string;
  gross: number;
  otPay: number;
  advances: number;
  net: number;
};

export function payBasisOf(terms: HrTerms): "monthly" | "daily" | "hourly" {
  return terms.payBasis === "daily" || terms.payBasis === "hourly"
    ? terms.payBasis
    : "monthly";
}

export function computePayroll(input: PayrollInput): PayrollResult {
  const dates = monthDateList(input.month);
  const weekOff = Number.isFinite(input.terms.weekOff) ? input.terms.weekOff : 0;
  const basis = payBasisOf(input.terms);
  const shiftLen = shiftLengthMinutes(input.shift);
  let workingDays = 0;
  let presentDays = 0;
  let halfDays = 0;
  let leavePaid = 0;
  let leaveUnpaid = 0;
  let absentDays = 0;
  let lateDays = 0;
  let otMinutes = 0;
  let workedMinutes = 0;

  for (const date of dates) {
    const dow = weekdayIst(date);
    if (dow === weekOff) continue;
    workingDays += 1;
    const paidLeave = input.leaves.some(
      (l) => leaveCovers(l, date) && (l.kind === "casual" || l.kind === "sick")
    );
    const unpaidLeave = input.leaves.some(
      (l) => leaveCovers(l, date) && l.kind === "unpaid"
    );
    const att = deriveDayAttendance(
      input.punches,
      input.terms.userId,
      date,
      input.shift,
      input.terms.halfDayHours
    );
    if (paidLeave) {
      leavePaid += 1;
      continue;
    }
    if (unpaidLeave) {
      leaveUnpaid += 1;
      continue;
    }
    otMinutes += att.otMinutes;
    if (att.present) {
      presentDays += 1;
      if (att.late) lateDays += 1;
      workedMinutes += Math.min(att.workedMinutes, shiftLen);
    } else if (att.half) {
      halfDays += 1;
      if (att.late) lateDays += 1;
      if (att.missingOut) workedMinutes += Math.round(shiftLen / 2);
      else workedMinutes += Math.min(att.workedMinutes, shiftLen);
    } else {
      absentDays += 1;
    }
  }

  const paidDays = presentDays + halfDays * 0.5 + leavePaid;
  const paidLeaveHours = roundMoney((leavePaid * shiftLen) / 60);
  const workedHours = roundMoney(workedMinutes / 60);
  let gross = 0;
  let formula = "";
  if (basis === "daily") {
    const wage = Math.max(0, Number(input.terms.dailyWage) || 0);
    gross = roundMoney(wage * paidDays);
    formula = `₹${wage}/day × ${paidDays} paid days`;
  } else if (basis === "hourly") {
    const rate = Math.max(0, Number(input.terms.hourlyRate) || 0);
    const hours = roundMoney(workedHours + paidLeaveHours);
    gross = roundMoney(rate * hours);
    formula = `₹${rate}/hr × ${hours} h (worked ${workedHours} + leave ${paidLeaveHours})`;
  } else {
    const salary = Math.max(0, Number(input.terms.monthlySalary) || 0);
    gross =
      workingDays > 0 ? roundMoney((salary * paidDays) / workingDays) : 0;
    formula = `₹${salary}/month × ${paidDays}/${workingDays} days`;
  }
  const mult = Number(input.terms.otMultiplier);
  const otFactor = Number.isFinite(mult) && mult > 0 ? mult : 1;
  const otPay = roundMoney(
    (otMinutes / 60) *
      Math.max(0, Number(input.terms.otRatePerHour) || 0) *
      otFactor
  );
  const advances = roundMoney(
    input.advances
      .filter((a) => a.userId === input.terms.userId && !a.payslipId)
      .filter((a) => isIssuedAdvance(a))
      .filter((a) => (a.date || "").slice(0, 7) <= input.month)
      .reduce((s, a) => s + (Number(a.amount) || 0), 0)
  );
  const net = roundMoney(gross + otPay - advances);
  return {
    workingDays,
    paidDays,
    presentDays,
    halfDays,
    leavePaid,
    leaveUnpaid,
    absentDays,
    lateDays,
    otMinutes,
    workedMinutes,
    paidLeaveHours,
    payBasis: basis,
    formula,
    gross,
    otPay,
    advances,
    net,
  };
}

export function suspiciousPunches(
  punches: HrPunch[],
  month: string
): HrPunch[] {
  return punches
    .filter((p) => dateInIst(p.at).startsWith(month))
    .filter((p) => !p.insideFence || p.weakGps || isWeakGps(p.accuracyM))
    .sort((a, b) => a.at.localeCompare(b.at));
}

export function staffMissingInPunch(
  users: UserProfile[],
  punches: HrPunch[],
  date: string
): UserProfile[] {
  return users.filter((u) => {
    if (!u.active || u.role === "customer") return false;
    const day = punchesForDay(punches, u.id, date);
    return !day.some((p) => p.kind === "in");
  });
}

export function mergeHrPunchesForStaff(
  incoming: HrPunch[] | undefined,
  cloud: HrPunch[] | undefined,
  actorId: string,
  manageAll: boolean
): HrPunch[] {
  if (manageAll) {
    const byId = new Map<string, HrPunch>();
    for (const p of cloud ?? []) if (p?.id) byId.set(p.id, p);
    for (const p of incoming ?? []) if (p?.id) byId.set(p.id, p);
    return [...byId.values()];
  }
  const byId = new Map<string, HrPunch>();
  for (const p of cloud ?? []) if (p?.id) byId.set(p.id, p);
  for (const p of incoming ?? []) {
    if (!p?.id || p.userId !== actorId) continue;
    const prev = byId.get(p.id);
    if (prev && prev.userId !== actorId) continue;
    byId.set(p.id, p);
  }
  return [...byId.values()];
}

export function mergeHrLeavesForStaff(
  incoming: HrLeave[] | undefined,
  cloud: HrLeave[] | undefined,
  actorId: string,
  manageAll: boolean
): HrLeave[] {
  if (manageAll) {
    const byId = new Map<string, HrLeave>();
    for (const p of cloud ?? []) if (p?.id) byId.set(p.id, p);
    for (const p of incoming ?? []) if (p?.id) byId.set(p.id, p);
    return [...byId.values()];
  }
  const byId = new Map<string, HrLeave>();
  for (const p of cloud ?? []) if (p?.id) byId.set(p.id, p);
  for (const p of incoming ?? []) {
    if (!p?.id || p.userId !== actorId) continue;
    const prev = byId.get(p.id);
    if (prev) {
      byId.set(p.id, {
        ...p,
        status: prev.status,
        decidedBy: prev.decidedBy,
        decidedAt: prev.decidedAt,
        rejectReason: prev.rejectReason,
      });
    } else if (p.status === "pending") {
      byId.set(p.id, { ...p, status: "pending" });
    }
  }
  return [...byId.values()];
}

export function mergeHrAdvancesForStaff(
  incoming: HrAdvance[] | undefined,
  cloud: HrAdvance[] | undefined,
  actorId: string,
  manageAll: boolean
): HrAdvance[] {
  if (manageAll) {
    const byId = new Map<string, HrAdvance>();
    for (const p of cloud ?? []) if (p?.id) byId.set(p.id, p);
    for (const p of incoming ?? []) if (p?.id) byId.set(p.id, p);
    return [...byId.values()];
  }
  const byId = new Map<string, HrAdvance>();
  for (const p of cloud ?? []) if (p?.id) byId.set(p.id, p);
  for (const p of incoming ?? []) {
    if (!p?.id || p.userId !== actorId) continue;
    if (byId.has(p.id)) continue;
    if (p.status && p.status !== "pending") continue;
    if (p.payslipId) continue;
    byId.set(p.id, {
      ...p,
      userId: actorId,
      status: "pending",
      payslipId: undefined,
    });
  }
  return [...byId.values()];
}

export function buildHrPunch(input: {
  userId: string;
  kind: HrPunch["kind"];
  at?: string;
  lat?: number;
  lng?: number;
  accuracyM?: number;
  photoUrl?: string;
  userAgent?: string;
  sites: HrSite[];
  siteIds?: string[];
  gpsFallback?: boolean;
  note?: string;
  correctedBy?: string;
}): HrPunch {
  const at = input.at || new Date().toISOString();
  const hasGps =
    input.lat != null &&
    input.lng != null &&
    Number.isFinite(input.lat) &&
    Number.isFinite(input.lng);
  const fence = hasGps
    ? matchGeofence(input.lat, input.lng, input.sites, input.siteIds)
    : { insideFence: false, siteId: undefined, meters: undefined };
  const weakGps = !hasGps || isWeakGps(input.accuracyM);
  return {
    id: `hrp_${crypto.randomUUID()}`,
    userId: input.userId,
    kind: input.kind,
    at,
    lat: hasGps ? input.lat : undefined,
    lng: hasGps ? input.lng : undefined,
    accuracyM: hasGps ? input.accuracyM : undefined,
    insideFence: fence.insideFence,
    siteId: fence.siteId,
    photoUrl: input.photoUrl,
    userAgent: input.userAgent,
    weakGps,
    gpsFallback: input.gpsFallback || !hasGps || undefined,
    note: input.note,
    correctedBy: input.correctedBy,
    createdAt: at,
  };
}
