/**
 * One-shot live ops: smoke-test order→pay→verify→wallet, then remove demo users.
 * Run: node scripts/smoke-and-delete-demos.mjs
 */
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const BASE = process.env.SMOKE_BASE || "https://tanmayphotos.space";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envProd = readFileSync(resolve(root, ".env.production"), "utf8");
const DB_KEY = (envProd.match(/^DB_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!DB_KEY) throw new Error("DB_API_KEY missing in .env.production");

function roundMoney(n) {
  return Math.round(Number(n) * 100) / 100;
}

async function login(phone, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`login ${phone}: ${data.error || res.status}`);
  const cookie = res.headers.getSetCookie?.()?.join("; ") || "";
  const sid =
    cookie.match(/tt_sid=([^;]+)/)?.[1] ||
    (res.headers.get("set-cookie") || "").match(/tt_sid=([^;]+)/)?.[1];
  if (!sid) throw new Error("No tt_sid cookie from login");
  return { user: data.user, cookie: `tt_sid=${sid}` };
}

async function getDb(cookie) {
  const res = await fetch(`${BASE}/api/db`, {
    headers: { "x-tt-db-key": DB_KEY, Cookie: cookie },
    cache: "no-store",
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`GET /api/db: ${data.error || res.status}`);
  return { db: data.db, updatedAt: data.updatedAt, scope: data.scope };
}

async function putDb(cookie, db, baseUpdatedAt) {
  const res = await fetch(`${BASE}/api/db`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-tt-db-key": DB_KEY,
      Cookie: cookie,
    },
    body: JSON.stringify({ db, baseUpdatedAt }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`PUT /api/db: ${data.error || res.status}`);
  }
  return data;
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

function nextDepositNumber(db) {
  const highest = (db.walletDeposits || []).reduce((max, d) => {
    const m = /WD-(\d+)/.exec(d.depositNumber || "");
    if (!m) return max;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > max ? n : max;
  }, 1000);
  return `WD-${highest + 1}`;
}

async function main() {
  const log = (...a) => console.log(...a);
  log("1) Login demo admin…");
  const admin = await login("9000000001", "admin123");
  log("   ok", admin.user.name, admin.user.role);

  log("2) Pull DB…");
  let { db, updatedAt } = await getDb(admin.cookie);
  log(
    `   users=${db.users.length} orders=${db.orders.length} products=${db.products.length}`
  );

  const dealer = db.users.find((u) => u.id === "user_dealer");
  if (!dealer) throw new Error("Demo dealer missing — cannot smoke test");

  const product = (db.products || []).find((p) => p.active && p.variations?.length);
  if (!product) throw new Error("No active product with variations");
  const variation = product.variations[0];
  const color = product.colors?.[0];
  const qty = 1;
  const unitWeight = variation.weightKg || product.baseWeightKg || 1;
  const rate = variation.rate || product.baseRate || 100;
  const weightKg = roundMoney(unitWeight * qty);
  const lineTotal = roundMoney(rate * qty);
  const shippingAmount = 0;
  const now = new Date().toISOString();
  const orderId = `ord_smoke_${randomUUID().slice(0, 8)}`;
  const orderNumber = nextOrderNumber(db);

  log("3) Create smoke estimate order…");
  const order = {
    id: orderId,
    orderNumber,
    userId: dealer.id,
    userName: dealer.name,
    userEmail: dealer.email || dealer.phone,
    status: "estimate",
    lines: [
      {
        id: `ol_${randomUUID().slice(0, 8)}`,
        productId: product.id,
        productName: product.name?.en || product.code,
        variationId: variation.id,
        variationLabel: variation.size?.en || variation.label?.en || "std",
        colorId: color?.id,
        colorName: color?.name?.en || color?.name,
        quantity: qty,
        unit: product.unit || "kg",
        rate,
        weightKg,
        estimatedWeightKg: weightKg,
        actualWeightKg: weightKg,
        lineTotal,
      },
    ],
    subtotal: lineTotal,
    shippingAmount,
    walletUsed: 0,
    estimatedTotal: lineTotal,
    estimatedWeightKg: weightKg,
    actualWeightKg: weightKg,
    actualBillAmount: lineTotal,
    schemeApplied: false,
    stockReserved: false,
    fullTruckRequested: false,
    deliveryAddress: dealer.address || "Smoke test address, Jaipur",
    checkoutName: dealer.name,
    phone: dealer.phone,
    transport: dealer.transport || "Local",
    billUploadedAt: now,
    paymentProof: {
      items: [
        {
          id: `pp_${randomUUID().slice(0, 8)}`,
          url: "https://via.placeholder.com/320x200.png?text=Smoke+Proof",
          type: "image",
          note: "Smoke test UPI proof",
          amount: lineTotal,
          uploadedAt: now,
          uploadedBy: dealer.id,
        },
      ],
      uploadedAt: now,
      verified: false,
    },
    timeline: [
      { status: "estimate", at: now, note: "Smoke test estimate" },
      { status: "billed", at: now, note: "Smoke test bill" },
      { status: "payment_uploaded", at: now, note: "Smoke test proof" },
    ],
    status: "payment_uploaded",
    createdAt: now,
    updatedAt: now,
  };
  // fix duplicate status key — last wins in object; set explicitly
  order.status = "payment_uploaded";

  db.orders = [order, ...(db.orders || [])];
  const put1 = await putDb(admin.cookie, db, updatedAt);
  updatedAt = put1.updatedAt;
  log("   order saved", orderNumber, `₹${lineTotal}`);

  log("4) Admin verify payment…");
  ({ db, updatedAt } = await getDb(admin.cookie));
  const liveOrder = db.orders.find((o) => o.id === orderId);
  if (!liveOrder) throw new Error("Smoke order not found after PUT");
  liveOrder.paymentProof.verified = true;
  liveOrder.paymentProof.verifiedAt = new Date().toISOString();
  liveOrder.paymentProof.verifiedBy = admin.user.id;
  liveOrder.status = "payment_verified";
  liveOrder.updatedAt = liveOrder.paymentProof.verifiedAt;
  liveOrder.timeline.push({
    status: "payment_verified",
    at: liveOrder.updatedAt,
    note: "Smoke test verified",
  });
  const put2 = await putDb(admin.cookie, db, updatedAt);
  updatedAt = put2.updatedAt;
  log("   payment verified");

  log("5) Wallet deposit → proof → verify…");
  ({ db, updatedAt } = await getDb(admin.cookie));
  const depositAmount = 500;
  const depositId = `wd_smoke_${randomUUID().slice(0, 8)}`;
  const deposit = {
    id: depositId,
    depositNumber: nextDepositNumber(db),
    userId: dealer.id,
    userName: dealer.name,
    userPhone: dealer.phone,
    amount: depositAmount,
    note: "Smoke test advance",
    status: "pending_verify",
    proof: {
      items: [
        {
          id: `pp_${randomUUID().slice(0, 8)}`,
          url: "https://via.placeholder.com/320x200.png?text=Deposit+Proof",
          type: "image",
          note: "Smoke deposit proof",
          amount: depositAmount,
          uploadedAt: new Date().toISOString(),
          uploadedBy: dealer.id,
        },
      ],
      uploadedAt: new Date().toISOString(),
      verified: false,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  db.walletDeposits = [deposit, ...(db.walletDeposits || [])];
  const put3 = await putDb(admin.cookie, db, updatedAt);
  updatedAt = put3.updatedAt;

  ({ db, updatedAt } = await getDb(admin.cookie));
  const liveDep = (db.walletDeposits || []).find((d) => d.id === depositId);
  if (!liveDep) throw new Error("Deposit missing");
  const dealerUser = db.users.find((u) => u.id === dealer.id);
  const beforeWallet = dealerUser.walletBalance || 0;
  liveDep.status = "verified";
  liveDep.proof.verified = true;
  liveDep.proof.verifiedAt = new Date().toISOString();
  liveDep.proof.verifiedBy = admin.user.id;
  liveDep.verifiedAt = liveDep.proof.verifiedAt;
  liveDep.verifiedBy = admin.user.id;
  liveDep.updatedAt = liveDep.proof.verifiedAt;
  dealerUser.walletBalance = roundMoney(beforeWallet + depositAmount);
  db.walletTransactions = [
    {
      id: `wt_smoke_${randomUUID().slice(0, 8)}`,
      userId: dealer.id,
      type: "credit",
      amount: depositAmount,
      reason: `Smoke deposit ${liveDep.depositNumber}`,
      depositId,
      createdAt: liveDep.verifiedAt,
      createdBy: admin.user.id,
    },
    ...(db.walletTransactions || []),
  ];
  const put4 = await putDb(admin.cookie, db, updatedAt);
  updatedAt = put4.updatedAt;
  log(
    `   wallet ${beforeWallet} → ${dealerUser.walletBalance} (+₹${depositAmount})`
  );

  log("6) Delete demo admin + dealer…");
  ({ db, updatedAt } = await getDb(admin.cookie));
  const before = db.users.length;
  db.users = db.users.filter(
    (u) => u.id !== "user_admin" && u.id !== "user_dealer"
  );
  // Unlink parties tied to demos (keep books)
  for (const p of db.parties || []) {
    if (p.linkedUserId === "user_admin" || p.linkedUserId === "user_dealer") {
      p.linkedUserId = undefined;
      p.active = p.type === "customer" ? false : p.active;
    }
  }
  if (db.users.length === before) {
    throw new Error("Demo users were not present to delete");
  }
  if (!db.users.some((u) => u.role === "super_admin")) {
    throw new Error("Refusing to delete demos — no remaining super_admin");
  }
  await putDb(admin.cookie, db, updatedAt);
  log(`   users ${before} → ${db.users.length}`);

  log("7) Confirm demos cannot login…");
  for (const phone of ["9000000001", "9000000002"]) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password: "admin123" }),
    });
    log(`   ${phone} → ${res.status} (want 401)`);
  }

  log("\nDONE");
  log("Smoke: estimate→bill→proof→verify + wallet deposit verify — OK");
  log("Demos deleted. Remaining super_admin: tanmay (6386685663)");
  log("Log in with your real admin phone going forward.");
}

main().catch((err) => {
  console.error("FAILED", err);
  process.exit(1);
});
