import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { Order, PackingSlipColumn } from "./types";
import {
  columnBundles,
  columnKgTotals,
  columnRateLabel,
  computeBillFromSlip,
} from "./packing-slip";
import { formatInr, roundMoney } from "./pricing";
import type { PdfCompany } from "./export-pdf";

/** Letterhead used when a caller has no settings to hand. */
const FALLBACK_COMPANY: PdfCompany = { name: "T T Enterprises" };

/** Helvetica has no ₹ — use ASCII so amounts never look like "¹". */
function pdfMoney(n: number, locale: "en" | "hi"): string {
  return formatInr(n, locale)
    .replace(/\u20B9/g, "Rs.")
    .replace(/₹/g, "Rs.");
}

function pdfRate(
  col: Parameters<typeof columnRateLabel>[0],
  locale: "en" | "hi"
): string {
  return columnRateLabel(col, locale)
    .replace(/\u20B9/g, "Rs.")
    .replace(/₹/g, "Rs.");
}

function locStr(
  v: { en?: string; hi?: string } | undefined,
  locale: "en" | "hi"
): string {
  return (v?.[locale] || v?.en || "").trim();
}

/** Product name + size + variation (+ color) for packing slip columns. */
function productParts(
  col: PackingSlipColumn,
  order: Order,
  locale: "en" | "hi"
): { name: string; size: string; variation: string; color: string } {
  const line = order.lines[col.lineIndex];
  const name = (
    locStr(line?.productName, locale) ||
    col.label.split(" · ")[0] ||
    col.label ||
    "-"
  ).trim();
  const size = locStr(line?.size, locale);
  const variation = locStr(line?.variationLabel, locale);
  const color = locStr(line?.colorName, locale);
  return { name, size, variation, color };
}

/** Single multi-line header cell: name, then Size / Variation lines. */
function productHeaderLabel(
  col: PackingSlipColumn,
  order: Order,
  locale: "en" | "hi"
): string {
  const { name, size, variation, color } = productParts(col, order, locale);
  const lines = [name];
  if (size) lines.push(`Size: ${size}`);
  // Avoid duplicating when size and variation are the same text
  if (variation && variation !== size) lines.push(`Var: ${variation}`);
  if (color) lines.push(`Color: ${color}`);
  const ordered = col.orderedBundles;
  if (ordered != null && ordered > 0) lines.push(`Ord: ${ordered} bdl`);
  return lines.join("\n");
}

/** One-line product for summary tables. */
function productSummaryLabel(
  col: PackingSlipColumn,
  order: Order,
  locale: "en" | "hi"
): string {
  const { name, size, variation, color } = productParts(col, order, locale);
  const bits = [name];
  if (size) bits.push(size);
  if (variation && variation !== size) bits.push(variation);
  if (color) bits.push(color);
  return bits.join(" · ") || "-";
}

type JsPdfWithTable = jsPDF & {
  lastAutoTable?: { finalY: number };
};

function tableEndY(doc: jsPDF, fallback: number): number {
  return (doc as JsPdfWithTable).lastAutoTable?.finalY ?? fallback;
}

/**
 * Download packing slip PDF — clean A5 structured form (no DOM capture mess).
 * iOS Safari: open PDF in a new tab (Share from Safari), or use the share sheet.
 * Call this directly from a click handler — do not await React setState first.
 */
export async function downloadPackingSlipPdf(
  order: Order,
  locale: "en" | "hi" = "en",
  company?: PdfCompany
): Promise<void> {
  if (!order.packingSlip) throw new Error("No packing slip");
  const filename = `${order.packingSlip.slipNo || order.orderNumber}-packing-slip.pdf`;
  // Sync generate so the open/share still counts as a user gesture on iOS.
  const blob = renderSlipPdf(order, locale, company).output("blob");
  await saveOrOpenPdfBlob(blob, filename);
}

export function buildPackingSlipPdfDataUrl(
  order: Order,
  locale: "en" | "hi" = "en",
  company?: PdfCompany
): string {
  if (!order.packingSlip) throw new Error("No packing slip");
  return renderSlipPdf(order, locale, company).output("datauristring");
}

export function buildPackingSlipPdfBlob(
  order: Order,
  locale: "en" | "hi" = "en",
  company?: PdfCompany
): Blob {
  if (!order.packingSlip) throw new Error("No packing slip");
  return renderSlipPdf(order, locale, company).output("blob");
}

function isAppleTouchDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iP(ad|hone|od)/i.test(ua)) return true;
  // iPadOS desktop UA
  return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
}

/** Share / open / download a PDF in a way that works on Safari iOS. */
export async function saveOrOpenPdfBlob(
  blob: Blob,
  filename: string
): Promise<void> {
  const url = URL.createObjectURL(blob);
  const revokeLater = () => {
    window.setTimeout(() => URL.revokeObjectURL(url), 180_000);
  };

  // Desktop / Android Chrome: real file download
  if (!isAppleTouchDevice()) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    revokeLater();
    return;
  }

  // iOS Safari: <a download> is ignored. Open the PDF in a tab first (sync),
  // then optionally present the share sheet so they can Save to Files.
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();

  const file = new File([blob], filename, { type: "application/pdf" });
  const nav = navigator as Navigator & {
    canShare?: (data?: ShareData) => boolean;
  };
  if (
    typeof navigator.share === "function" &&
    typeof nav.canShare === "function" &&
    nav.canShare({ files: [file] })
  ) {
    try {
      await navigator.share({
        files: [file],
        title: filename,
      });
    } catch (err) {
      // AbortError = user closed sheet; other errors — PDF tab already opened.
      if (!(err instanceof Error && err.name === "AbortError")) {
        /* ignore */
      }
    }
  }

  revokeLater();
}

/**
 * Clean packing-slip PDF.
 * Headers: Sr + full product name only (no Ord / Bundle / Rate).
 * No SHIP auto box, no NOTE box. Multi-page stays readable.
 */
