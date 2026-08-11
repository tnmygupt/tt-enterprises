/**
 * Renders a sample report PDF and asserts the things that made the old
 * exports look broken. Run with:
 *   npx tsx scripts/check-report-pdf.mts
 * Writes a real PDF to tmp/ so the layout can be opened and eyeballed.
 */
import fs from "fs";
import path from "path";
import { renderTablePdf, sanitizePdfText } from "../src/lib/export-pdf";

let failures = 0;
function expect(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`
  );
}
function expectTrue(label: string, got: boolean) {
  expect(label, got, true);
}

console.log("--- sanitizePdfText ---");
expect(
  "rupee sign becomes Rs.",
  sanitizePdfText("₹1,23,456.00"),
  "Rs. 1,23,456.00"
);
expect("en dash becomes hyphen", sanitizePdfText("2026-01 – 2026-02"), "2026-01 - 2026-02");
expect("curly quotes flattened", sanitizePdfText("\u201Cabc\u201D"), '"abc"');
expect("middot becomes hyphen", sanitizePdfText("a · b"), "a - b");
expect("null is empty", sanitizePdfText(null), "");

console.log("\n--- rendering a report ---");
const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(n);

// Enough rows to force a page break, so page numbering gets exercised.
const rows = Array.from({ length: 120 }, (_, i) => [
  `2026-08-${String((i % 28) + 1).padStart(2, "0")}`,
  `Dealer ${i + 1} with a deliberately long trading name`,
  `INV-${1000 + i}`,
  inr((i + 1) * 1234.5),
  inr((i + 1) * 1000),
]);

const doc = await renderTablePdf({
  title: "Party statement",
  subtitle:
    "A deliberately long subtitle describing the filters applied to this report so that wrapping behaviour is exercised properly",
  filename: "sample.pdf",
  columns: ["Date", "Party", "Voucher", "Debit", "Credit"],
  rows,
  foot: ["", "", "Total", inr(1000000), inr(900000)],
  company: {
    name: "T T Enterprises",
    address: "Industrial Area, Kanpur, Uttar Pradesh 208001",
    gstin: "09ABCDE1234F1Z5",
    phone: "6386685663",
  },
});

const pages = doc.getNumberOfPages();
expectTrue("report spans multiple pages", pages > 1);

const bytes = doc.output("arraybuffer") as ArrayBuffer;
expectTrue("produced a non-trivial PDF", bytes.byteLength > 5000);

const raw = Buffer.from(bytes).toString("latin1");
expectTrue("PDF header present", raw.startsWith("%PDF"));

// jsPDF writes text uncompressed by default, so the strings are greppable.
expectTrue("no raw rupee sign survived into the document", !raw.includes("\u20B9"));
expectTrue("company name on the page", raw.includes("T T Enterprises"));
expectTrue("GSTIN on the letterhead", raw.includes("09ABCDE1234F1Z5"));
expectTrue("page numbering stamped", raw.includes("Page 1 of"));
expectTrue("last page numbered too", raw.includes(`Page ${pages} of ${pages}`));
expectTrue("amounts rendered as Rs.", raw.includes("Rs."));

const outDir = path.join(process.cwd(), "tmp");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, "sample-report.pdf");
fs.writeFileSync(outFile, Buffer.from(bytes));
console.log(`\nwrote ${outFile} (${pages} pages) — open it to check the layout`);

console.log(failures ? `\n${failures} FAILING` : "\nall checks passed");
process.exit(failures ? 1 : 0);
