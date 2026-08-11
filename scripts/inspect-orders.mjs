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
const out = path.join(os.tmpdir(), "tt-inspect.json");
const r = spawnSync(
  "curl.exe",
  [
    "-sS",
    "--http1.1",
    "--max-time",
    "60",
    "-o",
    out,
    "-w",
    "%{http_code}",
    "-H",
    `x-tt-db-key: ${dbKey}`,
    "-H",
    `Cookie: tt_sid=${token}`,
    "https://www.tanmayphotos.space/api/db",
  ],
  { encoding: "utf8" }
);
const j = JSON.parse(fs.readFileSync(out, "utf8"));
const db = j.db;
console.log("orders", (db.orders || []).length);
console.log("opsPurgeAt", db.settings?.opsPurgeAt || "(none)");
console.log("updatedAt", j.updatedAt);
const sample = (db.orders || []).slice(0, 3).map((o) => ({
  no: o.orderNumber,
  status: o.status,
  timelineLen: (o.timeline || []).length,
  timeline: (o.timeline || []).map((t) => t.status),
}));
console.log(JSON.stringify(sample, null, 2));
