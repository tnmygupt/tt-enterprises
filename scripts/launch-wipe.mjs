/**
 * One-shot launch wipe. Runs only when LAUNCH_WIPE=YES (npm run launch-wipe).
 * Keeps every super_admin login, the catalog, categories, chart of accounts,
 * shipping rules, schemes, staff jobs, and BOM recipes.
 * Clears orders, dealers, other staff, books, stock history, and job cards.
 * Does not print phone numbers or secrets.
 */
import { createConnection } from "mysql2/promise";

if (process.env.LAUNCH_WIPE !== "YES") {
  console.error("Refusing launch wipe without LAUNCH_WIPE=YES");
  process.exit(1);
}

const host = (process.env.MYSQL_HOST || "").trim();
const user = (process.env.MYSQL_USER || "").trim();
const password = process.env.MYSQL_PASSWORD || "";
const database = (process.env.MYSQL_DATABASE || "").trim();
const port = Number(process.env.MYSQL_PORT || 3306) || 3306;

if (!host || !user || !password || !database) {
  console.error("MYSQL_* is missing — wipe aborted, no rows changed");
  process.exit(1);
}

const CLEAR_TABLES = [
  "orders",
  "wallet_transactions",
  "wallet_deposits",
  "parties",
  "vouchers",
  "ledger_entries",
  "stock_movements",
  "stock_batches",
  "batch_consumptions",
  "bill_allocations",
  "purchase_orders",
  "goods_receipts",
  "supplier_contracts",
  "tally_posts",
  "statement_matches",
  "bank_recons",
  "access_places",
  "people_activity",
  "hr_terms",
  "hr_shifts",
  "hr_sites",
  "hr_punches",
  "hr_leaves",
  "hr_advances",
  "hr_payslips",
  "stock_counts",
  "cash_counts",
  "monthly_audits",
  "job_cards",
  "owner_approvals",
];

function asJson(value) {
  if (value == null) return null;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) {
    value = value.toString("utf8");
  }
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

function keepAdmin(row) {
  return row && row.role === "super_admin";
}

const conn = await createConnection({
  host,
  port,
  user,
  password,
  database,
  connectTimeout: 15000,
  charset: "utf8mb4",
});

try {
  const [tableRows] = await conn.query(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()"
  );
  const tables = new Set(
    tableRows.map((r) => String(r.name || r.TABLE_NAME || "").toLowerCase())
  );
  if (!tables.has("users") || !tables.has("app_meta")) {
    console.error("App tables are missing — wipe aborted");
    process.exit(1);
  }

  const [userRows] = await conn.query("SELECT id, body FROM users");
  const users = userRows.map((r) => ({ id: String(r.id), body: asJson(r.body) }));
  const admins = users.filter((u) => keepAdmin(u.body));
  if (!admins.length) {
    console.error("No super_admin login found — wipe aborted, no rows changed");
    process.exit(1);
  }

  const [orderCountRows] = await conn.query(
    tables.has("orders") ? "SELECT COUNT(*) AS n FROM orders" : "SELECT 0 AS n"
  );
  const [productCountRows] = await conn.query(
    tables.has("products")
      ? "SELECT COUNT(*) AS n FROM products"
      : "SELECT 0 AS n"
  );
  const removedOrders = Number(orderCountRows[0]?.n || 0);
  const keptProducts = Number(productCountRows[0]?.n || 0);

  const purgeAt = new Date().toISOString();
  const keepIds = new Set(admins.map((u) => u.id));
  const removedIds = users.filter((u) => !keepIds.has(u.id)).map((u) => u.id);

  await conn.beginTransaction();

  for (const table of CLEAR_TABLES) {
    if (!tables.has(table)) continue;
    await conn.query(`DELETE FROM \`${table}\``);
  }

  if (removedIds.length) {
    await conn.query(
      `DELETE FROM users WHERE id IN (${removedIds.map(() => "?").join(",")})`,
      removedIds
    );
  }

  for (const admin of admins) {
    const next = {
      ...admin.body,
      role: "super_admin",
      active: true,
      approved: true,
      walletBalance: 0,
      liftingProgressKg: 0,
      schemeProgress: {},
    };
    await conn.query(
      "UPDATE users SET body = ?, updated_at = CURRENT_TIMESTAMP(3) WHERE id = ?",
      [JSON.stringify(next), admin.id]
    );
  }

  const [metaRows] = await conn.query(
    "SELECT k, body FROM app_meta WHERE k IN ('settings', 'deletedUsers')"
  );
  const meta = {};
  for (const row of metaRows) meta[row.k] = asJson(row.body) || {};

  const settings = {
    ...(meta.settings || {}),
    opsPurgeAt: purgeAt,
    whatsappDigest: {},
  };
  delete settings.tallyLastSyncAt;
  delete settings.tallySyncMessage;
  settings.tallySyncStatus = "idle";

  const prevAt =
    meta.deletedUsers && typeof meta.deletedUsers.at === "object"
      ? meta.deletedUsers.at
      : {};
  const tombs = { ...prevAt };
  for (const id of removedIds) tombs[id] = purgeAt;
  for (const id of keepIds) delete tombs[id];

  await conn.query(
    `INSERT INTO app_meta (k, body, updated_at) VALUES ('settings', ?, ?)
     ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = VALUES(updated_at)`,
    [JSON.stringify(settings), purgeAt]
  );
  await conn.query(
    `INSERT INTO app_meta (k, body, updated_at) VALUES ('deletedUsers', ?, ?)
     ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = VALUES(updated_at)`,
    [JSON.stringify({ ids: Object.keys(tombs), at: tombs }), purgeAt]
  );
  await conn.query(
    `INSERT INTO app_meta (k, body, updated_at) VALUES ('waInbox', ?, ?)
     ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = VALUES(updated_at)`,
    [JSON.stringify({ messages: [], reads: [] }), purgeAt]
  );
  await conn.query(
    `INSERT INTO app_meta (k, body, updated_at) VALUES ('doc', ?, ?)
     ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = VALUES(updated_at)`,
    [JSON.stringify({ id: "main" }), purgeAt]
  );

  await conn.commit();
  console.log(
    `WIPE OK kept_admins=${admins.length} removed_users=${removedIds.length} removed_orders=${removedOrders} kept_products=${keptProducts}`
  );
} catch (err) {
  try {
    await conn.rollback();
  } catch {
    /* ignore */
  }
  console.error("Launch wipe failed — transaction rolled back");
  console.error(err instanceof Error ? err.message : "unknown error");
  process.exit(1);
} finally {
  await conn.end();
}
