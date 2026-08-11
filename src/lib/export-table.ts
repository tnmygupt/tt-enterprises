import {
  exportTablePdf,
  type PdfCell,
  type PdfCompany,
} from "@/lib/export-pdf";

export type { PdfCell, PdfCompany };
export { exportTablePdf };

export type ExportTableOptions = {
  title: string;
  subtitle?: string;
  filename: string;
  columns: string[];
  rows: PdfCell[][];
  foot?: PdfCell[];
  companyName?: string;
  company?: PdfCompany;
  orientation?: "portrait" | "landscape";
};

/** PDF export — same helper used across accounts reports. */
export function exportPdf(options: ExportTableOptions): Promise<void> {
  return exportTablePdf(options);
}

/**
 * Excel (.xlsx) via ExcelJS, loaded only when the user clicks Export.
 * Keeps the initial page weight small.
 */
export async function exportTableExcel(
  options: ExportTableOptions
): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Report");
  const sheetRows: PdfCell[][] = [
    [options.company?.name || options.companyName || "T T Enterprises"],
    [options.title],
  ];
  if (options.subtitle) sheetRows.push([options.subtitle]);
  sheetRows.push([]);
  sheetRows.push(options.columns);
  for (const row of options.rows) sheetRows.push(row);
  if (options.foot) sheetRows.push(options.foot);

  for (const row of sheetRows) {
    worksheet.addRow(row.map((c) => (c == null ? "" : c)));
  }

  const base = options.filename.replace(/[^\w.-]+/g, "_");
  const name = base.toLowerCase().endsWith(".xlsx")
    ? base
    : `${base.replace(/\.pdf$/i, "")}.xlsx`;

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
