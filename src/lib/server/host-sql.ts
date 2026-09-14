import mysql from "mysql2/promise";
import type { AppDatabase } from "@/lib/store/db";
import { isMysqlConfigured } from "@/lib/supabase/config";

export { isCloudDbConfigured, isMysqlConfigured } from "@/lib/supabase/config";

type RowBody = { id?: string };

export const COLLECTION_TABLES: ReadonlyArray<{
  key: keyof AppDatabase;
  table: string;
}> = [
  { key: "users", table: "users" },
  { key: "products", table: "products" },
  { key: "orders", table: "orders" },
  { key: "schemes", table: "schemes" },
  { key: "walletTransactions", table: "wallet_transactions" },
  { key: "walletDeposits", table: "wallet_deposits" },
  { key: "shippingRules", table: "shipping_rules" },
  { key: "categories", table: "categories" },
  { key: "accounts", table: "accounts" },
  { key: "parties", table: "parties" },
  { key: "vouchers", table: "vouchers" },
  { key: "ledgerEntries", table: "ledger_entries" },
  { key: "stockMovements", table: "stock_movements" },
  { key: "stockBatches", table: "stock_batches" },
  { key: "batchConsumptions", table: "batch_consumptions" },
  { key: "billAllocations", table: "bill_allocations" },
  { key: "purchaseOrders", table: "purchase_orders" },
  { key: "goodsReceipts", table: "goods_receipts" },
  { key: "supplierContracts", table: "supplier_contracts" },
  { key: "tallyPosts", table: "tally_posts" },
  { key: "statementMatches", table: "statement_matches" },
  { key: "bankRecons", table: "bank_recons" },
  { key: "accessPlaces", table: "access_places" },
  { key: "staffJobs", table: "staff_jobs" },
  { key: "peopleActivity", table: "people_activity" },
  { key: "hrTerms", table: "hr_terms" },
  { key: "hrShifts", table: "hr_shifts" },
  { key: "hrSites", table: "hr_sites" },
  { key: "hrPunches", table: "hr_punches" },
  { key: "hrLeaves", table: "hr_leaves" },
  { key: "hrAdvances", table: "hr_advances" },
  { key: "hrPayslips", table: "hr_payslips" },
  { key: "stockCounts", table: "stock_counts" },
  { key: "cashCounts", table: "cash_counts" },
  { key: "monthlyAudits", table: "monthly_audits" },
];

function parseJson(value: unknown): unknown {
  if (value == null) return null;
  let raw: unknown = value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) {
    raw = raw.toString("utf8");
  }
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  return raw;
}

function rowId(item: unknown, fallback: string): string {
  if (item && typeof item === "object" && "id" in item) {
    const id = String((item as RowBody).id || "").trim();
    if (id) return id.slice(0, 64);
  }
  return fallback.slice(0, 64);
}

export function splitAppDatabase(db: AppDatabase): {
  collections: Record<string, { id: string; body: unknown }[]>;
  meta: Record<string, unknown>;
} {
  const collections: Record<string, { id: string; body: unknown }[]> = {};
  for (const { key, table } of COLLECTION_TABLES) {
    const list = (db[key] as unknown[] | undefined) ?? [];
    collections[table] = list.map((item, i) => ({
      id: rowId(item, `${table}_${i}`),
      body: item,
    }));
  }
  return {
    collections,
    meta: {
      settings: db.settings ?? {},
      rolePresets: db.rolePresets ?? {},
      deletedUsers: {
        ids: db.deletedUserIds ?? [],
        at: db.deletedUserAt ?? {},
      },
      waInbox: db.waInbox ?? { messages: [], reads: [] },
    },
  };
}

export function assembleAppDatabase(input: {
  collections: Record<string, unknown[]>;
  meta: Record<string, unknown>;
}): AppDatabase {
  const db = {} as AppDatabase;
  for (const { key, table } of COLLECTION_TABLES) {
    const rows = input.collections[table] ?? [];
    (db as unknown as Record<string, unknown[]>)[key as string] = rows;
  }
  const deleted = (input.meta.deletedUsers || {}) as {
    ids?: string[];
    at?: Record<string, string>;
  };
  db.settings = (input.meta.settings || {}) as AppDatabase["settings"];
  db.rolePresets = (input.meta.rolePresets || {}) as AppDatabase["rolePresets"];
  db.deletedUserIds = deleted.ids ?? [];
  db.deletedUserAt = deleted.at ?? {};
  db.waInbox = (input.meta.waInbox || {
    messages: [],
    reads: [],
  }) as AppDatabase["waInbox"];
  return db;
}

