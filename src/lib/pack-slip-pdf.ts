import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import {
  formatPackKg,
  packSlipAmount,
  packSlipKg,
  packSlipTotalAmount,
  packSlipTotalKg,
  type PackSlip,
} from "@/lib/pack-slips";
import { saveOrOpenPdfBlob } from "@/lib/packing-slip-pdf";

/** A5 packing slip with no company letterhead. */
export async function downloadStandalonePackSlipPdf(slip: PackSlip): Promise<void> {
  const doc = new jsPDF({ unit: "mm", format: "a5" });
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("PACKING SLIP", 10, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(slip.slipNo, pageWidth - 10, 12, { align: "right" });
  doc.text(slip.date, pageWidth - 10, 17, { align: "right" });
  let y = 20;
  doc.setFont("helvetica", "bold");
  doc.text(slip.partyName || "—", 10, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  if (slip.partyPhone) {
    doc.text(slip.partyPhone, 10, y);
    y += 4;
  }
  if (slip.partyAddress) {
    const lines = doc.splitTextToSize(slip.partyAddress, pageWidth - 20);
    doc.text(lines, 10, y);
    y += lines.length * 4;
  }
  y += 2;
  const head = ["Bundle", ...slip.items.map((item) => item.name || "Item")];
  const rows = Math.max(...slip.items.map((item) => item.bundles), 1);
  const body: string[][] = [];
  for (let row = 0; row < rows; row += 1) {
    body.push([
      String(row + 1),
      ...slip.items.map((_, index) => {
        const kg = slip.weights[index]?.[row];
        return kg == null ? "" : formatPackKg(kg);
      }),
    ]);
  }
  body.push([
    "Kg",
    ...slip.items.map((_, index) => formatPackKg(packSlipKg(slip, index))),
  ]);
  autoTable(doc, {
    startY: y,
    head: [head],
    body,
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 1, textColor: 0 },
    headStyles: { fillColor: [255, 255, 255], textColor: 0, fontStyle: "bold" },
    margin: { left: 10, right: 10 },
  });
  const after = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 20;
  let cursor = after + 6;
  doc.setFont("helvetica", "bold");
  doc.text(`Total ${formatPackKg(packSlipTotalKg(slip))} kg`, 10, cursor);
  const amount = packSlipTotalAmount(slip);
  if (amount > 0) {
    cursor += 5;
    doc.text(`Amount Rs. ${amount.toFixed(2)}`, 10, cursor);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    slip.items.forEach((item, index) => {
      const line = packSlipAmount(slip, index);
      if (!(line > 0)) return;
      cursor += 4;
      doc.text(`${item.name || "Item"} @ Rs. ${item.rate} = Rs. ${line.toFixed(2)}`, 10, cursor);
    });
  }
  if (slip.note) {
    cursor += 6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(doc.splitTextToSize(slip.note, pageWidth - 20), 10, cursor);
  }
  const blob = doc.output("blob");
  await saveOrOpenPdfBlob(blob, `${slip.slipNo}-packing-slip.pdf`);
}
