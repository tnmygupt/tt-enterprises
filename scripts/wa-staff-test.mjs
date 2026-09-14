/**
 * One-shot Tally WhatsApp connectivity check. Does not print secrets.
 * Usage: node scripts/wa-staff-test.mjs
 */
import { existsSync, readFileSync } from "fs";
import { join } from "path";

function parseKeyFile(raw) {
  const out = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key === "TALLY_WA_INSTANCE_KEY") out.instance = val;
    if (key === "TALLY_WA_ACCESS_TOKEN") out.token = val;
    if (key === "TALLY_WA_BASE_URL") out.base = val;
  }
  return out;
}

function loadSecrets() {
  const fromEnv = {
    instance: (process.env.TALLY_WA_INSTANCE_KEY || "").trim(),
    token: (process.env.TALLY_WA_ACCESS_TOKEN || "").trim(),
    base: (process.env.TALLY_WA_BASE_URL || "").trim(),
  };
  const files = [
    join(process.cwd(), "config", "tally-wa.cfg"),
    join(process.cwd(), ".env.local"),
    join(process.cwd(), ".env.production"),
  ];
  let fromFile = {};
  for (const path of files) {
    if (!existsSync(path)) continue;
    fromFile = parseKeyFile(readFileSync(path, "utf8"));
    if (fromFile.instance) break;
  }
  const instance = fromEnv.instance || fromFile.instance || "";
  const token = fromEnv.token || fromFile.token || instance;
  const base = (
    fromEnv.base ||
    fromFile.base ||
    "https://app.tallywebsolutions.in"
  ).replace(/\/$/, "");
  return { instance: Boolean(instance), token, base };
}

async function sendText(base, token, phone, message) {
  const params = new URLSearchParams({ token, phone, message });
  const url = `${base}/api/sendText?${params.toString()}`;
  const res = await fetch(url, { method: "POST" });
  const raw = await res.text();
  return { status: res.status, raw: raw.slice(0, 180) };
}

async function main() {
  const secrets = loadSecrets();
  if (!secrets.instance || !secrets.token) {
    console.log("RESULT=not_configured");
    process.exit(1);
  }
  const phones = process.argv.slice(2);
  if (!phones.length) {
    console.log("USAGE=node scripts/wa-staff-test.mjs 91XXXXXXXXXX");
    process.exit(1);
  }
  const text =
    "T T Enterprises — WhatsApp staff alerts are ON. This is a test.";
  for (const rawPhone of phones) {
    const phone = rawPhone.replace(/\D/g, "");
    const result = await sendText(secrets.base, secrets.token, phone, text);
    const ok = result.status >= 200 && result.status < 300;
    console.log(`PHONE=${phone.slice(-4)} HTTP=${result.status} OK=${ok}`);
  }
}

main().catch((err) => {
  console.log("RESULT=error", err instanceof Error ? err.message : "fail");
  process.exit(1);
});
