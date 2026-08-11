/**
 * Launch smoke: estimate → packing slip weigh → bill → pay → verify
 * against app.ttenterprises.shop (override with SMOKE_BASE).
 *
 * Uses forged owner session from .env.production (SESSION_SECRET + DB_API_KEY).
 * Creates a temporary dealer + product if catalog empty; cleans smoke order
 * optionally via CLEANUP=1.
 *
 * Run: node scripts/smoke-launch-path.mjs
 */
import crypto from "crypto";
import fs from "fs";
import { randomUUID } from "crypto";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const BASE =
  process.env.SMOKE_BASE || "https://app.ttenterprises.shop";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const vars = {};
for (const line of fs.readFileSync(resolve(root, ".env.production"), "utf8").split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  vars[line.slice(0, i).trim()] = line
    .slice(i + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}
if (!vars.SESSION_SECRET || !vars.DB_API_KEY) {
  console.error("MISSING_ENV SESSION_SECRET / DB_API_KEY");
  process.exit(1);
}

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}
function roundOffRupees(n) {
  return Math.round(Number(n) || 0);
}

const results = [];
function pass(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

async function http(path, { method = "GET", body, cookie } = {}) {
  const headers = {
    "x-tt-db-key": vars.DB_API_KEY,
    Accept: "application/json",
  };
  if (cookie) headers.Cookie = cookie;
  if (body != null) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body != null ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* ignore */
  }
  return { status: res.status, json, text };
}

