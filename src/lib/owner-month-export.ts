import {
  companyFromSettings,
  exportMultiTablePdf,
  type PdfCell,
  type PdfCompany,
  type PdfTableSection,
} from "@/lib/export-pdf";
import { exportWorkbookExcel, type ExcelSheet } from "@/lib/export-table";
import type { OwnerMonthReport } from "@/lib/owner-month-report";
import { formatInr } from "@/lib/pricing";
import type { AppSettings } from "@/lib/types";

function money(n: number): string {
  return formatInr(n, "en");
}

function pct(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

function agingRows(report: OwnerMonthReport["receivables"]): PdfCell[][] {
  return [
    ["Current", money(report.buckets.current)],
    ["1–30 days", money(report.buckets.d1_30)],
    ["31–60 days", money(report.buckets.d31_60)],
    ["61–90 days", money(report.buckets.d61_90)],
    ["90+ days", money(report.buckets.d90_plus)],
    ["Overdue total", money(report.overdueTotal)],
  ];
}

export function ownerMonthReportSections(report: OwnerMonthReport): PdfTableSection[] {
  return [
    {
      title: "Profit & Loss",
      subtitle: `${report.from} to ${report.to} vs ${report.priorMonth} and ${report.yearAgoMonth}`,
      columns: ["", report.month, report.priorMonth, "Var", "Year ago", "YoY"],
      rows: [
        [
          "Income",
          money(report.pl.income),
          money(report.plPrior.income),
          money(report.vsPrior.income),
          money(report.plYearAgo.income),
          pct(report.vsYearAgo.incomePct),
        ],
        [
          "Expense",
          money(report.pl.expense),
          money(report.plPrior.expense),
          money(report.vsPrior.expense),
          money(report.plYearAgo.expense),
          pct(report.vsYearAgo.expensePct),
        ],
        [
          "Net P/L",
          money(report.pl.net),
          money(report.plPrior.net),
          money(report.vsPrior.net),
          money(report.plYearAgo.net),
          pct(report.vsYearAgo.netPct),
        ],
      ],
    },
    {
      title: "Balance sheet at month end",
      subtitle: report.to,
      columns: ["Account", "Amount"],
      rows: [
        ...report.balanceSheet.assets.map((r) => [r.name, money(r.amount)] as PdfCell[]),
        ...report.balanceSheet.liabilities.map((r) => [r.name, money(r.amount)] as PdfCell[]),
        ...report.balanceSheet.equity.map((r) => [r.name, money(r.amount)] as PdfCell[]),
      ],
      foot: [
        "Cash / Bank close",
        `${money(report.cashClose)} / ${money(report.bankClose)}`,
      ],
    },
    {
      title: "Cash flow",
      columns: ["Section", "Line", "Amount"],
      rows: [
        ...report.cashFlow.operating.rows.map(
          (r) => ["Operating", r.label, money(r.amount)] as PdfCell[]
        ),
        ...report.cashFlow.investing.rows.map(
          (r) => ["Investing", r.label, money(r.amount)] as PdfCell[]
        ),
        ...report.cashFlow.financing.rows.map(
          (r) => ["Financing", r.label, money(r.amount)] as PdfCell[]
        ),
      ],
      foot: ["Net change", "", money(report.cashFlow.netChange)],
    },
    {
      title: "Item movement",
      columns: ["Item", "Open", "In", "Out", "Close", "Value"],
      rows: report.items.slice(0, 200).map((r) => [
        r.label,
        r.opening,
        r.inbound,
        r.outbound,
        r.closing,
        money(r.value),
      ]),
    },
    {
      title: "Gross profit by item",
      columns: ["Item", "Sales", "COGS", "Profit"],
      rows: report.grossProfit.byItem.map((r) => [
        r.label,
        money(r.amount),
        money(r.cogs || 0),
        money(r.profit || 0),
      ]),
      foot: [
        "Total",
        money(report.grossProfit.totals.sales),
        money(report.grossProfit.totals.cogs),
        money(report.grossProfit.totals.profit),
      ],
    },
    {
      title: "Gross profit by category",
      columns: ["Category", "Sales", "COGS", "Profit"],
      rows: report.grossProfit.byCategory.map((r) => [
        r.label,
        money(r.amount),
        money(r.cogs || 0),
        money(r.profit || 0),
      ]),
    },
    {
      title: "Dealers",
      columns: ["Dealer", "Sales", "Bills"],
      rows: report.dealers.top.map((r) => [r.label, money(r.amount), r.count ?? ""]),
    },
    {
      title: "Suppliers",
      columns: ["Supplier", "Purchases", "Bills"],
      rows: report.suppliers.bySupplier.map((r) => [
        r.label,
        money(r.amount),
        r.count ?? "",
      ]),
    },
    {
      title: "Receivables aging",
      columns: ["Bucket", "Amount"],
      rows: agingRows(report.receivables),
    },
    {
      title: "Payables aging",
      columns: ["Bucket", "Amount"],
      rows: agingRows(report.payables),
    },
    {
      title: "HR payroll",
      columns: ["Metric", "Value"],
      rows: [
        ["Payslips", report.hr.slipCount],
        ["Gross", money(report.hr.payrollGross)],
        ["Net", money(report.hr.payrollNet)],
        ["Advances outstanding", money(report.hr.advancesOutstanding)],
        ["Attendance exceptions", report.hr.attendanceExceptions],
        ["Missing clock-out", report.hr.missingClockOut],
        ["GPS flags", report.hr.gpsFlags],
      ],
    },
    {
      title: "Audit exceptions",
      columns: ["Item", "Detail"],
      rows: [
        ["Month close ready", report.audit.ready.ready ? "Yes" : "No"],
        ["Blockers", report.audit.ready.reasons.join(", ") || "—"],
        ["Stamp", report.audit.stamp?.closedAt || "Not stamped"],
        ["Stock shortages", report.audit.stockShortages.length],
        ["Uncounted SKUs", report.audit.uncountedSkus],
        ["Period lock", report.periodLockedThrough || "Open"],
      ],
    },
  ];
}

export function ownerMonthReportSheets(report: OwnerMonthReport): ExcelSheet[] {
  return ownerMonthReportSections(report).map((section) => ({
    name: section.title.slice(0, 31),
    title: section.title,
    subtitle: section.subtitle,
    columns: section.columns,
    rows: section.rows,
    foot: section.foot,
  }));
}

export async function exportOwnerMonthReportPdf(opts: {
  report: OwnerMonthReport;
  settings?: AppSettings | null;
  company?: PdfCompany;
}): Promise<void> {
  const { report } = opts;
  await exportMultiTablePdf({
    title: `Owner month pack ${report.month}`,
    subtitle: `${report.from} to ${report.to}`,
    filename: `owner-month-${report.month}.pdf`,
    company: opts.company ?? companyFromSettings(opts.settings),
    sections: ownerMonthReportSections(report),
  });
}

export async function exportOwnerMonthReportExcel(opts: {
  report: OwnerMonthReport;
  settings?: AppSettings | null;
}): Promise<void> {
  const { report } = opts;
  await exportWorkbookExcel({
    filename: `owner-month-${report.month}.xlsx`,
    companyName: opts.settings?.companyName,
    sheets: ownerMonthReportSheets(report),
  });
}
