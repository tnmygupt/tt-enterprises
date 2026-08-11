import crypto from "crypto";
import fs from "fs";
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
const body = {
  id: "user_1ab6e723-017d-49bf-9ec3-73706e56b5c3",
  phone: "6386685663",
  name: "Admin",
  role: "super_admin",
  locale: "en",
  exp: Math.floor(Date.now() / 1000) + 3600,
};
const payload = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
const token = `${payload}.${sig}`;

const tmp = os.tmpdir();
const getFile = path.join(tmp, "tt-repair-get.json");
const putFile = path.join(tmp, "tt-repair-put.json");

function curl(args) {
  const r = spawnSync("curl.exe", args, { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
  if (r.error) throw r.error;
  return { code: (r.stdout || "").trim(), stderr: r.stderr || "" };
}

console.log("GET owner db…");
let got = curl([
  "-sS",
  "--http1.1",
  "--max-time",
  "90",
  "-o",
  getFile,
  "-w",
  "%{http_code}",
  "-H",
  `x-tt-db-key: ${dbKey}`,
  "-H",
  `Cookie: tt_sid=${token}`,
  "https://www.tanmayphotos.space/api/db",
]);
if (got.code !== "200") {
  console.log("GET failed", got.code, got.stderr.slice(0, 200));
  process.exit(1);
}

const j = JSON.parse(fs.readFileSync(getFile, "utf8"));
const db = j.db;
const updatedAt = j.updatedAt;
if (!db) {
  console.log("No db");
  process.exit(1);
}

const before = {
  reserved: 0,
  withMove: 0,
  stock: Object.fromEntries(
    (db.products || []).map((p) => [p.code, p.stock])
  ),
};
for (const o of db.orders || []) {
  if (!o.stockReserved || o.status === "cancelled") continue;
  before.reserved += 1;
  if (
    (db.stockMovements || []).some(
      (m) =>
        m.orderId === o.id &&
        (m.type === "estimate_reserve" || m.type === "sale")
    )
  ) {
    before.withMove += 1;
  }
}
console.log(
  `before reserved=${before.reserved} withMove=${before.withMove} stock=${JSON.stringify(before.stock)}`
);

const putBody = JSON.stringify({ db, baseUpdatedAt: updatedAt });
fs.writeFileSync(putFile, putBody);
console.log(`PUT reconcile (${putBody.length} bytes)…`);
const put = curl([
  "-sS",
  "--http1.1",
  "--max-time",
  "120",
  "-o",
  path.join(tmp, "tt-repair-put-resp.json"),
  "-w",
  "%{http_code}",
  "-X",
  "PUT",
  "-H",
  `x-tt-db-key: ${dbKey}`,
  "-H",
  `Cookie: tt_sid=${token}`,
  "-H",
  "Content-Type: application/json",
  "--data-binary",
  `@${putFile}`,
  "https://www.tanmayphotos.space/api/db",
]);
console.log(`PUT status=${put.code}`);
if (put.code !== "200") {
  const resp = fs.readFileSync(path.join(tmp, "tt-repair-put-resp.json"), "utf8");
  console.log(resp.slice(0, 400));
  process.exit(1);
}

console.log("GET after…");
got = curl([
  "-sS",
  "--http1.1",
  "--max-time",
  "90",
  "-o",
  getFile,
  "-w",
  "%{http_code}",
  "-H",
  `x-tt-db-key: ${dbKey}`,
  "-H",
  `Cookie: tt_sid=${token}`,
  "https://www.tanmayphotos.space/api/db",
]);
const afterJ = JSON.parse(fs.readFileSync(getFile, "utf8"));
const after = afterJ.db;
let reserved = 0;
let withMove = 0;
const missing = [];
for (const o of after.orders || []) {
  if (!o.stockReserved || o.status === "cancelled") continue;
  reserved += 1;
  const ok = (after.stockMovements || []).some(
    (m) =>
      m.orderId === o.id &&
      (m.type === "estimate_reserve" || m.type === "sale")
  );
  if (ok) withMove += 1;
  else missing.push(o.orderNumber || o.id);
}
const stock = Object.fromEntries(
  (after.products || []).map((p) => [p.code, p.stock])
);
console.log(
  `after reserved=${reserved} withMove=${withMove} missing=${missing.length} stock=${JSON.stringify(stock)} movements=${(after.stockMovements || []).length}`
);
if (missing.length) {
  console.log("still missing:", missing.join(", "));
  process.exit(1);
}
console.log("REPAIR_OK");