function forgeCookie(user) {
  const sess = {
    id: user.id,
    phone: user.phone,
    name: user.name,
    role: user.role,
    locale: "en",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const payload = Buffer.from(JSON.stringify(sess), "utf8").toString("base64url");
  const sig = crypto
    .createHmac("sha256", vars.SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  return `tt_sid=${payload}.${sig}`;
}

function nextOrderNumber(db) {
  const highest = (db.orders || []).reduce((max, o) => {
    const m = /TT-EST-(\d+)/.exec(o.orderNumber || "");
    if (!m) return max;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > max ? n : max;
  }, 0);
  return `TT-EST-${String(highest + 1).padStart(5, "0")}`;
}

function buildSlip(order) {
  const cols = order.lines.length;
  const qty = Math.max(
    1,
    ...order.lines.map((l) => Math.round(Number(l.quantity) || 0))
  );
  return {
    slipNo: `PS-${order.orderNumber}`,
    status: "draft",
    date: new Date().toISOString().slice(0, 10),
    partyName: order.checkoutName || order.userName,
    partyPhone: order.phone || "",
    partyAddress: order.deliveryAddress || "",
    partyGstin: order.gstOrAadhar || "",
    transport: order.transport || "",
    preparedBy: "Smoke",
    checkedBy: "Smoke",
    note: "launch smoke",
    columns: order.lines.map((line, lineIndex) => ({
      lineIndex,
      label: line.productName?.en || line.productCode || "Item",
      productId: line.productId,
      variationId: line.variationId,
      colorId: line.colorId,
      rate: line.rate,
      pricingMode: line.pricingMode || "kg",
      orderedBundles: Math.max(0, Math.round(Number(line.quantity) || 0)),
    })),
    rows: Array.from({ length: qty }, () => ({
      cells: Array.from({ length: cols }, () => null),
    })),
    bundles: Array.from({ length: cols }, () => null),
  };
}

async function main() {
  console.log(`BASE=${BASE}`);

  // A) Public + HTTPS
  for (const p of ["/en", "/en/login", "/en/catalog"]) {
    const r = await fetch(`${BASE}${p}`, { redirect: "follow" });
    pass(`Public ${p}`, r.status === 200, `status=${r.status}`);
  }

  // Known live owner id (launch wipe kept this account)
  let cookie = forgeCookie({
    id: "user_1ab6e723-017d-49bf-9ec3-73706e56b5c3",
    phone: "6386685663",
    name: "tanmay",
    role: "super_admin",
  });

  let get = await http("/api/db", { cookie });
  pass(
    "Owner GET /api/db",
    get.status === 200 && get.json?.scope === "owner" && !!get.json?.db,
    `status=${get.status} scope=${get.json?.scope}`
  );
  if (!(get.status === 200 && get.json?.db)) {
    console.log(get.text?.slice(0, 300));
    console.log("--- abort ---");
    process.exit(2);
  }

  let db = get.json.db;
  let updatedAt = get.json.updatedAt;
  const admin = (db.users || []).find(
    (u) => String(u.phone || "").replace(/\D/g, "").slice(-10) === "6386685663"
  );
  pass(
    "Admin 6386685663",
    !!admin && admin.role === "super_admin",
    `id=${admin?.id} role=${admin?.role}`
  );
  if (!admin) process.exit(2);
  cookie = forgeCookie(admin);

  // Ensure dealer for customer path
  let dealer = (db.users || []).find(
    (u) =>
      u.role === "dealer" &&
      u.active !== false &&
      String(u.phone || "").includes("7000000999")
  );
  if (!dealer) {
    dealer = {
      id: `user_smoke_${randomUUID().slice(0, 8)}`,
      name: "Smoke Dealer",
      phone: "7000000999",
      passwordHash: "x",
      passwordVisible: "smoke123",
      role: "dealer",
      active: true,
      approved: true,
      locale: "en",
      walletBalance: 0,
      address: "Smoke Lane, Jaipur",
      transport: "Local",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.users = [...(db.users || []), dealer];
  }

  // Ensure product with stock
  let product = (db.products || []).find(
    (p) => p.active !== false && (p.variations || []).length
  );
  if (!product) {
    const vid = `var_${randomUUID().slice(0, 8)}`;
    product = {
      id: `prod_smoke_${randomUUID().slice(0, 8)}`,
      code: "SMOKE-KG",
      name: { en: "Smoke Wire", hi: "Smoke Wire" },
      unit: "kg",
      baseRate: 100,
      baseWeightKg: 1,
      active: true,
      colors: [
        {
          id: `col_${randomUUID().slice(0, 8)}`,
          name: { en: "Natural", hi: "Natural" },
        },
      ],
      variations: [
        {
          id: vid,
          size: { en: "1kg", hi: "1kg" },
          label: { en: "1kg", hi: "1kg" },
          rate: 100,
          weightKg: 1,
          stock: 100,
        },
      ],
      stock: 100,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    db.products = [...(db.products || []), product];
  } else {
    // bump stock if needed
    const v0 = product.variations[0];
    if ((v0.stock || 0) < 5) v0.stock = 50;
    if ((product.stock || 0) < 5) product.stock = 50;
  }

  const variation = product.variations[0];
  const color = product.colors?.[0];
  const qty = 2;
  const rate = variation.rate || product.baseRate || 100;
  const unitWeight = variation.weightKg || product.baseWeightKg || 1;
  const weightKg = roundMoney(unitWeight * qty);
  const lineTotal = roundMoney(rate * weightKg); // kg pricing: rate × kg
  const shippingAmount = 0;
  const estimatedTotal = roundOffRupees(lineTotal + shippingAmount);
  const now = new Date().toISOString();
  const orderId = `ord_smoke_${randomUUID().slice(0, 8)}`;
  const orderNumber = nextOrderNumber(db);

  const line = {
    id: `ol_${randomUUID().slice(0, 8)}`,
    productId: product.id,
    productCode: product.code,
    productName: product.name,
    variationId: variation.id,
    variationLabel: variation.size || variation.label || { en: "std" },
    size: variation.size || variation.label,
    colorId: color?.id,
    colorName: color?.name,
    quantity: qty,
    unit: product.unit || "kg",
    pricingMode: "kg",
    rate,
    weightKg,
    estimatedWeightKg: weightKg,
    lineTotal,
  };

  let order = {
    id: orderId,
    orderNumber,
    userId: dealer.id,
    userName: dealer.name,
    userEmail: dealer.phone,
    status: "estimate",
    lines: [line],
    subtotal: lineTotal,
    shippingAmount,
    walletUsed: 0,
    estimatedTotal,
    estimatedWeightKg: weightKg,
    stockReserved: true,
    fullTruckRequested: false,
    deliveryAddress: dealer.address || "Smoke address",
    checkoutName: dealer.name,
    phone: dealer.phone,
    transport: dealer.transport || "Local",
    packingSlip: null,
    timeline: [{ status: "estimate", at: now, note: "Smoke estimate" }],
    createdAt: now,
    updatedAt: now,
  };
  order.packingSlip = buildSlip(order);
  order.timeline.push({
    status: "packing_slip",
    at: now,
    note: `Packing slip ${order.packingSlip.slipNo} draft`,
  });

  // Reserve stock locally in payload
  variation.stock = Math.max(0, (variation.stock || 0) - qty);
  product.stock = Math.max(0, (product.stock || 0) - qty);

  db.orders = [order, ...(db.orders || [])];
  db.stockMovements = [
    {
      id: `sm_${randomUUID().slice(0, 8)}`,
      type: "estimate_reserve",
      productId: product.id,
      variationId: variation.id,
      quantity: qty,
      orderId,
      note: "smoke reserve",
      createdAt: now,
      createdBy: admin.id,
    },
    ...(db.stockMovements || []),
  ];

  console.log("=== 1) Create estimate + draft slip ===");
  let put = await http("/api/db", {
    method: "PUT",
    cookie,
    body: { db, baseUpdatedAt: updatedAt },
  });
  pass(
    "PUT estimate",
    put.status === 200 && !!put.json?.updatedAt,
    `status=${put.status} err=${put.json?.error || ""}`
  );
  if (put.status !== 200) {
    console.log(put.text?.slice(0, 500));
    process.exit(2);
  }
  updatedAt = put.json.updatedAt;

  get = await http("/api/db", { cookie });
  db = get.json.db;
  updatedAt = get.json.updatedAt;
  order = db.orders.find((o) => o.id === orderId);
  pass(
    "Estimate persisted",
    !!order && order.status === "estimate" && order.packingSlip?.status === "draft",
    `status=${order?.status} slip=${order?.packingSlip?.status}`
  );

  // Page shells
  for (const p of [
    `/en/admin/orders`,
    `/en/admin/orders/${orderId}/packing-slip`,
    `/en/orders/${orderId}`,
  ]) {
    const r = await fetch(`${BASE}${p}`, {
      headers: { Cookie: cookie },
      redirect: "follow",
    });
    pass(`Page ${p}`, r.status === 200, `status=${r.status}`);
  }

  console.log("=== 2) Fill weighments on slip ===");
  const slip = order.packingSlip;
  // 2 bundles × ~unitWeight each
  slip.rows = [
    { cells: [roundMoney(unitWeight)] },
    { cells: [roundMoney(unitWeight)] },
  ];
  slip.bundles = [2];
  slip.preparedBy = "Smoke Prep";
  slip.checkedBy = "Smoke Check";
  order.updatedAt = new Date().toISOString();
  put = await http("/api/db", {
    method: "PUT",
    cookie,
    body: { db, baseUpdatedAt: updatedAt },
  });
  pass("PUT slip weighments", put.status === 200, `status=${put.status}`);
  updatedAt = put.json.updatedAt;

  console.log("=== 3) Finalize → bill (payment_pending) ===");
  get = await http("/api/db", { cookie });
  db = get.json.db;
  updatedAt = get.json.updatedAt;
  order = db.orders.find((o) => o.id === orderId);
  const actualKg = roundMoney(unitWeight * 2);
  order.lines[0].actualWeightKg = actualKg;
  order.lines[0].weightKg = actualKg;
  order.lines[0].lineTotal = roundMoney(rate * actualKg);
  order.subtotal = order.lines[0].lineTotal;
  order.actualWeightKg = actualKg;
  const grossBill = roundOffRupees(order.subtotal + (order.shippingAmount || 0));
  order.actualBillAmount = grossBill;
  order.billUploadedAt = new Date().toISOString();
  order.status = "payment_pending";
  order.packingSlip.status = "finalized";
  order.packingSlip.finalizedAt = order.billUploadedAt;
  order.packingSlip.finalizedBy = admin.name;
  order.packingSlip.shippingAmount = order.shippingAmount || 0;
  order.timeline.push(
    {
      status: "packing_slip_finalized",
      at: order.billUploadedAt,
      note: `Smoke finalize · ${actualKg} kg · bill ₹${grossBill}`,
    },
    {
      status: "payment_pending",
      at: order.billUploadedAt,
      note: `Final bill uploaded: ₹${grossBill}`,
    }
  );
  order.updatedAt = order.billUploadedAt;

  put = await http("/api/db", {
    method: "PUT",
    cookie,
    body: { db, baseUpdatedAt: updatedAt },
  });
  pass("PUT bill/finalize", put.status === 200, `status=${put.status}`);
  updatedAt = put.json.updatedAt;

  get = await http("/api/db", { cookie });
  db = get.json.db;
  updatedAt = get.json.updatedAt;
  order = db.orders.find((o) => o.id === orderId);
  pass(
    "Billed state",
    order?.status === "payment_pending" &&
      order?.packingSlip?.status === "finalized" &&
      (order?.actualBillAmount || 0) > 0,
    `status=${order?.status} bill=${order?.actualBillAmount} slip=${order?.packingSlip?.status}`
  );

  console.log("=== 4) Upload payment proof ===");
  const due = roundOffRupees(
    (order.actualBillAmount || 0) - (order.walletUsed || 0)
  );
  order.paymentProof = {
    items: [
      {
        id: `pp_${randomUUID().slice(0, 8)}`,
        url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        type: "image",
        note: "Smoke UPI",
        amount: due,
        uploadedAt: new Date().toISOString(),
        uploadedBy: dealer.id,
      },
    ],
    uploadedAt: new Date().toISOString(),
    verified: false,
  };
  order.status = "payment_uploaded";
  order.timeline.push({
    status: "payment_uploaded",
    at: order.paymentProof.uploadedAt,
    note: "Smoke payment proof",
  });
  order.updatedAt = order.paymentProof.uploadedAt;
  put = await http("/api/db", {
    method: "PUT",
    cookie,
    body: { db, baseUpdatedAt: updatedAt },
  });
  pass("PUT payment proof", put.status === 200, `status=${put.status}`);
  updatedAt = put.json.updatedAt;

  console.log("=== 5) Verify payment ===");
  get = await http("/api/db", { cookie });
  db = get.json.db;
  updatedAt = get.json.updatedAt;
  order = db.orders.find((o) => o.id === orderId);
  order.paymentProof.verified = true;
  order.paymentProof.verifiedAt = new Date().toISOString();
  order.paymentProof.verifiedBy = admin.id;
  order.status = "payment_verified";
  order.timeline.push({
    status: "payment_verified",
    at: order.paymentProof.verifiedAt,
    note: "Smoke verified",
  });
  order.updatedAt = order.paymentProof.verifiedAt;
  put = await http("/api/db", {
    method: "PUT",
    cookie,
    body: { db, baseUpdatedAt: updatedAt },
  });
  pass("PUT verify payment", put.status === 200, `status=${put.status}`);

  get = await http("/api/db", { cookie });
  order = get.json.db.orders.find((o) => o.id === orderId);
  pass(
    "Payment verified",
    order?.status === "payment_verified" && order?.paymentProof?.verified === true,
    `status=${order?.status} bill=₹${order?.actualBillAmount}`
  );

  // Optional cleanup
  if (process.env.CLEANUP === "1") {
    console.log("=== CLEANUP smoke order ===");
    db = get.json.db;
    updatedAt = get.json.updatedAt;
    db.orders = (db.orders || []).filter((o) => o.id !== orderId);
    put = await http("/api/db", {
      method: "PUT",
      cookie,
      body: { db, baseUpdatedAt: updatedAt },
    });
    pass("Cleanup order", put.status === 200, `status=${put.status}`);
  } else {
    console.log(`Kept smoke order ${orderNumber} (${orderId}) — set CLEANUP=1 to remove`);
  }

  const failed = results.filter((r) => !r.ok).length;
  const passed = results.filter((r) => r.ok).length;
  console.log("---");
  console.log(`SMOKE LAUNCH: ${passed} passed, ${failed} failed | order=${orderNumber}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
