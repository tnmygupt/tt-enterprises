export type PdfColumn = { header: string; dataKey?: string };
export type PdfCell = string | number;

/** Letterhead details — comes from admin settings, not hardcoded. */
export type PdfCompany = {
  name?: string;
  address?: string;
  address2?: string;
  gstin?: string;
  phone?: string;
  phone2?: string;
};

/** Adapt admin settings to the letterhead shape used by every PDF. */
export function companyFromSettings(
  settings:
    | {
        companyName?: string;
        address?: string;
        address2?: string;
        gstin?: string;
        phone?: string;
        phone2?: string;
      }
    | null
    | undefined
): PdfCompany {
  return {
    name: settings?.companyName,
    address: settings?.address,
    address2: settings?.address2,
    gstin: settings?.gstin,
    phone: settings?.phone,
    phone2: settings?.phone2,
  };
}

const BRAND: [number, number, number] = [15, 76, 74];
const RULE: [number, number, number] = [205, 213, 212];
const MUTED = 110;

/**
 * jsPDF ships Helvetica, which is WinAnsi — it has no rupee sign and no
 * Devanagari. Anything outside that set silently drops out of the page, so
 * fold the common offenders down to ASCII before they reach the document.
 */
export function sanitizePdfText(value: unknown): string {
  const raw = value == null ? "" : String(value);
  return raw
    .replace(/[\u20B9₹]/g, "Rs. ")
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[\u00A0\u202F\u2009]/g, " ")
    .replace(/\u00B7/g, "-")
    .replace(/Rs\.\s+/g, "Rs. ")
    .trim();
}

/** Amount-ish cells get right-aligned so decimal points line up. */
function looksNumeric(cell: PdfCell | undefined): boolean {
  if (typeof cell === "number") return Number.isFinite(cell);
  const text = sanitizePdfText(cell);
  if (!text) return false;
  return /^[-+(]?\s*(Rs\.\s*)?[\d,]+(\.\d+)?\s*%?\)?$/.test(text);
}

function numericColumns(columns: string[], rows: PdfCell[][]): Set<number> {
  const right = new Set<number>();
  for (let col = 0; col < columns.length; col++) {
    let numeric = 0;
    let filled = 0;
    for (const row of rows) {
      const cell = row[col];
      if (cell == null || sanitizePdfText(cell) === "") continue;
      filled++;
      if (looksNumeric(cell)) numeric++;
    }
    if (filled > 0 && numeric / filled >= 0.6) right.add(col);
  }
  return right;
}

export type ExportPdfOptions = {
  title: string;
  subtitle?: string;
  filename: string;
  columns: string[];
  rows: PdfCell[][];
  foot?: PdfCell[];
  companyName?: string;
  company?: PdfCompany;
  /** Landscape is worth it past ~8 columns */
  orientation?: "portrait" | "landscape";
};

/**
 * Builds the document without saving it — lets tests render a report and
 * inspect the output instead of only exercising it through a browser click.
 */
export async function renderTablePdf(options: ExportPdfOptions) {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  const orientation =
    options.orientation ?? (options.columns.length > 8 ? "landscape" : "portrait");
  const doc = new jsPDF({ orientation, unit: "mm", format: "a4" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 14;

  const company = options.company ?? {};
  const name = sanitizePdfText(
    company.name || options.companyName || "T T Enterprises"
  );
  const addressLines = [company.address, company.address2]
    .map((line) => sanitizePdfText(line))
    .filter(Boolean);
  const contact = [
    company.gstin ? `GSTIN ${sanitizePdfText(company.gstin)}` : "",
    [company.phone, company.phone2]
      .map((p) => sanitizePdfText(p))
      .filter(Boolean)
      .join(", "),
  ].filter(Boolean);

  let y = 16;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(BRAND[0], BRAND[1], BRAND[2]);
  doc.text(name, margin, y);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(MUTED);
  let infoY = y - 3;
  for (const line of addressLines) {
    doc.text(line, pageW - margin, infoY, { align: "right" });
    infoY += 4;
  }
  for (const line of contact) {
    doc.text(line, pageW - margin, infoY, { align: "right" });
    infoY += 4;
  }

  y = Math.max(y + 5, infoY);
  doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageW - margin, y);
  y += 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text(sanitizePdfText(options.title), margin, y);
  y += 5;

  if (options.subtitle) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(MUTED);
    // Long ranges/filters would run off the page as a single line
    const wrapped = doc.splitTextToSize(
      sanitizePdfText(options.subtitle),
      pageW - margin * 2
    ) as string[];
    doc.text(wrapped, margin, y);
    y += wrapped.length * 4;
  }
  doc.setTextColor(0);
  y += 2;

  const rightAligned = numericColumns(options.columns, options.rows);
  const columnStyles: Record<number, { halign: "right" }> = {};
  for (const col of rightAligned) columnStyles[col] = { halign: "right" };

  autoTable(doc, {
    startY: y,
    head: [options.columns.map((c) => sanitizePdfText(c))],
    body: options.rows.map((r) => r.map((c) => sanitizePdfText(c))),
    foot: options.foot
      ? [options.foot.map((c) => sanitizePdfText(c))]
      : undefined,
    theme: "grid",
    styles: {
      fontSize: 8,
      cellPadding: 2,
      lineColor: RULE,
      lineWidth: 0.1,
      textColor: 30,
      overflow: "linebreak",
    },
    headStyles: {
      fillColor: BRAND,
      textColor: 255,
      fontStyle: "bold",
      lineColor: BRAND,
    },
    alternateRowStyles: { fillColor: [247, 250, 249] },
    footStyles: {
      fillColor: [233, 239, 238],
      textColor: 20,
      fontStyle: "bold",
      lineColor: RULE,
    },
    columnStyles,
    margin: { left: margin, right: margin, bottom: 16 },
    showHead: "everyPage",
  });

  // Total page count is only known once the table has been laid out.
  const generated = new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(RULE[0], RULE[1], RULE[2]);
    doc.setLineWidth(0.2);
    doc.line(margin, pageH - 12, pageW - margin, pageH - 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(MUTED);
    doc.text(`${name} · ${sanitizePdfText(generated)}`, margin, pageH - 8);
    doc.text(`Page ${page} of ${pages}`, pageW - margin, pageH - 8, {
      align: "right",
    });
  }

  return doc;
}

/** jsPDF + autotable are ~400 kB — load them only when an export is clicked. */
export async function exportTablePdf(options: ExportPdfOptions): Promise<void> {
  const doc = await renderTablePdf(options);
  const safeName = options.filename.replace(/[^\w.-]+/g, "_");
  doc.save(safeName.endsWith(".pdf") ? safeName : `${safeName}.pdf`);
}
