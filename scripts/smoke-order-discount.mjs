/**
 * Smoke: per-order discount scheme math (no DOM / localStorage).
 * Run: node scripts/smoke-order-discount.mjs
 */
import {
  estimateSchemePayout,
  isOrderDiscountScheme,
  orderQtyForScheme,
  orderScopedSubtotal,
  pickBestOrderDiscount,
  resolveOrderDiscount,
} from "../src/lib/schemes.ts";

const now = Date.now();
const baseScheme = {
  id: "s1",
  name: { en: "Order 2%", hi: "Order 2%" },
  description: { en: "", hi: "" },
  termsAndConditions: { en: "", hi: "" },
  progressUnit: "bundles",
  targetWeightKg: 50,
  creditAmount: 0,
  discountPerKg: 0,
  scopeType: "all",
  scopeProductIds: [],
  appliesToAllDealers: true,
  active: true,
  startDate: new Date(now - 86400000).toISOString(),
  endDate: new Date(now + 86400000 * 30).toISOString(),
  createdAt: new Date().toISOString(),
};

const percentScheme = {
  ...baseScheme,
  rewardType: "order_percent",
  levels: [
    { id: "t1", name: { en: "T1", hi: "T1" }, targetAmount: 10, ratePerUnit: 2 },
    { id: "t2", name: { en: "T2", hi: "T2" }, targetAmount: 50, ratePerUnit: 5 },
  ],
};

const flatScheme = {
  ...baseScheme,
  id: "s2",
  name: { en: "Flat 500", hi: "Flat 500" },
  rewardType: "order_flat",
  levels: [
    {
      id: "t1",
      name: { en: "T1", hi: "T1" },
      targetAmount: 10,
      ratePerUnit: 100,
    },
    {
      id: "t2",
      name: { en: "T2", hi: "T2" },
      targetAmount: 50,
      ratePerUnit: 500,
    },
  ],
};

const lifting = {
  ...baseScheme,
  id: "s3",
  rewardType: "per_kg_rate",
  discountPerKg: 1,
  levels: [
    {
      id: "t1",
      name: { en: "T1", hi: "T1" },
      targetAmount: 1000,
      ratePerUnit: 1,
    },
  ],
};

const product = {
  id: "p1",
  code: "P1",
  name: { en: "Tarpaulin", hi: "Tirpal" },
  category: "tarpaulin",
  unit: "bundle",
  pricingMode: "bundle",
  baseRate: 100,
  baseWeightKg: 10,
  colors: [],
  variations: [],
  active: true,
  createdAt: new Date().toISOString(),
};

const lines10 = [
  {
    productId: "p1",
    productCode: "P1",
    productName: { en: "Tarpaulin", hi: "Tirpal" },
    unit: "bundle",
    pricingMode: "bundle",
    rate: 100,
    quantity: 10,
    weightKg: 100,
    estimatedWeightKg: 100,
    lineTotal: 10000,
  },
];

const lines50 = [
  {
    ...lines10[0],
    quantity: 50,
    weightKg: 500,
    estimatedWeightKg: 500,
    lineTotal: 50000,
  },
];

const products = [product];
let failed = 0;
function assert(name, cond, detail) {
  if (cond) console.log("OK  " + name);
  else {
    failed++;
    console.log("FAIL " + name + (detail ? " — " + detail : ""));
  }
}

assert("isOrderDiscount percent", isOrderDiscountScheme(percentScheme));
assert("isOrderDiscount flat", isOrderDiscountScheme(flatScheme));
assert("not order discount lifting", !isOrderDiscountScheme(lifting));
assert(
  "wallet payout skipped",
  estimateSchemePayout(percentScheme, 50, 50000) === 0
);

assert(
  "qty bundles 10",
  orderQtyForScheme(percentScheme, lines10, products) === 10
);
assert(
  "qty bundles 50",
  orderQtyForScheme(percentScheme, lines50, products) === 50
);
assert(
  "scoped subtotal",
  orderScopedSubtotal(percentScheme, lines10, products) === 10000
);

