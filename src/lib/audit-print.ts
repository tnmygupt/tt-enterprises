import {
  companyFromSettings,
  exportTablePdf,
} from "@/lib/export-pdf";
import type { MonthlyAuditReport } from "@/lib/owner-monthly-audit";
import type { AppSettings } from "@/lib/types";

export function printAuditPage(): void {
  window.print();
}

export async function exportMonthlyAuditPdf(input: {
  settings?: AppSettings | null;
  month: string;
  report: MonthlyAuditReport;
}): Promise<void> {
  const { settings, month, report } = input;
  const rows: (string | number)[][] = [];
  for (const s of report.stockShortages) {
    rows.push([
      `Shortage ${s.label}`,
      `book ${s.bookQty} counted ${s.countedQty ?? "-"} var ${s.variance} Rs. ${s.shortageValue}`,
    ]);
  }
  for (const u of report.uncountedLines) {
    rows.push([`Uncounted ${u.label}`, `book ${u.bookQty}`]);
  }
  for (const s of report.surplusLines) {
    rows.push([
      `Surplus ${s.label}`,
      `book ${s.bookQty} counted ${s.countedQty ?? "-"} var ${s.variance}`,
    ]);
  }
  if (report.cash) {
    rows.push([
      "Cash mismatch",
      `cash ${report.cash.cashDiff} bank ${report.cash.bankDiff}`,
    ]);
  }
  for (const g of report.gpsFlags) {
    rows.push([
      `GPS ${g.userName}`,
      `${g.at} ${g.kind} fence=${g.insideFence} weak=${g.weakGps}`,
    ]);
  }
  for (const m of report.missingClockOut) {
    rows.push(["Missing out", `${m.userName} ${m.date}`]);
  }
  for (const a of report.absenteeism) {
    rows.push(["Absent", `${a.userName} ${a.absentDays} days`]);
  }
  rows.push(["P&L income", report.pl.income]);
  rows.push(["Expense", report.pl.expense]);
  rows.push(["Net", report.pl.net]);
  rows.push(["Cash close", report.cashClose]);
  rows.push(["Bank close", report.bankClose]);
  rows.push(["AR", report.ar]);
  rows.push(["AP", report.ap]);
  rows.push(["Overdue AR", report.overdueAr]);
  rows.push(["Stock book", report.stockBookValue]);
  rows.push(["Stock counted", report.stockCountedValue]);
  rows.push(["Payroll net", report.payrollNet]);
  if (report.stamp) {
    rows.push([
      "Closed",
      `${report.stamp.closedByName} ${report.stamp.closedAt.slice(0, 10)}`,
    ]);
  }
  await exportTablePdf({
    title: `Monthly audit ${month}`,
    filename: `monthly-audit-${month}.pdf`,
    company: companyFromSettings(settings),
    columns: ["Item", "Detail"],
    rows,
  });
}