function renderSlipPdf(
  order: Order,
  locale: "en" | "hi",
  companyIn?: PdfCompany
): jsPDF {
  const company = companyIn?.name ? companyIn : FALLBACK_COMPANY;
  const companyName = (company.name || "T T Enterprises").toUpperCase();
  const slip = order.packingSlip!;
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a5" });
  const M = 7;
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const W = pageW - M * 2;
  const hi = locale === "hi";
  const blue: [number, number, number] = [20, 80, 150];

  const kg = columnKgTotals(slip);
  const bundles = columnBundles(slip);
  const slipKg = kg.reduce((s, n) => s + (Number(n) || 0), 0);
  const schemeOff = slipKg > 0 ? order.schemeDiscount || 0 : 0;
  const bill = computeBillFromSlip(order, slip, {
    schemeDiscount: schemeOff,
  });
  const cols = slip.columns;
  const rowCount = slip.rows.length;
  const headers = cols.map((c) => productHeaderLabel(c, order, locale));
  const names = cols.map((c) => productSummaryLabel(c, order, locale));
  const finalBill =
    order.actualBillAmount ??
    roundMoney(
      Math.max(
        0,
        bill.subtotal + bill.shippingAmount - (bill.schemeDiscount || 0)
      )
    );

  let y = M;
  let pageNo = 1;

  const drawContinuedBanner = () => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text(`${companyName} - PACKING SLIP (continued)`, M, y + 3);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.text(
      `${order.orderNumber} · ${slip.slipNo || "-"} · p.${pageNo}`,
      pageW - M,
      y + 3,
      { align: "right" }
    );
    y += 5;
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.line(M, y, pageW - M, y);
    y += 4;
  };

  /**
   * Ensure space; returns current y (may have moved to a new page).
   * Helpers that track their own cursor across several tables must pass it in
   * as `fromY`, otherwise this keeps handing back the position they started at
   * and they draw on top of themselves.
   */
  const need = (mm: number, fromY?: number): number => {
    if (fromY != null) y = fromY;
    // Stay in sync if autoTable already advanced the page
    pageNo = Math.max(pageNo, doc.getNumberOfPages());
    if (y + mm > pageH - M) {
      doc.addPage();
      pageNo = doc.getNumberOfPages();
      y = M;
      drawContinuedBanner();
    }
    return y;
  };

  // ── Header ──
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(companyName, M, y + 4);
  doc.setFontSize(8);
  doc.text("Om Ganeshaya Namah", pageW - M, y + 4, { align: "right" });
  y += 8;

  // Address / phone come from admin settings so the slip stays current
  // when those details change. Company GSTIN is not printed on slips.
  const letterhead = [
    [company.address, company.address2].filter(Boolean).join(", "),
    [company.phone, company.phone2].filter(Boolean).join(", "),
  ].filter(Boolean);
  if (letterhead.length) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.setTextColor(90);
    for (const line of letterhead) {
      const wrapped = doc.splitTextToSize(line, W) as string[];
      doc.text(wrapped, M, y);
      y += wrapped.length * 2.8;
    }
    doc.setTextColor(0);
    y += 1.5;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("PACKING SLIP", M, y);
  y += 3;
  doc.setDrawColor(0);
  doc.setLineWidth(0.4);
  doc.line(M, y, pageW - M, y);
  y += 5;

  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("DATE", M, y);
  doc.setFont("helvetica", "normal");
  doc.text(String(slip.date || "-"), M + 12, y);
  doc.text(String(order.orderNumber), pageW / 2, y, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.text("SLIP NO.", pageW - M - 38, y);
  doc.setFont("helvetica", "normal");
  doc.text(String(slip.slipNo || "-"), pageW - M, y, { align: "right" });
  y += 4;

  // ── Party ──
  const partyLines = [
    `PARTY: ${slip.partyName || order.checkoutName || order.userName || "-"}`,
    `PHONE: ${slip.partyPhone || order.phone || "-"}`,
    `ADDRESS: ${slip.partyAddress || order.deliveryAddress || "-"}`,
    `GST/ID: ${slip.partyGstin || order.gstOrAadhar || "-"}`,
  ].flatMap((line) => doc.splitTextToSize(line, W - 4));
  const partyH = Math.max(14, partyLines.length * 3.2 + 3);
  y = need(partyH + 3);
  doc.setLineWidth(0.3);
  doc.rect(M, y, W, partyH);
  doc.setFontSize(7);
  let py = y + 3.5;
  for (const line of partyLines) {
    doc.text(line, M + 2, py);
    py += 3.2;
  }
  y += partyH + 3;

  // ── Weighment grid: # | product columns | TOTAL kg / TOTAL BDL / AMOUNT ──
  y = drawGridWeighments(doc, {
    M,
    W,
    y,
    need,
    names,
    headers,
    cols,
    slip,
    rowCount,
    kg,
    bundles,
    bill,
    locale,
  });

  // ── Totals strip: weight + bundles only ──
  const boxH = 9;
  y = need(boxH + 2);
  const half = W / 2;
  const boxes: { label: string; value: string }[] = [
    {
      label: "TOTAL WEIGHT",
      value: `${bill.totalKg.toFixed(2)} kg`,
    },
    {
      label: "TOTAL BUNDLES",
      value: `${bill.totalBundles} ${hi ? "bdl" : "bdl"}`,
    },
  ];
  boxes.forEach((b, i) => {
    const bx = M + i * half;
    doc.setLineWidth(0.35);
    doc.rect(bx, y, half, boxH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(0, 0, 0);
    doc.text(b.label, bx + 2, y + 3.2);
    doc.setFontSize(8);
    doc.text(b.value, bx + half - 2, y + 7, { align: "right" });
  });
  y += boxH + 3;

  // ── Amount calculation (Sr + full name + weight + amount) ──
  y = need(16);
  doc.setLineWidth(0.35);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text(
    hi ? "AMOUNT CALCULATION SUMMARY" : "AMOUNT CALCULATION SUMMARY",
    pageW / 2,
    y + 1,
    { align: "center" }
  );
  y += 3;
  doc.line(M, y, pageW - M, y);
  y += 2;

  const calcRows = cols.map((col, i) => {
    const k = kg[i] || 0;
    const b = bundles[i] || 0;
    const amt = bill.lineAmounts[i] || 0;
    return [
      String(i + 1),
      names[i],
      k > 0 ? `${k.toFixed(2)} kg` : "-",
      b > 0 ? String(b) : "-",
      pdfRate(col, locale),
      amt > 0 ? pdfMoney(amt, locale) : "-",
    ];
  });

  y = need(12);
  autoTable(doc, {
    startY: y,
    head: [["Sr", "Product", "Total kg", "Bdl", "Rate", "Amount"]],
    body: calcRows,
    theme: "grid",
    styles: {
      fontSize: 6.5,
      cellPadding: 1,
      lineColor: [0, 0, 0],
      lineWidth: 0.12,
      textColor: [0, 0, 0],
      overflow: "linebreak",
      valign: "middle",
    },
    headStyles: {
      fillColor: [240, 240, 240],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      fontSize: 6.5,
    },
    columnStyles: {
      0: { cellWidth: 8, halign: "center", fontStyle: "bold" },
      1: { cellWidth: "auto", halign: "left" },
      2: { cellWidth: 18, halign: "center" },
      3: { cellWidth: 12, halign: "center", fontStyle: "bold" },
      4: { cellWidth: 20, halign: "right" },
      5: { cellWidth: 22, halign: "right" },
    },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      if (data.column.index === 3) {
        data.cell.styles.fillColor = [232, 238, 248];
      }
    },
    margin: { left: M, right: M, bottom: M },
    tableWidth: W,
    pageBreak: "auto",
    rowPageBreak: "avoid",
    showHead: "everyPage",
  });
  y = tableEndY(doc, y) + 3;

  // Clear grand bill calculation
  const hasSchemeDisc = (bill.schemeDiscount || 0) > 0;
  const math = (order.schemeDiscountMath || "").trim();
  const calcBlockH = hasSchemeDisc || slipKg <= 0 ? (math ? 36 : 32) : 28;
  y = need(calcBlockH + 2);
  doc.setLineWidth(0.35);
  doc.rect(M, y, W, calcBlockH);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("GRAND BILL CALCULATION", M + 2, y + 4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  let cy = y + 8.5;
  doc.text("Items amount", M + 2, cy);
  doc.text(pdfMoney(bill.subtotal, locale), pageW - M - 2, cy, {
    align: "right",
  });
  cy += 4;
  const discTitle =
    slipKg > 0
      ? hi
        ? "- Discount"
        : "- Discount"
      : hi
        ? "- Discount after weighment"
        : "- Discount after weighment";
  doc.text(discTitle, M + 2, cy);
  doc.text(pdfMoney(bill.schemeDiscount, locale), pageW - M - 2, cy, {
    align: "right",
  });
  if (slipKg > 0 && math) {
    cy += 3.5;
    doc.setFontSize(6);
    doc.setTextColor(80, 80, 80);
    doc.text(math.replace(/₹/g, "Rs."), M + 2, cy);
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(7);
  }
  cy += 4;
  doc.text(
    `+ Shipping${slip.shippingManual ? " (manual)" : " (auto)"}`,
    M + 2,
    cy
  );
  doc.text(pdfMoney(bill.shippingAmount, locale), pageW - M - 2, cy, {
    align: "right",
  });
  cy += 3.5;
  doc.setDrawColor(0);
  doc.setLineWidth(0.25);
  doc.line(M + 2, cy, pageW - M - 2, cy);
  cy += 4.5;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...blue);
  doc.text(
    (bill.schemeDiscount || 0) > 0
      ? "GRAND BILL TOTAL  (Items − Discount + Shipping)"
      : "GRAND BILL TOTAL  (Items + Shipping)",
    M + 2,
    cy
  );
  doc.text(pdfMoney(finalBill, locale), pageW - M - 2, cy, {
    align: "right",
  });
  doc.setTextColor(0, 0, 0);
  y += calcBlockH + 3;

  // ── Transport ──
  y = need(8);
  doc.setLineWidth(0.3);
  doc.rect(M, y, W, 7);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.text("TRANSPORT/VEHICLE NO", M + 2, y + 4.5);
  doc.setFont("helvetica", "normal");
  doc.text(String(slip.transport || ""), M + 48, y + 4.5);
  y += 9;

  // ── Prepared / Checked ──
  y = need(8);
  const hw = W / 2;
  doc.rect(M, y, hw - 0.6, 7);
  doc.rect(M + hw + 0.6, y, hw - 0.6, 7);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.5);
  doc.text(`PREPARED BY  ${slip.preparedBy || ""}`, M + 2, y + 4.5);
  doc.text(`CHECKED BY  ${slip.checkedBy || ""}`, M + hw + 2.5, y + 4.5);

  // Page numbers on every page
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6);
    doc.setTextColor(80, 80, 80);
    doc.text(`${p} / ${totalPages}`, pageW / 2, pageH - 3, { align: "center" });
  }
  doc.setTextColor(0, 0, 0);

  return doc;
}

