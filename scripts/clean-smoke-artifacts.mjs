/**
 * Strip smoke test artifacts left from launch smoke path.
 * Keeps owner 6386685663 and real business settings.
 */
import crypto from "crypto";
import fs from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const BASE = process.env.SMOKE_BASE || "https://app.ttenterprises.shop";
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

const adminId = "user_1ab6e723-017d-49bf-9ec3-73706e56b5c3";
const sess = {
  id: adminId,
  phone: "6386685663",
  name: "tanmay",
  role: "super_admin",
  locale: "en",
  exp: Math.floor(Date.now() / 1000) + 3600,
};
const payload = Buffer.from(JSON.stringify(sess), "utf8").toString("base64url");
const sig = crypto
  .createHmac("sha256", vars.SESSION_SECRET)
  .update(payload)
  .digest("base64url");
const cookie = `tt_sid=${payload}.${sig}`;

function isSmokeUser(u) {
  const phone = String(u.phone || "").replace(/\D/g, "");
  return (
    phone === "7000000999" ||
    String(u.id || "").startsWith("user_smoke_") ||
    /^Smoke/i.test(String(u.name || ""))
  );
}
function isSmokeProduct(p) {
  return (
    String(p.id || "").startsWith("prod_smoke_") ||
    String(p.code || "").startsWith("SMOKE") ||
    /^Smoke/i.test(String(p.name?.en || p.name || ""))
  );
}
function isSmokeOrder(o) {
  return String(o.id || "").startsWith("ord_smoke_");
}

const getRes = await fetch(`${BASE}/api/db`, {
  headers: {
    "x-tt-db-key": vars.DB_API_KEY,
    Cookie: cookie,
    Accept: "application/json",
  },
  cache: "no-store",
});
const getJson = await getRes.json();
if (!getRes.ok || !getJson.db) {
  console.error("GET failed", getRes.status, getJson);
  process.exit(1);
}

const db = getJson.db;
const before = {
  users: (db.users || []).length,
  products: (db.products || []).length,
  orders: (db.orders || []).length,
  moves: (db.stockMovements || []).length,
};

const smokeUserIds = new Set((db.users || []).filter(isSmokeUser).map((u) => u.id));
const smokeProductIds = new Set(
  (db.products || []).filter(isSmokeProduct).map((p) => p.id)
);
const smokeOrderIds = new Set(
  (db.orders || []).filter(isSmokeOrder).map((o) => o.id)
);

db.users = (db.users || []).filter((u) => !isSmokeUser(u));
db.products = (db.products || []).filter((p) => !isSmokeProduct(p));
db.orders = (db.orders || []).filter((o) => !isSmokeOrder(o));
db.stockMovements = (db.stockMovements || []).filter(
  (m) => !smokeOrderIds.has(m.orderId) && !/^smoke/i.test(String(m.note || ""))
);
db.walletTransactions = (db.walletTransactions || []).filter(
  (t) => !smokeUserIds.has(t.userId) && !smokeOrderIds.has(t.orderId)
);
db.walletDeposits = (db.walletDeposits || []).filter(
  (d) => !smokeUserIds.has(d.userId)
);
db.vouchers = (db.vouchers || []).filter(
  (v) => !smokeOrderIds.has(v.orderId) && !/^smoke/i.test(String(v.narration || ""))
);

// Tombstone smoke users so sync cannot resurrect
const now = new Date().toISOString();
db.deletedUserIds = [
  ...new Set([...(db.deletedUserIds || []), ...smokeUserIds]),
];
db.deletedUserAt = { ...(db.deletedUserAt || {}) };
for (const id of smokeUserIds) db.deletedUserAt[id] = now;

const putRes = await fetch(`${BASE}/api/db`, {
  method: "PUT",
  headers: {
    "Content-Type": "application/json",
    "x-tt-db-key": vars.DB_API_KEY,
    Cookie: cookie,
  },
  body: JSON.stringify({ db, baseUpdatedAt: getJson.updatedAt }),
});
const putJson = await putRes.json().catch(() => ({}));
if (!putRes.ok) {
  console.error("PUT failed", putRes.status, putJson);
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      before,
      removed: {
        users: [...smokeUserIds],
        products: [...smokeProductIds],
        orders: [...smokeOrderIds],
      },
      after: {
        users: (db.users || []).length,
        products: (db.products || []).length,
        orders: (db.orders || []).length,
      },
      updatedAt: putJson.updatedAt,
    },
    null,
    2
  )
);