const COLLECTION_DDL = ` (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  body JSON NOT NULL,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;

let tablesReady = false;

const MYSQL_TRANSIENT_CODES = new Set([
  "PROTOCOL_CONNECTION_LOST",
  "PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR",
  "PROTOCOL_ENQUEUE_AFTER_QUIT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "EPIPE",
  "ER_CON_COUNT_ERROR",
  "ER_SERVER_SHUTDOWN",
  "ER_CLIENT_INTERACTION_TIMEOUT",
]);

type MysqlQueryable = mysql.Pool | mysql.PoolConnection;

export function isMysqlTransientError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const rec = err as { code?: string; message?: string };
  if (rec.code && MYSQL_TRANSIENT_CODES.has(rec.code)) return true;
  return isMysqlTransientMessage(rec.message || "");
}

export function isMysqlTransientMessage(message: string): boolean {
  const msg = (message || "").toLowerCase();
  return (
    msg.includes("connection is in closed state") ||
    msg.includes("cannot enqueue") ||
    msg.includes("server closed the connection") ||
    msg.includes("lost connection") ||
    msg.includes("connect etimedout") ||
    msg.includes("too many connections") ||
    msg.includes("protocol_connection_lost") ||
    msg.includes("econnreset")
  );
}

export function publicDatabaseError(err: unknown): string {
  if (err instanceof Error) return publicDatabaseMessage(err.message);
  if (err && typeof err === "object" && "message" in err) {
    return publicDatabaseMessage(
      String((err as { message?: string }).message || "")
    );
  }
  return publicDatabaseMessage(String(err || ""));
}

export function publicDatabaseMessage(message: string): string {
  if (isMysqlTransientMessage(message) || isMysqlTransientError({ message })) {
    return "Database is busy. Please retry.";
  }
  if (/mysql|sqlstate|er_[a-z0-9_]+|protocol_/i.test(message || "")) {
    return "Database is busy. Please retry.";
  }
  return message || "Database is busy. Please retry.";
}

async function ensureCollectionTables(q: MysqlQueryable): Promise<void> {
  if (tablesReady) return;
  for (const { table } of COLLECTION_TABLES) {
    await q.query(`CREATE TABLE IF NOT EXISTS \`${table}\`${COLLECTION_DDL}`);
  }
  tablesReady = true;
}

let pool: mysql.Pool | null = null;

export function getMysqlPool(): mysql.Pool {
  if (pool) return pool;
  if (!isMysqlConfigured()) {
    throw new Error("MYSQL_* environment is missing");
  }
  pool = mysql.createPool({
    host: (process.env.MYSQL_HOST || "").trim(),
    port: Number(process.env.MYSQL_PORT || 3306) || 3306,
    user: (process.env.MYSQL_USER || "").trim(),
    password: process.env.MYSQL_PASSWORD || "",
    database: (process.env.MYSQL_DATABASE || "").trim(),
    waitForConnections: true,
    connectionLimit: 8,
    maxIdle: 4,
    // Hostinger often closes idle MySQL sockets well under mysql2's 60s default.
    idleTimeout: 8000,
    queueLimit: 40,
    connectTimeout: 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 5000,
    charset: "utf8mb4",
  });
  return pool;
}

export function resetMysqlPoolForTests(): void {
  pool = null;
  tablesReady = false;
}

async function resetMysqlPool(): Promise<void> {
  const old = pool;
  pool = null;
  tablesReady = false;
  if (!old) return;
  try {
    await old.end();
  } catch {
    /* ignore */
  }
}

async function withMysqlRetry<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (!isMysqlTransientError(err)) throw err;
    await resetMysqlPool();
    return await run();
  }
}

export async function mysqlGetUpdatedAt(): Promise<{
  updatedAt?: string | null;
  error?: string;
}> {
  try {
    return await withMysqlRetry(async () => {
      const [rows] = await getMysqlPool().query(
        "SELECT updated_at FROM app_meta WHERE k = 'doc' LIMIT 1"
      );
      const row = (rows as { updated_at?: string }[])[0];
      return { updatedAt: row?.updated_at ?? null };
    });
  } catch (err) {
    return { error: publicDatabaseError(err) };
  }
}

