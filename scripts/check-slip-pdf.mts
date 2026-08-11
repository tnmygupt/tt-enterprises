/**
 * Renders a packing slip with many items — the case that used to squeeze every
 * product into one unreadable A5 grid. Writes tmp/slip-many.pdf to eyeball.
 *   npx tsx scripts/check-slip-pdf.mts
 */
import fs from "fs";
import path from "path";
import { buildPackingSlipFromOrder } from "../src/lib/packing-slip";
import { buildPackingSlipPdfDataUrl } from "../src/lib/packing-slip-pdf";
import type { Order, OrderLine } from "../src/lib/types";

const ITEMS = Number(process.argv[2] || 12);

const names = [
  ["Eagle cable", "12x2", "BLACK"],
  ["Shaktiman virgin thappi", "8X5", "YELLOW"],
  ["FPL", "12X4", "yellow"],
  ["FPL HEAVY DUTY", "12X3.5", "CHECK"],
  ["GREEN NET", "75% 3M/10FT EYELET", "GREEN"],
  ["GREEN NET", "75% 3M/10FT", "GREEN"],
  ["FRESH PIPE", "4IN", "WHITE"],
  ["Eagle cable", "12x1", "BLACK"],
  ["Eagle cable", "15x1", "BLACK"],
  ["Eagle cable", "20x2", "BLACK"],
  ["Shaktiman virgin thappi", "12X3.5", "YELLOW"],
  ["Shaktiman virgin thappi", "12X3.5", "Blue"],
];

const lines: OrderLine[] = Array.from({ length: ITEMS }, (_, i) => {
  const [name, size, color] = names[i % names.length];
  const bundles = (i % 5) + 1;
  const rate = 110 + i * 7;
  const weightKg = bundles * 21.5;
  return {
    productId: `p${i}`,
    productCode: `SKU-${100 + i}`,
    productName: { en: name, hi: name },
    size: { en: size, hi: size },
    colorName: { en: color, hi: color },
    unit: "kg",
    pricingMode: "bundle",
    rate,
    quantity: bundles,
    weightKg,
    lineTotal: rate * weightKg,
  } as OrderLine;
});

const order = {
  id: "ord_test",
  orderNumber: "TT-EST-00005-9830",
  userId: "u1",
  userName: "TEST DEALER",
  userEmail: "",
  status: "payment_pending",
  lines,
  subtotal: 0,
  shippingAmount: 780,
  walletUsed: 0,
  estimatedTotal: 0,
  fullTruckRequested: false,
  deliveryAddress: "City - PIN 000000",
  phone: "0000000000",
  gstOrAadhar: "",
  transport: "",
  checkoutName: "TEST DEALER",
  customerNotes: "",
  timeline: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as unknown as Order;

const slip = buildPackingSlipFromOrder(order);
// Fill weighments so totals and amounts are exercised, not just empty boxes.
for (let c = 0; c < slip.columns.length; c++) {
  const ordered = slip.columns[c].orderedBundles ?? 0;
  for (let r = 0; r < ordered; r++) {
    slip.rows[r].cells[c] = 20 + ((r + c) % 5);
  }
}
slip.status = "finalized";
order.packingSlip = slip;

const dataUrl = buildPackingSlipPdfDataUrl(order, "en", {
  name: "T T Enterprises",
  address: "Industrial Area, Kanpur, Uttar Pradesh 208001",
  gstin: "09ABCDE1234F1Z5",
  phone: "6386685663",
});

const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
const bytes = Buffer.from(base64, "base64");
const outDir = path.join(process.cwd(), "tmp");
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, `slip-${ITEMS}items.pdf`);
fs.writeFileSync(out, bytes);

const raw = bytes.toString("latin1");
const checks: [string, boolean][] = [
  ["produced a PDF", raw.startsWith("%PDF")],
  ["no raw rupee sign", !raw.includes("\u20B9")],
  ["letterhead GSTIN present", raw.includes("09ABCDE1234F1Z5")],
  [
    "grid split into blocks",
    ITEMS <= 6 ? !raw.includes("ITEMS 1-") : raw.includes("ITEMS 1-6"),
  ],
];
let bad = 0;
for (const [label, ok] of checks) {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
}
console.log(`\nwrote ${out} (${bytes.length} bytes, ${ITEMS} items)`);
process.exit(bad ? 1 : 0);
