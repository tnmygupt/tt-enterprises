import {
  companyFromSettings,
  exportTablePdf,
} from "@/lib/export-pdf";
import {
  computePayroll,
  dayAttendanceStatusKey,
  deriveDayAttendance,
  isIssuedAdvance,
  monthDateList,
  type PayrollResult,
} from "@/lib/hr";
import { formatInr } from "@/lib/pricing";
import type {
  AppSettings,
  HrAdvance,
  HrLeave,
  HrPunch,
  HrShift,
  HrTerms,
  UserProfile,
} from "@/lib/types";

const STATUS_EN: Record<ReturnType<typeof dayAttendanceStatusKey>, string> = {
  presentLate: "present late",
  present: "present",
  halfMissing: "half missing out",
  half: "half",
  absentOutside: "outside fence",
  none: "-",
};

export function printHrPage(): void {
  window.print();
}

export async function exportPayslipPdf(input: {
  settings?: AppSettings | null;
  staffName: string;
  month: string;
  pay: PayrollResult;
}): Promise<void> {
  const { settings, staffName, month, pay } = input;
  await exportTablePdf({
    title: `Payslip ${month}`,
    subtitle: staffName,
    filename: `payslip-${month}-${staffName}.pdf`,
    company: companyFromSettings(settings),
    columns: ["Item", "Value"],
    rows: [
      ["Working days", pay.workingDays],
      ["Paid days", pay.paidDays],
      ["Present", pay.presentDays],
      ["Half days", pay.halfDays],
      ["Hours", (pay.workedMinutes / 60).toFixed(1)],
      ["OT hours", (pay.otMinutes / 60).toFixed(1)],
      ["OT pay", formatInr(pay.otPay)],
      ["Advances", formatInr(pay.advances)],
      ["Gross", formatInr(pay.gross)],
      ["Net", formatInr(pay.net)],
      ["Formula", pay.formula],
    ],
  });
}

export async function exportRegisterPdf(input: {
  settings?: AppSettings | null;
  month: string;
  staff: Pick<UserProfile, "id" | "name">[];
  terms: HrTerms[];
  shifts: HrShift[];
  punches: HrPunch[];
  leaves: HrLeave[];
  advances: HrAdvance[];
}): Promise<void> {
  const { settings, month, staff, terms, shifts, punches, leaves, advances } =
    input;
  const rows = staff.map((u) => {
    const t = terms.find((x) => x.userId === u.id);
    const shift = shifts.find((s) => s.id === t?.shiftId);
    let present = 0;
    let half = 0;
    let outside = 0;
    let otMin = 0;
    for (const date of monthDateList(month)) {
      const att = deriveDayAttendance(
        punches,
        u.id,
        date,
        shift,
        t?.halfDayHours
      );
      if (att.present) present += 1;
      if (att.half) half += 1;
      if (att.outsideFence) outside += 1;
      otMin += att.otMinutes;
    }
    const pay = t
      ? computePayroll({
          month,
          terms: t,
          shift,
          punches,
          leaves,
          advances: advances.filter((a) => a.userId === u.id),
        })
      : null;
    return [
      u.name,
      present,
      half,
      (otMin / 60).toFixed(1),
      outside,
      pay ? formatInr(pay.gross) : "-",
      pay ? formatInr(pay.net) : "-",
    ];
  });
  await exportTablePdf({
    title: `Attendance register ${month}`,
    filename: `hr-register-${month}.pdf`,
    company: companyFromSettings(settings),
    orientation: "landscape",
    columns: ["Staff", "Present", "Half", "OT h", "Outside", "Gross", "Net"],
    rows,
  });
}

export async function exportStaffAttendancePdf(input: {
  settings?: AppSettings | null;
  staffName: string;
  month: string;
  userId: string;
  punches: HrPunch[];
  shift?: HrShift | null;
  halfDayHours?: number;
  advances: HrAdvance[];
}): Promise<void> {
  const dates = monthDateList(input.month);
  const rows = dates.map((date) => {
    const att = deriveDayAttendance(
      input.punches,
      input.userId,
      date,
      input.shift,
      input.halfDayHours
    );
    return [
      date,
      att.inAt ? att.inAt.slice(11, 16) : "-",
      att.outAt ? att.outAt.slice(11, 16) : "-",
      (att.workedMinutes / 60).toFixed(1),
      (att.otMinutes / 60).toFixed(1),
      STATUS_EN[dayAttendanceStatusKey(att)],
    ];
  });
  const issued = input.advances.filter(
    (a) => isIssuedAdvance(a) && a.date.slice(0, 7) === input.month
  );
  if (issued.length) {
    rows.push(["", "", "", "", "", ""]);
    rows.push(["Advances", "", "", "", "", ""]);
    for (const a of issued) {
      rows.push([a.date, formatInr(a.amount), a.note || "", "", "", ""]);
    }
  }
  await exportTablePdf({
    title: `My attendance ${input.month}`,
    subtitle: input.staffName,
    filename: `my-attendance-${input.month}.pdf`,
    company: companyFromSettings(input.settings),
    columns: ["Date", "In", "Out", "Hours", "OT", "Status"],
    rows,
  });
}