const r10 = resolveOrderDiscount(percentScheme, lines10, products);
assert("2% of 10000 = 200", r10.amount === 200, String(r10.amount));
const r50 = resolveOrderDiscount(percentScheme, lines50, products);
assert("5% of 50000 = 2500", r50.amount === 2500, String(r50.amount));

const f10 = resolveOrderDiscount(flatScheme, lines10, products);
assert("flat 100 at 10", f10.amount === 100, String(f10.amount));
const f50 = resolveOrderDiscount(flatScheme, lines50, products);
assert("flat 500 at 50", f50.amount === 500, String(f50.amount));

const huge = {
  ...flatScheme,
  levels: [
    {
      id: "t1",
      name: { en: "T1", hi: "T1" },
      targetAmount: 1,
      ratePerUnit: 999999,
    },
  ],
};
const capped = resolveOrderDiscount(huge, lines10, products);
assert("cap at scoped subtotal", capped.amount === 10000, String(capped.amount));

const best = pickBestOrderDiscount(
  [percentScheme, flatScheme],
  null,
  lines50,
  products
);
assert(
  "best is percent 2500",
  best?.amount === 2500 && best?.scheme.id === "s1",
  JSON.stringify(best && { amount: best.amount, id: best.scheme.id })
);

const lines5 = [{ ...lines10[0], quantity: 5, lineTotal: 5000 }];
const none = resolveOrderDiscount(percentScheme, lines5, products);
assert("below tier = 0", none.amount === 0);

const itemMergeScheme = {
  ...percentScheme,
  id: "s-item",
  levels: [
    {
      id: "t1",
      name: { en: "T1", hi: "T1" },
      targetAmount: 20,
      ratePerUnit: 2,
    },
  ],
};
const productSized = {
  ...product,
  variations: [
    {
      id: "v12",
      label: { en: "12x18", hi: "12x18" },
      size: { en: "12x18", hi: "12x18" },
      sku: "12",
      rate: 100,
      stock: 99,
    },
    {
      id: "v15",
      label: { en: "15x18", hi: "15x18" },
      size: { en: "15x18", hi: "15x18" },
      sku: "15",
      rate: 100,
      stock: 99,
    },
  ],
};
const split10 = [
  {
    ...lines10[0],
    variationId: "v12",
    quantity: 10,
    lineTotal: 5000,
    weightKg: 100,
    estimatedWeightKg: 100,
  },
  {
    ...lines10[0],
    variationId: "v15",
    quantity: 10,
    lineTotal: 5000,
    weightKg: 100,
    estimatedWeightKg: 100,
  },
];
const sameItemMerge = resolveOrderDiscount(itemMergeScheme, split10, [
  productSized,
]);
assert(
  "10+10 sizes of same item merge to 20",
  sameItemMerge.amount === 200,
  String(sameItemMerge.amount)
);
const otherProduct = { ...productSized, id: "p2" };
const splitItems = [
  split10[0],
  { ...split10[1], productId: "p2" },
];
const noCrossItem = resolveOrderDiscount(itemMergeScheme, splitItems, [
  productSized,
  otherProduct,
]);
assert(
  "10+10 different items do not merge to 20",
  noCrossItem.amount === 0,
  String(noCrossItem.amount)
);
const oneSize20 = [
  {
    ...lines10[0],
    variationId: "v12",
    quantity: 20,
    lineTotal: 10000,
    weightKg: 200,
    estimatedWeightKg: 200,
  },
  {
    ...lines10[0],
    variationId: "v15",
    quantity: 5,
    lineTotal: 2500,
    weightKg: 50,
    estimatedWeightKg: 50,
  },
];
const allSizesOfItem = resolveOrderDiscount(
  itemMergeScheme,
  oneSize20,
  [productSized]
);
assert(
  "all sizes of the item get 2% once 20 bundles",
  allSizesOfItem.amount === 250,
  String(allSizesOfItem.amount)
);

const ended = {
  ...percentScheme,
  endDate: new Date(now - 86400000).toISOString(),
};
const skipEnded = pickBestOrderDiscount([ended], null, lines50, products);
assert("ended skipped", skipEnded === null);

if (failed) {
  console.log("\nFAILED: " + failed);
  process.exit(1);
}
console.log("\nAll smoke assertions passed");
