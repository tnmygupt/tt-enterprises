/**
 * Throwaway check for rebalanceOrderReservation — run with:
 *   npx tsx scripts/check-reserve-rebalance.mts
 * Pure in-memory, touches no database.
 */
import {
  orderLineSecondaryQty,
  rebalanceOrderReservation,
} from "../src/lib/inventory";

let failures = 0;
function expect(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label} — got ${JSON.stringify(got)}${ok ? "" : `, want ${JSON.stringify(want)}`}`);
}

function makeDb(startSecondary: number) {
  return {
    products: [
      {
        id: "p1",
        code: "P1",
        name: { en: "Pipe", hi: "Pipe" },
        unit: "kg",
        active: true,
        colors: [],
        variations: [
          {
            id: "v1",
            label: { en: "2 inch", hi: "2 inch" },
            sku: "P1-2",
            stock: 10,
            stockSecondary: startSecondary,
            rate: 50,
          },
        ],
        stock: 10,
        stockSecondary: startSecondary,
      },
    ],
    stockMovements: [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function makeLine(weightKg: number) {
  return {
    productId: "p1",
    variationId: "v1",
    quantity: 1,
    unit: "kg",
    weightKg,
    productName: { en: "Pipe", hi: "Pipe" },
    rate: 50,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

function run(estimateKg: number, actualKg: number, startSecondary = 1000) {
  const db = makeDb(startSecondary);
  const line = makeLine(estimateKg);
  const order = { id: "o1", orderNumber: "EST-1", lines: [line] };
  const before = order.lines.map((l) => orderLineSecondaryQty(db, l));
  line.weightKg = actualKg;
  rebalanceOrderReservation(db, order, before, "tester");
  return {
    secondary: db.products[0].variations[0].stockSecondary,
    bundles: db.products[0].variations[0].stock,
    moves: db.stockMovements.map(
      (m: { type: string; direction: string; secondaryQty: number; qty: number }) => ({
        type: m.type,
        dir: m.direction,
        sec: m.secondaryQty,
        qty: m.qty,
      })
    ),
  };
}

console.log("--- heavier actual (100kg reserved, 110kg real) ---");
const heavier = run(100, 110);
expect("stock drops the extra 10kg", heavier.secondary, 990);
expect("bundles untouched", heavier.bundles, 10);
expect("one reserve movement", heavier.moves, [
  { type: "estimate_reserve", dir: "out", sec: 10, qty: 0 },
]);

console.log("\n--- lighter actual (100kg reserved, 90kg real) ---");
const lighter = run(100, 90);
expect("stock returns 10kg", lighter.secondary, 1010);
expect("one release movement", lighter.moves, [
  { type: "estimate_release", dir: "in", sec: 10, qty: 0 },
]);

console.log("\n--- actual equals estimate ---");
const same = run(100, 100);
expect("stock unchanged", same.secondary, 1000);
expect("no movement logged", same.moves, []);

console.log("\n--- second weighing rebalances against the first, not the estimate ---");
{
  const db = makeDb(1000);
  const line = makeLine(100);
  const order = { id: "o1", orderNumber: "EST-1", lines: [line] };

  let before = order.lines.map((l) => orderLineSecondaryQty(db, l));
  line.weightKg = 110;
  rebalanceOrderReservation(db, order, before, "tester");

  before = order.lines.map((l) => orderLineSecondaryQty(db, l));
  line.weightKg = 105;
  rebalanceOrderReservation(db, order, before, "tester");

  // Start (1000) already has the original 100kg estimate deducted, so the
  // rebalance only moves the 5kg difference between 105 and that estimate.
  expect(
    "net effect is 5kg more held than the estimate",
    db.products[0].variations[0].stockSecondary,
    995
  );
  expect("second move gives back 5kg", db.stockMovements[0].secondaryQty, 5);
  expect("second move is a release", db.stockMovements[0].type, "estimate_release");
}

console.log(failures ? `\n${failures} FAILING` : "\nall checks passed");
process.exit(failures ? 1 : 0);
