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
const sess = {
  id: "user_1ab6e723-017d-49bf-9ec3-73706e56b5c3",
  phone: "6386685663",
  name: "Admin",
  role: "super_admin",
  locale: "en",
  exp: Math.floor(Date.now() / 1000) + 3600,
};
const payload = Buffer.from(JSON.stringify(sess), "utf8").toString("base64url");
const sig = crypto
  .createHmac("sha256", vars.SESSION_SECRET)
  .update(payload)
  .digest("base64url");
const token = `${payload}.${sig}`;
const out = path.join(os.tmpdir(), "tt-users-live.json");
const r = spawnSync(
  "curl.exe",
  [
    "-sS",
    "--http1.1",
    "--max-time",
    "90",
    "-o",
    out,
    "-w",
    "%{http_code}",
    "-H",
    `x-tt-db-key: ${vars.DB_API_KEY}`,
    "-H",
    `Cookie: tt_sid=${token}`,
    "https://www.tanmayphotos.space/api/db",
  ],
  { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 }
);
const code = (r.stdout || "").trim();
if (code !== "200") {
  console.error("GET failed", code, r.stderr);
  process.exit(1);
}
const j = JSON.parse(fs.readFileSync(out, "utf8"));
const users = (j.db.users || []).map((u) => ({
  id: u.id,
  name: u.name,
  role: u.role,
  active: u.active,
  phone: u.phone,
}));
console.log(
  JSON.stringify(
    {
      userCount: users.length,
      users,
      deletedUserIds: j.db.deletedUserIds || [],
    },
    null,
    2
  )
);
