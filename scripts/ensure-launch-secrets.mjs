/**
 * Create gitignored config/ops.cfg (CRON_SECRET + VAPID) if missing.
 * Never prints secret values.
 */
import webPush from "web-push";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { randomBytes } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const { generateVAPIDKeys } = webPush;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const opsPath = join(root, "config", "ops.cfg");

function parseCfg(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed
      .slice(eq + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
  return out;
}

function readEnvKey(name) {
  for (const fname of [".env.local", ".env.production"]) {
    const p = join(root, fname);
    if (!existsSync(p)) continue;
    const parsed = parseCfg(readFileSync(p, "utf8"));
    if (parsed[name]) return parsed[name];
  }
  return (process.env[name] || "").trim();
}

mkdirSync(join(root, "config"), { recursive: true });
const existing = existsSync(opsPath) ? parseCfg(readFileSync(opsPath, "utf8")) : {};

const cron =
  existing.CRON_SECRET ||
  readEnvKey("CRON_SECRET") ||
  randomBytes(24).toString("hex");

const pub =
  existing.NEXT_PUBLIC_VAPID_PUBLIC_KEY ||
  readEnvKey("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
const priv = existing.VAPID_PRIVATE_KEY || readEnvKey("VAPID_PRIVATE_KEY");
const subject =
  existing.VAPID_SUBJECT ||
  readEnvKey("VAPID_SUBJECT") ||
  "mailto:admin@ttenterprises.shop";

let vapidPub = pub;
let vapidPriv = priv;
if (!vapidPub || !vapidPriv) {
  const keys = generateVAPIDKeys();
  vapidPub = keys.publicKey;
  vapidPriv = keys.privateKey;
}

const body = [
  "# Generated locally. Never commit. Injected into the Hostinger zip.",
  `CRON_SECRET=${cron}`,
  `NEXT_PUBLIC_VAPID_PUBLIC_KEY=${vapidPub}`,
  `VAPID_PRIVATE_KEY=${vapidPriv}`,
  `VAPID_SUBJECT=${subject}`,
  "",
].join("\n");

writeFileSync(opsPath, body, { encoding: "utf8", mode: 0o600 });

const tmp = join(root, "tmp");
mkdirSync(tmp, { recursive: true });
writeFileSync(
  join(tmp, "cron-digest.cmd"),
  `curl -fsS "https://tanmayphotos.space/api/cron/whatsapp-digest?secret=${cron}"\n`,
  { encoding: "utf8", mode: 0o600 }
);
writeFileSync(
  join(tmp, "cron-reorder.cmd"),
  `curl -fsS "https://tanmayphotos.space/api/cron/reorder?secret=${cron}"\n`,
  { encoding: "utf8", mode: 0o600 }
);

console.log("ops.cfg", existsSync(opsPath) ? "READY" : "FAILED");
console.log("CRON_SECRET", cron ? "SET" : "MISSING");
console.log("VAPID", vapidPub && vapidPriv ? "SET" : "MISSING");
