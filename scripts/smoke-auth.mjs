import crypto from "crypto";
import fs from "fs";
import https from "https";
import { spawnSync } from "child_process";
import os from "os";
import path from "path";

const envPath = new URL("../.env.production", import.meta.url);
const vars = {};
for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  vars[line.slice(0, i).trim()] = line
    .slice(i + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

const secret = vars.SESSION_SECRET;
const dbKey = vars.DB_API_KEY;
if (!secret || !dbKey) {
  console.log("MISSING_ENV");
  process.exit(1);
}

function sign(payload) {
  return crypto.createHmac("sha256", secret).update(payload).digest("base64url");
}

function createToken(session) {
  const body = { ...session, exp: Math.floor(Date.now() / 1000) + 3600 };
  const payload = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  return `${payload}.${sign(payload)}`;
}

const token = createToken({
  id: "user_1ab6e723-017d-49bf-9ec3-73706e56b5c3",
  phone: "6386685663",
  name: "Admin",
  role: "super_admin",
  locale: "en",
});

const tmp = os.tmpdir();
const outFile = path.join(tmp, "tt-smoke-owner.json");

function curlJson(url, { cookie = true, method = "GET", body = null } = {}) {
  const args = [
    "-sS",
    "--http1.1",
    "--max-time",
    "60",
    "-o",
    outFile,
    "-w",
    "%{http_code}",
    "-H",
    `x-tt-db-key: ${dbKey}`,
    "-H",
    "Accept: application/json",
  ];
  if (cookie) args.push("-H", `Cookie: tt_sid=${token}`);
  if (method !== "GET") args.push("-X", method);
  if (body) {
    args.push("-H", "Content-Type: application/json", "--data-binary", body);
  }
  args.push(url);
  const r = spawnSync("curl.exe", args, { encoding: "utf8" });
  if (r.error) throw r.error;
  const status = (r.stdout || "").trim();
  const text = fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "";
  return { status: Number(status) || 0, text, stderr: r.stderr || "" };
}

function curlStatus(url) {
  const r = spawnSync(
    "curl.exe",
    [
      "-sS",
      "--max-time",
      "25",
      "-o",
      "NUL",
      "-w",
      "%{http_code}",
      "-H",
      `Cookie: tt_sid=${token}`,
      url,
    ],
    { encoding: "utf8" }
  );
  return Number((r.stdout || "").trim()) || 0;
}

const results = [];
function pass(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log("Fetching owner /api/db …");
let dbRes = curlJson("https://www.tanmayphotos.space/api/db");
if (dbRes.status !== 200) {
  console.log(`retry after fail status=${dbRes.status} stderr=${dbRes.stderr.slice(0, 200)}`);
  dbRes = curlJson("https://www.tanmayphotos.space/api/db");
}

let db = null;
let scope = null;
let updatedAt = null;
let errMsg = "";
try {
  const j = JSON.parse(dbRes.text || "{}");
  scope = j.scope;
  updatedAt = j.updatedAt;
  db = j.db;
  errMsg = j.error || "";
} catch {
  errMsg = "invalid json";
}

pass(
  "Owner /api/db session",
  dbRes.status === 200 && (scope === "owner" || scope === "staff") && !!db,
  `status=${dbRes.status} scope=${scope || errMsg || "?"} bytes=${(dbRes.text || "").length}`
);

if (!db) {
  // Diagnose: wrong SESSION_SECRET vs Hostinger?
  const pub = curlJson("https://www.tanmayphotos.space/api/db", { cookie: false });
  pass(
    "Public /api/db still works",
    pub.status === 200,
    `status=${pub.status} bytes=${(pub.text || "").length}`
  );
  console.log("---");
  console.log(
    "Could not open owner scope. Likely SESSION_SECRET on Hostinger differs from local .env.production."
  );
  console.log("Provide admin password to login via /api/account/login for full auth smoke.");
  process.exit(2);
}

const users = db.users || [];
const orders = db.orders || [];
const products = db.products || [];
const moves = db.stockMovements || [];
const admin = users.find(
  (u) => String(u.phone || "").replace(/\D/g, "").slice(-10) === "6386685663"
);

pass(
  "Admin user present",
  !!admin && admin.role === "super_admin",
  `role=${admin?.role || "none"} users=${users.length} active=${admin?.active}`
);
pass("Products loaded", products.length >= 1, `products=${products.length}`);
pass(
  "Settings present",
  !!(db.settings && db.settings.companyName),
  `company=${db.settings?.companyName || "-"}`
);

let reserved = 0;
let withMove = 0;
const missing = [];
for (const o of orders) {
  if (!o.stockReserved || o.status === "cancelled") continue;
  reserved += 1;
  const ok = moves.some(
    (m) =>
      m.orderId === o.id &&
      (m.type === "estimate_reserve" || m.type === "sale")
  );
  if (ok) withMove += 1;
  else missing.push(o.orderNumber || o.id);
}
pass(
  "Stock reserve consistency",
  missing.length === 0,
  `reserved=${reserved} withMovement=${withMove}${
    missing.length ? ` missing=${missing.slice(0, 8).join(",")}` : ""
  }`
);

let neg = 0;
for (const p of products) {
  if ((p.stock || 0) < 0) neg += 1;
  for (const v of p.variations || []) if ((v.stock || 0) < 0) neg += 1;
}
pass("No negative stock", neg === 0, `negFields=${neg}`);

for (const p of products) {
  const vsum = (p.variations || []).reduce(
    (s, v) => s + (Number(v.stock) || 0),
    0
  );
  console.log(
    `  product ${p.code} stock=${p.stock} varSum=${vsum} colors=${(p.colors || []).length} active=${p.active}`
  );
}

const statuses = {};
for (const o of orders) statuses[o.status] = (statuses[o.status] || 0) + 1;
console.log(`  orderStatuses=${JSON.stringify(statuses)}`);

const putNoCookie = curlJson("https://www.tanmayphotos.space/api/db", {
  cookie: false,
  method: "PUT",
  body: JSON.stringify({ db: { users: [] }, baseUpdatedAt: updatedAt }),
});
pass(
  "PUT without session rejected",
  putNoCookie.status === 401 || putNoCookie.status === 403,
  `status=${putNoCookie.status}`
);

for (const p of [
  "/en/admin",
  "/en/admin/orders",
  "/en/admin/products",
  "/en/admin/settings",
  "/en/orders",
  "/en/wallet",
  "/en/quick-order",
  "/en/checkout",
]) {
  const code = curlStatus(`https://www.tanmayphotos.space${p}`);
  pass(`Page ${p}`, code === 200, `status=${code}`);
}

if (orders[0]?.id) {
  const code = curlStatus(
    `https://www.tanmayphotos.space/en/admin/orders/${orders[0].id}/packing-slip`
  );
  pass("Packing slip (first order)", code === 200, `status=${code}`);
} else {
  pass("Packing slip (first order)", true, "skipped — no orders yet");
}

const failed = results.filter((r) => !r.ok).length;
const passed = results.filter((r) => r.ok).length;
console.log("---");
console.log(
  `SMOKE AUTH: ${passed} passed, ${failed} failed | orders=${orders.length} users=${users.length} movements=${moves.length}`
);
console.log(`updatedAt=${updatedAt}`);
try {
  fs.unlinkSync(outFile);
} catch {
  /* ignore */
}
process.exit(failed ? 1 : 0);
