/**
 * Launch wipe on live cloud: keep catalog items/stock. Clears orders,
 * wallets, vouchers, parties, books history.
 * Default: keep owner login(s) only (drops dealers).
 * --keep-all-users: keep every login (roles unchanged), zero wallets.
 * Prefer direct Supabase service-role write (bypasses merge that used to revive parties).
 * Run: node scripts/launch-wipe.mjs
 *      node scripts/launch-wipe.mjs --keep-all-users
 */
import crypto from "crypto";
import fs from "fs";
import { spawnSync } from "child_process";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const KEEP_PHONE = "6386685663";
const KEEP_ALL_USERS =
  process.argv.includes("--keep-all-users") ||
  process.env.KEEP_ALL_USERS === "1";
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
const APP_DB_TABLE = vars.TT_APP_DB_TABLE || "app_database";
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

function resetWallet(u) {
  return {
    ...u,
    walletBalance: 0,
    liftingProgressKg: 0,
    schemeProgress: {},
  };
}

function launchWipe(db) {
  const want = normalizePhone(KEEP_PHONE);
  const confirmed = (db.users || []).filter((u) => phonesMatch(u.phone, want));
  if (!confirmed.length) {
    throw new Error("No matching owner phone in cloud DB");
  }
  const keepIds = new Set();
  const keepUsers = [];
  const addKeep = (u, asOwner) => {
    if (keepIds.has(u.id)) return;
    keepIds.add(u.id);
    keepUsers.push(
      asOwner
        ? {
            ...resetWallet(u),
            role: "super_admin",
            active: true,
            approved: true,
          }
        : resetWallet(u)
    );
  };

  if (KEEP_ALL_USERS) {
    for (const u of db.users || []) addKeep(u, false);
  } else {
    const preferred =
      confirmed.find((u) => u.role === "super_admin") ||
      confirmed.find((u) => u.role !== "customer") ||
      confirmed[0];
    addKeep(preferred, true);
    for (const u of db.users || []) {
      if (u.role === "super_admin") addKeep(u, true);
    }
  }

  const purgeAt = new Date().toISOString();
  const removed = (db.users || []).filter((u) => !keepIds.has(u.id));
  const deletedUserAt = { ...(db.deletedUserAt || {}) };
  if (!KEEP_ALL_USERS) {
    for (const u of removed) deletedUserAt[u.id] = purgeAt;
  }
  for (const id of keepIds) delete deletedUserAt[id];

  const products = structuredClone(db.products || []);
  const next = {
    ...db,
    users: keepUsers,
    deletedUserIds: Object.keys(deletedUserAt),
    deletedUserAt,
    products,
    orders: [],
    schemes: db.schemes || [],
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
    bankRecons: [],
    accessPlaces: [],
    peopleActivity: [],
    waInbox: { messages: [], reads: [] },
    parties: [],
    categories: db.categories || [],
    shippingRules: db.shippingRules || [],
    settings: db.settings
      ? {
          ...db.settings,
          opsPurgeAt: purgeAt,
          whatsappDigest: {},
          tallyLastSyncAt: undefined,
          tallySyncStatus: "idle",
          tallySyncMessage: undefined,
        }
      : db.settings,
    accounts: db.accounts || [],
  };

  return {
    next,
    summary: {
      keptUsers: keepUsers.length,
      keptUserIds: keepUsers.map((u) => u.id),
      keptUser: {
        id: keepUsers[0].id,
        phone: normalizePhone(keepUsers[0].phone),
        name: keepUsers[0].name,
        role: keepUsers[0].role,
      },
      keepAllUsers: KEEP_ALL_USERS,
      removedUsers: removed.length,
      removedOrders: (db.orders || []).length,
      keptProducts: products.length,
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

function readCloudDb() {
  if (SERVICE_KEY && SUPABASE_URL) {
    const got = supabaseRest(
      "GET",
      `${APP_DB_TABLE}?id=eq.${encodeURIComponent(APP_DB_ROW_ID)}&select=db,updated_at`
    );
    if (got && got.code[0] === "2") {
      const row = Array.isArray(got.json) ? got.json[0] : got.json;
      if (row?.db) return { db: row.db, updatedAt: row.updated_at, via: "supabase" };
    }
    console.error("Supabase GET failed", got?.code);
  }
  const cookie = forgeCookie({
    id: "user_1ab6e723-017d-49bf-9ec3-73706e56b5c3",
    phone: KEEP_PHONE,
    name: "Admin",
  });
  const get = curlJson([
    "-H",
    `x-tt-db-key: ${DB_KEY}`,
    "-H",
    `Cookie: ${cookie}`,
    `${BASE}/api/db`,
  ]);
  if (get.code !== "200" || !get.json?.db) {
    console.error("GET failed", get.code, get.json);
    process.exit(1);
  }
  return { db: get.json.db, updatedAt: get.json.updatedAt, via: "api" };
}

async function main() {
  console.log("1) GET cloud DB…");
  const cloud = readCloudDb();

  console.log("   before", {
    via: cloud.via,
    users: (cloud.db.users || []).length,
    orders: (cloud.db.orders || []).length,
    products: (cloud.db.products || []).length,
    parties: (cloud.db.parties || []).length,
  });

  const owner = (cloud.db.users || []).find((u) =>
    phonesMatch(u.phone, KEEP_PHONE)
  );
  if (!owner) {
    console.error("Owner phone not found in cloud");
    process.exit(1);
  }

  const { next, summary } = launchWipe(cloud.db);
  console.log("2) Wipe plan", {
    keepAllUsers: KEEP_ALL_USERS,
    keptUsers: summary.keptUsers,
    removedUsers: summary.removedUsers,
    removedOrders: summary.removedOrders,
    keptProducts: summary.keptProducts,
    purgeAt: summary.purgeAt,
  });

  let wroteVia = "api";
  if (SERVICE_KEY && SUPABASE_URL) {
    console.log("3) Direct Supabase upsert (service role)…");
    const put = supabaseRest(
      "PATCH",
      `${APP_DB_TABLE}?id=eq.${encodeURIComponent(APP_DB_ROW_ID)}`,
      { db: next, updated_at: new Date().toISOString() }
    );
    if (!put || put.code[0] !== "2") {
      console.error("Direct write failed", put?.code);
      process.exit(1);
    }
    wroteVia = "supabase";
  } else {
    console.log("3) PUT via /api/db…");
    const cookie = forgeCookie(owner);
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
      JSON.stringify({ db: next, baseUpdatedAt: cloud.updatedAt }),
      `${BASE}/api/db`,
    ]);
    if (put.code !== "200") {
      console.error("PUT failed", put.code);
      process.exit(1);
    }
  }

  console.log("4) Verify GET…");
  const verified = readCloudDb();
  const db = verified.db;
  const owners = (db.users || []).filter((u) => u.role === "super_admin");
  const afterProducts = (db.products || []).length;
  console.log(
    JSON.stringify(
      {
        ok: true,
        wroteVia,
        keepAllUsers: KEEP_ALL_USERS,
        keptOwners: owners.length,
        users: (db.users || []).length,
        dealers: (db.users || []).filter((u) => u.role === "customer").length,
        orders: (db.orders || []).length,
        products: afterProducts,
        schemes: (db.schemes || []).length,
        vouchers: (db.vouchers || []).length,
        parties: (db.parties || []).length,
        opsPurgeAt: db.settings?.opsPurgeAt,
      },
      null,
      2
    )
  );
  if (
    owners.length < 1 ||
    !owners.some((u) => phonesMatch(u.phone, KEEP_PHONE))
  ) {
    console.error("Verify failed — owner login missing");
    process.exit(1);
  }
  if (
    !KEEP_ALL_USERS &&
    (db.users || []).some((u) => u.role === "customer")
  ) {
    console.error("Verify failed — dealer logins still present");
    process.exit(1);
  }
  if (KEEP_ALL_USERS && (db.users || []).length !== summary.keptUsers) {
    console.error("Verify failed — user count changed");
    process.exit(1);
  }
  if (
    (db.parties || []).length > 0 ||
    (db.orders || []).length > 0 ||
    (db.vouchers || []).length > 0
  ) {
    console.error("Verify failed — ops rows still present");
    process.exit(1);
  }
  if (afterProducts !== summary.keptProducts) {
    console.error("Verify failed — catalog stock/items not kept");
    process.exit(1);
  }
  console.log("Launch wipe complete. Hard-refresh all browsers.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