type DrawCtx = {
  M: number;
  W: number;
  y: number;
  need: (mm: number, fromY?: number) => number;
  names: string[];
  headers: string[];
  cols: PackingSlipColumn[];
  slip: NonNullable<Order["packingSlip"]>;
  rowCount: number;
  kg: number[];
  bundles: number[];
  bill: ReturnType<typeof computeBillFromSlip>;
  locale: "en" | "hi";
};

/** Grid: # + product columns; each cell = that row’s bundle kg. */
function drawGridWeighments(doc: jsPDF, ctx: DrawCtx): number {
  const {
    M,
    W,
    need,
    headers,
    cols,
    slip,
    rowCount,
    kg,
    bundles,
    bill,
    locale,
  } = ctx;
  let y = ctx.y;

  // A5 is only ~128 mm of usable width. Squeezing every product into it turns
  // each column into an unreadable sliver once an order runs past half a dozen
  // items, so print the grid in blocks the paper can actually hold.
  const perBlock = 6;
  const blocks: number[][] = [];
  for (let start = 0; start < cols.length; start += perBlock) {
    blocks.push(
      Array.from(
        { length: Math.min(perBlock, cols.length - start) },
        (_, i) => start + i
      )
    );
  }

  for (const idxs of blocks) {
    const blockCols = idxs.length;
    const fontSize =
      rowCount > 18 || blockCols > 3 ? 6 : rowCount > 12 ? 6.5 : 7;

    const head = ["#", ...idxs.map((c) => headers[c])];
    const body: string[][] = [];
    for (let r = 0; r < rowCount; r++) {
      const row = [String(r + 1)];
      for (const c of idxs) {
        const active = r < (cols[c].orderedBundles ?? rowCount);
        const v = slip.rows[r]?.cells[c];
        if (!active) row.push("");
        else if (v != null && Number.isFinite(v) && v > 0)
          row.push(`${Number(v).toFixed(2)} kg`);
        else row.push("");
      }
      body.push(row);
    }
    body.push([
      "TOTAL kg",
      ...idxs.map((c) => ((kg[c] ?? 0) > 0 ? `${kg[c].toFixed(2)} kg` : "-")),
    ]);
    body.push([
      "TOTAL BDL",
      ...idxs.map((c) => ((bundles[c] ?? 0) > 0 ? String(bundles[c]) : "-")),
    ]);
    body.push([
      "AMOUNT",
      ...idxs.map((c) => {
        const a = bill.lineAmounts[c] ?? 0;
        return a > 0 ? pdfMoney(a, locale) : "-";
      }),
    ]);

    y = need(24, y);
    if (blocks.length > 1) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6.5);
      doc.text(
        `ITEMS ${idxs[0] + 1}-${idxs[idxs.length - 1] + 1} / ${cols.length}`,
        M,
        y
      );
      y += 3;
    }

    autoTable(doc, {
      startY: y,
      head: [head],
      body,
      theme: "grid",
      styles: {
        fontSize,
        cellPadding: 0.9,
        lineColor: [0, 0, 0],
        lineWidth: 0.15,
        textColor: [0, 0, 0],
        overflow: "linebreak",
        valign: "middle",
        halign: "center",
      },
      headStyles: {
        fillColor: [240, 240, 240],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        fontSize: Math.max(5.5, fontSize - 0.3),
        halign: "left",
        valign: "top",
      },
      columnStyles: {
        0: {
          // Wide enough for "TOTAL BDL" / "AMOUNT" to sit on one line
          cellWidth: 15,
          fontStyle: "bold",
          fillColor: [248, 248, 248],
          halign: "center",
        },
      },
      didParseCell: (data) => {
        if (data.section !== "body" || !Array.isArray(data.row.raw)) return;
        const label = String(data.row.raw[0] ?? "");
        if (label === "TOTAL kg") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [235, 235, 235];
        } else if (label === "TOTAL BDL") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [232, 238, 248];
        } else if (label === "AMOUNT") {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [232, 245, 233];
        }
      },
      margin: { left: M, right: M, bottom: M },
      tableWidth: W,
      pageBreak: "auto",
      rowPageBreak: "avoid",
      showHead: "everyPage",
    });
    y = tableEndY(doc, y) + 3;
  }

  return y;
}
