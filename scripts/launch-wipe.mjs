/**
 * Launch wipe on live cloud: keep only phone 6386685663, clear everything else.
 * Prefer direct Supabase service-role write (bypasses merge that used to revive parties).
 * Run: node scripts/launch-wipe.mjs
 */
import crypto from "crypto";
import fs from "fs";
import { spawnSync } from "child_process";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const KEEP_PHONE = "6386685663";
const BASE = process.env.SMOKE_BASE || "https://www.tanmayphotos.space";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envProd = fs.readFileSync(path.join(root, ".env.production"), "utf8");
const vars = {};
for (const line of envProd.split(/\r?\n/)) {
  if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  vars[line.slice(0, i).trim()] = line
    .slice(i + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}
const DB_KEY = vars.DB_API_KEY;
const SESSION_SECRET = vars.SESSION_SECRET;
const SUPABASE_URL = vars.SUPABASE_URL || vars.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = vars.SUPABASE_SERVICE_ROLE_KEY;
const APP_DB_TABLE = vars.TT_APP_DB_TABLE || "tt_app_db";
const APP_DB_ROW_ID = vars.TT_APP_DB_ROW_ID || "main";

if (!DB_KEY || !SESSION_SECRET) {
  console.error("DB_API_KEY / SESSION_SECRET missing in .env.production");
  process.exit(1);
}

function normalizePhone(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  return d.length > 10 ? d.slice(-10) : d;
}

function phonesMatch(a, b) {
  return normalizePhone(a) === normalizePhone(b);
}

function forgeCookie(user) {
  const sess = {
    id: user.id,
    phone: normalizePhone(user.phone),
    name: user.name || "Admin",
    role: "super_admin",
    locale: "en",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
  const payload = Buffer.from(JSON.stringify(sess), "utf8").toString(
    "base64url"
  );
  const sig = crypto
    .createHmac("sha256", SESSION_SECRET)
    .update(payload)
    .digest("base64url");
  return `tt_sid=${payload}.${sig}`;
}

function curlJson(args) {
  const out = path.join(os.tmpdir(), `tt-launch-${Date.now()}.json`);
  const r = spawnSync(
    "curl.exe",
    [
      "-sS",
      "--http1.1",
      "--max-time",
      "120",
      "-o",
      out,
      "-w",
      "%{http_code}",
      ...args,
    ],
    { encoding: "utf8", maxBuffer: 40 * 1024 * 1024 }
  );
  const code = (r.stdout || "").trim();
  const body = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  try {
    fs.unlinkSync(out);
  } catch {
    /* ignore */
  }
  let json = null;
  try {
    json = body ? JSON.parse(body) : null;
  } catch {
    json = { raw: body?.slice(0, 500) };
  }
  return { code, json, stderr: r.stderr };
}

function launchWipe(db) {
  const want = normalizePhone(KEEP_PHONE);
  const kept = (db.users || []).filter((u) => phonesMatch(u.phone, want));
  if (!kept.length) {
    throw new Error(`No user with phone ${want} in cloud DB`);
  }
  const preferred =
    kept.find((u) => u.role === "super_admin") ||
    kept.find((u) => u.role !== "customer") ||
    kept[0];
  const keepUser = {
    ...preferred,
    role: "super_admin",
    active: true,
    approved: true,
    walletBalance: 0,
  };
  const purgeAt = new Date().toISOString();
  const removed = (db.users || []).filter((u) => u.id !== keepUser.id);
  const deletedUserAt = { ...(db.deletedUserAt || {}) };
  for (const u of removed) deletedUserAt[u.id] = purgeAt;
  delete deletedUserAt[keepUser.id];

  const next = {
    ...db,
    users: [keepUser],
    deletedUserIds: Object.keys(deletedUserAt),
    deletedUserAt,
    products: [],
    orders: [],
    schemes: [],
    walletTransactions: [],
    walletDeposits: [],
    vouchers: [],
    ledgerEntries: [],
    billAllocations: [],
    stockMovements: [],
    stockBatches: [],
    batchConsumptions: [],
    purchaseOrders: [],
    goodsReceipts: [],
    supplierContracts: [],
    tallyPosts: [],
    statementMatches: [],
    parties: [],
    categories: db.categories || [],
    shippingRules: db.shippingRules || [],
    settings: db.settings
      ? { ...db.settings, opsPurgeAt: purgeAt }
      : db.settings,
    accounts: db.accounts || [],
  };

  return {
    next,
    summary: {
      keptUser: {
        id: keepUser.id,
        phone: normalizePhone(keepUser.phone),
        name: keepUser.name,
        role: keepUser.role,
      },
      removedUsers: removed.length,
      removedOrders: (db.orders || []).length,
      removedProducts: (db.products || []).length,
      purgeAt,
    },
  };
}

function supabaseRest(method, pathSuffix, body) {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${pathSuffix}`;
  const args = [
    "-sS",
    "--http1.1",
    "--max-time",
    "120",
    "-X",
    method,
    "-H",
    `apikey: ${SERVICE_KEY}`,
    "-H",
    `Authorization: Bearer ${SERVICE_KEY}`,
    "-H",
    "Content-Type: application/json",
    "-H",
    "Prefer: return=representation",
  ];
  if (body != null) {
    args.push("-d", JSON.stringify(body));
  }
  args.push(url);
  return curlJson(args);
}

async function main() {
  let cookie = forgeCookie({
    id: "user_1ab6e723-017d-49bf-9ec3-73706e56b5c3",
    phone: KEEP_PHONE,
    name: "Admin",
  });

  console.log("1) GET cloud DB…");
  let get = curlJson([
    "-H",
    `x-tt-db-key: ${DB_KEY}`,
    "-H",
    `Cookie: ${cookie}`,
    `${BASE}/api/db`,
  ]);
  if (get.code !== "200") {
    console.error("GET failed", get.code, get.json);
    process.exit(1);
  }

  console.log("   before", {
    users: (get.json.db.users || []).length,
    orders: (get.json.db.orders || []).length,
    products: (get.json.db.products || []).length,
    parties: (get.json.db.parties || []).length,
  });

  const owner = (get.json.db.users || []).find((u) =>
    phonesMatch(u.phone, KEEP_PHONE)
  );
  if (!owner) {
    console.error("Owner phone not found in cloud");
    process.exit(1);
  }
  cookie = forgeCookie(owner);

  const { next, summary } = launchWipe(get.json.db);
  console.log("2) Wipe plan", summary);

  let wroteVia = "api";
  if (SERVICE_KEY && SUPABASE_URL) {
    console.log("3) Direct Supabase upsert (service role)…");
    const put = supabaseRest(
      "PATCH",
      `${APP_DB_TABLE}?id=eq.${encodeURIComponent(APP_DB_ROW_ID)}`,
      { db: next }
    );
    if (!put || put.code[0] !== "2") {
      console.error("Direct write failed", put?.code, put?.json);
      process.exit(1);
    }
    wroteVia = "supabase";
  } else {
    console.log("3) PUT via /api/db…");
    const put = curlJson([
      "-X",
      "PUT",
      "-H",
      "Content-Type: application/json",
      "-H",
      `x-tt-db-key: ${DB_KEY}`,
      "-H",
      `Cookie: ${cookie}`,
      "-d",
      JSON.stringify({ db: next, baseUpdatedAt: get.json.updatedAt }),
      `${BASE}/api/db`,
    ]);
    if (put.code !== "200") {
      console.error("PUT failed", put.code, put.json);
      process.exit(1);
    }
  }

  console.log("4) Verify GET…");
  cookie = forgeCookie(summary.keptUser);
  get = curlJson([
    "-H",
    `x-tt-db-key: ${DB_KEY}`,
    "-H",
    `Cookie: ${cookie}`,
    `${BASE}/api/db`,
  ]);
  if (get.code !== "200") {
    console.error("Verify GET failed", get.code, get.json);
    process.exit(1);
  }
  const db = get.json.db;
  const users = (db.users || []).map((u) => ({
    id: u.id,
    phone: u.phone,
    name: u.name,
    role: u.role,
  }));
  console.log(
    JSON.stringify(
      {
        ok: true,
        wroteVia,
        users,
        orders: (db.orders || []).length,
        products: (db.products || []).length,
        schemes: (db.schemes || []).length,
        vouchers: (db.vouchers || []).length,
        parties: (db.parties || []).length,
        opsPurgeAt: db.settings?.opsPurgeAt,
      },
      null,
      2
    )
  );
  if (users.length !== 1 || normalizePhone(users[0].phone) !== KEEP_PHONE) {
    console.error("Verify failed — unexpected users");
    process.exit(1);
  }
  if ((db.parties || []).length > 0 || (db.products || []).length > 0) {
    console.error("Verify failed — parties/products still present");
    process.exit(1);
  }
  console.log("Launch wipe complete. Hard-refresh all browsers.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