export async function mysqlGetAppDb(): Promise<{
  db: AppDatabase | null;
  updatedAt?: string;
  error?: string;
}> {
  try {
    return await withMysqlRetry(async () => {
      const p = getMysqlPool();
      const conn = await p.getConnection();
      try {
        await ensureCollectionTables(conn);
        const collections: Record<string, unknown[]> = {};
        for (const { table } of COLLECTION_TABLES) {
          const [rows] = await conn.query(`SELECT id, body FROM \`${table}\``);
          collections[table] = (rows as { body: unknown }[]).map((r) =>
            parseJson(r.body)
          );
        }
        const [metaRows] = await conn.query(
          "SELECT k, body, updated_at FROM app_meta"
        );
        const meta: Record<string, unknown> = {};
        let updatedAt: string | undefined;
        for (const r of metaRows as {
          k: string;
          body: unknown;
          updated_at?: string;
        }[]) {
          if (r.k === "doc") {
            updatedAt = r.updated_at || undefined;
            continue;
          }
          meta[r.k] = parseJson(r.body);
        }
        const db = assembleAppDatabase({ collections, meta });
        if (!db.users && !db.products) return { db: null, updatedAt };
        return { db, updatedAt };
      } finally {
        conn.release();
      }
    });
  } catch (err) {
    return {
      db: null,
      error: publicDatabaseError(err),
    };
  }
}

async function mysqlPutAppDbOnce(
  db: AppDatabase,
  baseUpdatedAt?: string | null
): Promise<{
  ok: boolean;
  conflict?: boolean;
  updatedAt?: string;
  error?: string;
}> {
  const p = getMysqlPool();
  const conn = await p.getConnection();
  try {
    await ensureCollectionTables(conn);
    await conn.beginTransaction();
    const [curRows] = await conn.query(
      "SELECT updated_at FROM app_meta WHERE k = 'doc' LIMIT 1 FOR UPDATE"
    );
    const remoteAt = (curRows as { updated_at?: string }[])[0]?.updated_at;
    if (baseUpdatedAt && remoteAt && remoteAt !== baseUpdatedAt) {
      await conn.rollback();
      return { ok: false, conflict: true, updatedAt: remoteAt };
    }

    const now = new Date().toISOString();
    const split = splitAppDatabase(db);

    for (const { table } of COLLECTION_TABLES) {
      const rows = split.collections[table] ?? [];
      const ids = rows.map((r) => r.id);
      if (ids.length) {
        await conn.query(
          `DELETE FROM \`${table}\` WHERE id NOT IN (${ids.map(() => "?").join(",")})`,
          ids
        );
      } else {
        await conn.query(`DELETE FROM \`${table}\``);
      }
      for (const row of rows) {
        await conn.query(
          `INSERT INTO \`${table}\` (id, body, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = CURRENT_TIMESTAMP(3)`,
          [row.id, JSON.stringify(row.body)]
        );
      }
    }

    const metaEntries: [string, unknown][] = [
      ["settings", split.meta.settings],
      ["rolePresets", split.meta.rolePresets],
      ["deletedUsers", split.meta.deletedUsers],
      ["waInbox", split.meta.waInbox],
    ];
    for (const [k, body] of metaEntries) {
      await conn.query(
        `INSERT INTO app_meta (k, body, updated_at) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = VALUES(updated_at)`,
        [k, JSON.stringify(body), now]
      );
    }
    await conn.query(
      `INSERT INTO app_meta (k, body, updated_at) VALUES ('doc', ?, ?)
       ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at), body = VALUES(body)`,
      [JSON.stringify({ id: "main" }), now]
    );

    await conn.commit();
    return { ok: true, updatedAt: now };
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw err;
  } finally {
    conn.release();
  }
}

export async function mysqlPutAppDb(
  db: AppDatabase,
  baseUpdatedAt?: string | null
): Promise<{
  ok: boolean;
  conflict?: boolean;
  updatedAt?: string;
  error?: string;
}> {
  try {
    return await withMysqlRetry(() => mysqlPutAppDbOnce(db, baseUpdatedAt));
  } catch (err) {
    return {
      ok: false,
      error: publicDatabaseError(err),
    };
  }
}
