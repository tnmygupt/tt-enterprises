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

const body = {
  id: "user_1ab6e723-017d-49bf-9ec3-73706e56b5c3",
  phone: "6386685663",
  name: "Admin",
  role: "super_admin",
  locale: "en",
  exp: Math.floor(Date.now() / 1000) + 3600,
};
const payload = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
const sig = crypto
  .createHmac("sha256", secret)
  .update(payload)
  .digest("base64url");
const token = `${payload}.${sig}`;
const tmp = os.tmpdir();
const outFile = path.join(tmp, "tt-smoke-full.json");
const BASE = "https://www.tanmayphotos.space";

const results = [];
function pass(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function curl(args) {
  const r = spawnSync("curl.exe", args, {
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return {
    code: Number((r.stdout || "").trim()) || 0,
    stderr: r.stderr || "",
    text: fs.existsSync(outFile) ? fs.readFileSync(outFile, "utf8") : "",
  };
}

function httpGet(urlPath, { cookie = false, toFile = false } = {}) {
  const args = [
    "-sS",
    "--http1.1",
    "--max-time",
    "45",
    "-o",
    toFile ? outFile : "NUL",
    "-w",
    "%{http_code}",
  ];
  if (cookie) args.push("-H", `Cookie: tt_sid=${token}`);
  if (toFile) {
    args.push("-H", `x-tt-db-key: ${dbKey}`, "-H", "Accept: application/json");
  }
  args.push(`${BASE}${urlPath}`);
  return curl(args);
}

console.log("=== A) Public pages ===");
for (const p of [
  "/en",
  "/hi",
  "/en/login",
  "/en/register",
  "/en/catalog",
  "/en/price-list",
  "/en/quick-order",
  "/en/schemes",
  "/en/checkout",
  "/en/orders",
  "/en/wallet",
  "/en/admin",
  "/en/admin/orders",
  "/en/admin/products",
  "/en/admin/settings",
]) {
  const r = httpGet(p);
  pass(`Page ${p}`, r.code === 200, `status=${r.code}`);
}

console.log("=== B) Apex / DNS ===");
for (const u of [
  "https://www.tanmayphotos.space/en",
  "https://tanmayphotos.space/en",
]) {
  const r = spawnSync(
    "curl.exe",
    ["-sS", "--max-time", "25", "-o", "NUL", "-w", "%{http_code}", u],
    { encoding: "utf8" }
  );
  const code = Number((r.stdout || "").trim()) || 0;
  pass(`URL ${u.replace("https://", "")}`, code === 200, `status=${code}`);
}

console.log("=== C) API guards ===");
{
  const noKey = spawnSync(
    "curl.exe",
    [
      "-sS",
      "--max-time",
      "20",
      "-o",
      outFile,
      "-w",
      "%{http_code}",
      `${BASE}/api/db`,
    ],
    { encoding: "utf8" }
  );
  pass(
    "/api/db without key",
    Number(noKey.stdout) === 401,
    `status=${(noKey.stdout || "").trim()}`
  );
}
{
  const bad = spawnSync(
    "curl.exe",
    [
      "-sS",
      "--max-time",
      "20",
      "-o",
      outFile,
      "-w",
      "%{http_code}",
      "-X",
      "POST",
      "-H",
      "Content-Type: application/json",
      "--data-binary",
      JSON.stringify({ phone: "6386685663", password: "wrong-" + Date.now() }),
      `${BASE}/api/account/login`,
    ],
    { encoding: "utf8" }
  );
  pass(
    "Login rejects bad password",
    Number(bad.stdout) === 401,
    `status=${(bad.stdout || "").trim()}`
  );
}
{
  const put = spawnSync(
    "curl.exe",
    [
      "-sS",
      "--max-time",
      "20",
      "-o",
      outFile,
      "-w",
      "%{http_code}",
      "-X",
      "PUT",
      "-H",
      `x-tt-db-key: ${dbKey}`,
      "-H",
      "Content-Type: application/json",
      "--data-binary",
      JSON.stringify({ db: { users: [] } }),
      `${BASE}/api/db`,
    ],
    { encoding: "utf8" }
  );
  const code = Number((put.stdout || "").trim()) || 0;
  pass(
    "PUT /api/db without session rejected",
    code === 401 || code === 403,
    `status=${code}`
  );
}

console.log("=== D) Owner authenticated DB ===");
const owner = httpGet("/api/db", { cookie: true, toFile: true });
let db = null;
let scope = null;
let updatedAt = null;
try {
  const j = JSON.parse(owner.text || "{}");
  scope = j.scope;
  updatedAt = j.updatedAt;
  db = j.db;
} catch {
  /* ignore */
}
pass(
  "Owner /api/db",
  owner.code === 200 && scope === "owner" && !!db,
  `status=${owner.code} scope=${scope} bytes=${(owner.text || "").length}`
);

if (!db) {
  console.log("--- abort: no owner db ---");
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
  "Admin user",
  !!admin && admin.role === "super_admin" && admin.active !== false,
  `role=${admin?.role} users=${users.length}`
);
pass(
  "Order history cleared",
  orders.length === 0,
  `orders=${orders.length}`
);
pass(
  "opsPurgeAt set",
  !!(db.settings && db.settings.opsPurgeAt),
  `opsPurgeAt=${db.settings?.opsPurgeAt || "(none)"}`
);
pass("Products kept", products.length >= 1, `products=${products.length}`);
pass(
  "Settings company",
  db.settings?.companyName === "T T Enterprises" ||
    !!db.settings?.companyName,
  `company=${db.settings?.companyName || "-"}`
);

let neg = 0;
for (const p of products) {
  if ((p.stock || 0) < 0) neg += 1;
  for (const v of p.variations || []) if ((v.stock || 0) < 0) neg += 1;
}
pass("No negative stock", neg === 0, `negFields=${neg}`);

let reservedMissing = 0;
for (const o of orders) {
  if (!o.stockReserved || o.status === "cancelled") continue;
  const ok = moves.some(
    (m) =>
      m.orderId === o.id &&
      (m.type === "estimate_reserve" || m.type === "sale")
  );
  if (!ok) reservedMissing += 1;
}
pass(
  "Stock reserve consistency",
  reservedMissing === 0,
  `orders=${orders.length} missingMoves=${reservedMissing} movements=${moves.length}`
);

for (const p of products) {
  const vsum = (p.variations || []).reduce(
    (s, v) => s + (Number(v.stock) || 0),
    0
  );
  console.log(
    `  product ${p.code} stock=${p.stock} varSum=${vsum} colors=${(p.colors || []).length} active=${p.active}`
  );
}

console.log("=== E) Public catalog ===");
const pub = curl([
  "-sS",
  "--http1.1",
  "--max-time",
  "45",
  "-o",
  outFile,
  "-w",
  "%{http_code}",
  "-H",
  `x-tt-db-key: ${dbKey}`,
  `${BASE}/api/db`,
]);
let pubDb = null;
try {
  pubDb = JSON.parse(pub.text || "{}").db;
} catch {
  /* ignore */
}
pass(
  "Public catalog",
  pub.code === 200 && !!pubDb,
  `status=${pub.code} products=${(pubDb?.products || []).length} users=${(pubDb?.users || []).length} orders=${(pubDb?.orders || []).length}`
);
pass(
  "Public hides users/orders",
  !!pubDb &&
    (pubDb.users || []).length === 0 &&
    (pubDb.orders || []).length === 0,
  `users=${(pubDb?.users || []).length} orders=${(pubDb?.orders || []).length}`
);

console.log("=== F) Authenticated shells ===");
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
  const r = httpGet(p, { cookie: true });
  pass(`Auth page ${p}`, r.code === 200, `status=${r.code}`);
}

console.log("=== G) Stage tracker assets (order page shell) ===");
{
  // No orders — packing-slip with fake id should still render Next shell
  const r = httpGet("/en/admin/orders/smoke-test/packing-slip", {
    cookie: true,
  });
  pass(
    "Packing slip shell",
    r.code === 200,
    `status=${r.code}`
  );
}

// HTML marker check on home
{
  const r = spawnSync(
    "curl.exe",
    ["-sS", "--max-time", "25", `${BASE}/en`],
    { encoding: "utf8", maxBuffer: 5 * 1024 * 1024 }
  );
  const html = r.stdout || "";
  pass(
    "Home has Next + brand",
    /_next/.test(html) && /TT Enterprises|T T Enterprises/i.test(html),
    `len=${html.length}`
  );
}

const failed = results.filter((r) => !r.ok).length;
const passed = results.filter((r) => r.ok).length;
console.log("---");
console.log(
  `SMOKE FULL: ${passed} passed, ${failed} failed | orders=${orders.length} users=${users.length} products=${products.length}`
);
console.log(`updatedAt=${updatedAt}`);
try {
  fs.unlinkSync(outFile);
} catch {
  /* ignore */
}
process.exit(failed ? 1 : 0);
