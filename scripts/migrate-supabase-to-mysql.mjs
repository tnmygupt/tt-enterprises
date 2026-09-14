/**
 * One-shot: copy public.app_database id=main from Supabase REST into Hostinger MySQL.
 * Uses .env.production. Does not print secrets.
 *
 * Run: node scripts/migrate-supabase-to-mysql.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vars = {};
for (const fname of [".env.production", ".env.local"]) {
  const p = path.join(root, fname);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    const k = line.slice(0, i).trim();
    if (vars[k]) continue;
    vars[k] = line
      .slice(i + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");
  }
}

const TABLES = [
  ["users", "users"],
  ["products", "products"],
  ["orders", "orders"],
  ["schemes", "schemes"],
  ["walletTransactions", "wallet_transactions"],
  ["walletDeposits", "wallet_deposits"],
  ["shippingRules", "shipping_rules"],
  ["categories", "categories"],
  ["accounts", "accounts"],
  ["parties", "parties"],
  ["vouchers", "vouchers"],
  ["ledgerEntries", "ledger_entries"],
  ["stockMovements", "stock_movements"],
  ["stockBatches", "stock_batches"],
  ["batchConsumptions", "batch_consumptions"],
  ["billAllocations", "bill_allocations"],
  ["purchaseOrders", "purchase_orders"],
  ["goodsReceipts", "goods_receipts"],
  ["supplierContracts", "supplier_contracts"],
  ["tallyPosts", "tally_posts"],
  ["statementMatches", "statement_matches"],
  ["bankRecons", "bank_recons"],
  ["accessPlaces", "access_places"],
  ["staffJobs", "staff_jobs"],
  ["peopleActivity", "people_activity"],
  ["hrTerms", "hr_terms"],
  ["hrShifts", "hr_shifts"],
  ["hrSites", "hr_sites"],
  ["hrPunches", "hr_punches"],
  ["hrLeaves", "hr_leaves"],
  ["hrAdvances", "hr_advances"],
  ["hrPayslips", "hr_payslips"],
  ["stockCounts", "stock_counts"],
  ["cashCounts", "cash_counts"],
  ["monthlyAudits", "monthly_audits"],
];

function rowId(item, fallback) {
  const id = String(item?.id || "").trim();
  return (id || fallback).slice(0, 64);
}

const dumpPath = path.join(root, "tmp", "supabase-main.json");
let db;
let updatedAt;
if (fs.existsSync(dumpPath)) {
  const dumped = JSON.parse(fs.readFileSync(dumpPath, "utf8"));
  db = dumped.db || dumped;
  updatedAt = dumped.updated_at || dumped.updatedAt;
  console.log("USING dump file");
} else {
  const url = (vars.SUPABASE_URL || vars.NEXT_PUBLIC_SUPABASE_URL || "").replace(
    /\/$/,
    ""
  );
  const key =
    vars.SUPABASE_SERVICE_ROLE_KEY ||
    vars.SUPABASE_SERVICE_KEY ||
    vars.SUPABASE_API_KEY ||
    "";
  if (!url || !key) {
    console.error("MISSING supabase env and no tmp/supabase-main.json");
    process.exit(1);
  }
  const res = await fetch(
    `${url}/rest/v1/app_database?id=eq.main&select=db,updated_at`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    }
  );
  if (!res.ok) {
    console.error("SUPABASE_FETCH", res.status);
    process.exit(1);
  }
  const rows = await res.json();
  const row = Array.isArray(rows) ? rows[0] : rows;
  db = row?.db;
  updatedAt = row?.updated_at;
  if (!db) {
    console.error("EMPTY supabase main row");
    process.exit(1);
  }
}
if (!db) {
  console.error("EMPTY dump");
  process.exit(1);
}
if (
  !vars.MYSQL_HOST ||
  !vars.MYSQL_USER ||
  !vars.MYSQL_PASSWORD ||
  !vars.MYSQL_DATABASE
) {
  console.error("MISSING MYSQL_* in env");
  process.exit(1);
}

const schema = fs.readFileSync(
  path.join(root, "scripts", "hostinger-schema.sql"),
  "utf8"
);
const conn = await mysql.createConnection({
  host: vars.MYSQL_HOST,
  port: Number(vars.MYSQL_PORT || 3306),
  user: vars.MYSQL_USER,
  password: vars.MYSQL_PASSWORD,
  database: vars.MYSQL_DATABASE,
  multipleStatements: true,
});
await conn.query(schema);

const now = updatedAt || new Date().toISOString();
await conn.beginTransaction();
try {
  for (const [keyName, table] of TABLES) {
    const list = db[keyName] || [];
    await conn.query(`DELETE FROM \`${table}\``);
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const id = rowId(item, `${table}_${i}`);
      await conn.query(
        `INSERT INTO \`${table}\` (id, body, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP(3))
         ON DUPLICATE KEY UPDATE body = VALUES(body)`,
        [id, JSON.stringify(item)]
      );
    }
    console.log(table, list.length);
  }
  const meta = [
    ["settings", db.settings || {}],
    ["rolePresets", db.rolePresets || {}],
    [
      "deletedUsers",
      { ids: db.deletedUserIds || [], at: db.deletedUserAt || {} },
    ],
    ["waInbox", db.waInbox || { messages: [], reads: [] }],
    ["doc", { id: "main" }],
  ];
  for (const [k, body] of meta) {
    await conn.query(
      `INSERT INTO app_meta (k, body, updated_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = VALUES(updated_at)`,
      [k, JSON.stringify(body), now]
    );
  }
  await conn.commit();
} catch (err) {
  await conn.rollback();
  console.error("MIGRATE_FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
} finally {
  await conn.end();
}
console.log("MIGRATE_OK users", (db.users || []).length, "products", (db.products || []).length);
