import crypto from "crypto";
import fs from "fs";
import { spawnSync } from "child_process";
import os from "os";
import path from "path";
import { pathToFileURL } from "url";

// Load purge helper via dynamic import of compiled path — inline clear instead
function clearOrderHistoryKeepUsers(db) {
  const beforeOrders = (db.orders || []).length;
  const purgeAt = new Date().toISOString();
  return {
    db: {
      ...db,
      orders: [],
      walletTransactions: (db.walletTransactions || []).filter((t) => !t.orderId),
      stockMovements: (db.stockMovements || []).filter((m) => !m.orderId),
      tallyPosts: [],
      billAllocations: [],
      settings: db.settings
        ? { ...db.settings, opsPurgeAt: purgeAt }
        : db.settings,
    },
    removedOrders: beforeOrders,
    purgeAt,
  };
}

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
const sess = {
  id: "user_1ab6e723-017d-49bf-9ec3-73706e56b5c3",
  phone: "6386685663",
  name: "Admin",
  role: "super_admin",
  locale: "en",
  exp: Math.floor(Date.now() / 1000) + 3600,
};
const payload = Buffer.from(JSON.stringify(sess), "utf8").toString("base64url");
const sig = crypto.createHmac("sha256", secret).update(payload).digest("base64url");
const token = `${payload}.${sig}`;
const tmp = os.tmpdir();
const getFile = path.join(tmp, "tt-clear-get.json");
const putFile = path.join(tmp, "tt-clear-put.json");

function curl(args) {
  const r = spawnSync("curl.exe", args, {
    encoding: "utf8",
    maxBuffer: 30 * 1024 * 1024,
  });
  if (r.error) throw r.error;
  return { code: (r.stdout || "").trim(), stderr: r.stderr || "" };
}

console.log("GET…");
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
  console.log("GET fail", got.code, got.stderr.slice(0, 200));
  process.exit(1);
}
const j = JSON.parse(fs.readFileSync(getFile, "utf8"));
const { db: next, removedOrders, purgeAt } = clearOrderHistoryKeepUsers(j.db);
console.log(
  `clearing ${removedOrders} orders; users=${(next.users || []).length} products=${(next.products || []).length} opsPurgeAt=${purgeAt}`
);
fs.writeFileSync(putFile, JSON.stringify({ db: next, baseUpdatedAt: j.updatedAt }));
console.log("PUT…");
const put = curl([
  "-sS",
  "--http1.1",
  "--max-time",
  "120",
  "-o",
  path.join(tmp, "tt-clear-put-resp.json"),
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
console.log("PUT", put.code);
if (put.code !== "200") {
  console.log(fs.readFileSync(path.join(tmp, "tt-clear-put-resp.json"), "utf8").slice(0, 400));
  process.exit(1);
}

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
const after = JSON.parse(fs.readFileSync(getFile, "utf8")).db;
console.log(
  `AFTER orders=${(after.orders || []).length} users=${(after.users || []).length} products=${(after.products || []).length} opsPurgeAt=${after.settings?.opsPurgeAt}`
);
if ((after.orders || []).length !== 0) {
  console.log("FAIL still has orders");
  process.exit(1);
}
console.log("CLEAR_OK");
void pathToFileURL;
