import { randomBytes } from "crypto";
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import type { RowDataPacket } from "mysql2";
import {
  createPackSlip,
  nextPackSlipNo,
  updatePackSlip,
  type PackSlip,
} from "@/lib/pack-slips";
import { getMysqlPool, isMysqlConfigured, publicDatabaseError } from "@/lib/server/host-sql";

const FILE = path.join(process.cwd(), "data", "pack-slips.json");

function slipFile(): string {
  const override = (process.env.PACK_SLIP_FILE || "").trim();
  return override || FILE;
}

let queue: Promise<unknown> = Promise.resolve();
let tableReady = false;

function locked<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function isSlip(value: unknown): value is PackSlip {
  if (!value || typeof value !== "object") return false;
  const row = value as PackSlip;
  return typeof row.id === "string" && row.id.startsWith("ps_") && typeof row.slipNo === "string";
}

async function readFileSlips(): Promise<PackSlip[]> {
  try {
    const raw = await readFile(slipFile(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSlip);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeFileSlips(slips: PackSlip[]): Promise<void> {
  const file = slipFile();
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(slips), "utf8");
  await rename(tmp, file);
}

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await getMysqlPool().query(
    `CREATE TABLE IF NOT EXISTS pack_slips (
      id VARCHAR(64) NOT NULL PRIMARY KEY,
      body JSON NOT NULL,
      updated_at VARCHAR(40) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
  tableReady = true;
}

function parseBody(value: unknown): PackSlip | null {
  let raw: unknown = value;
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(raw)) raw = raw.toString("utf8");
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }
  return isSlip(raw) ? raw : null;
}

async function readMysqlSlips(): Promise<PackSlip[]> {
  await ensureTable();
  const [rows] = await getMysqlPool().query<RowDataPacket[]>(
    "SELECT body FROM pack_slips ORDER BY updated_at DESC LIMIT 500"
  );
  return rows.map((row) => parseBody(row.body)).filter((slip): slip is PackSlip => !!slip);
}

async function writeMysqlSlip(slip: PackSlip): Promise<void> {
  await ensureTable();
  await getMysqlPool().query(
    `INSERT INTO pack_slips (id, body, updated_at) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = VALUES(updated_at)`,
    [slip.id, JSON.stringify(slip), slip.updatedAt]
  );
}

async function deleteMysqlSlip(id: string): Promise<void> {
  await ensureTable();
  await getMysqlPool().query("DELETE FROM pack_slips WHERE id = ?", [id]);
}

async function readAll(): Promise<PackSlip[]> {
  const slips = isMysqlConfigured() ? await readMysqlSlips() : await readFileSlips();
  return slips.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

export async function listPackSlips(): Promise<PackSlip[]> {
  return locked(() => readAll());
}

export async function getPackSlip(id: string): Promise<PackSlip | null> {
  const slips = await listPackSlips();
  return slips.find((slip) => slip.id === id) ?? null;
}

export async function createPackSlipRecord(input: unknown): Promise<PackSlip> {
  return locked(async () => {
    const slips = await readAll();
    const slip = createPackSlip(input, nextPackSlipNo(slips));
    if (isMysqlConfigured()) await writeMysqlSlip(slip);
    else await writeFileSlips([slip, ...slips]);
    return slip;
  });
}

export async function updatePackSlipRecord(id: string, input: unknown): Promise<PackSlip> {
  return locked(async () => {
    const slips = await readAll();
    const prev = slips.find((slip) => slip.id === id);
    if (!prev) throw new Error("Slip not found");
    const next = updatePackSlip(prev, input);
    if (isMysqlConfigured()) {
      await writeMysqlSlip(next);
    } else {
      await writeFileSlips(slips.map((slip) => (slip.id === id ? next : slip)));
    }
    return next;
  });
}

export async function deletePackSlipRecord(id: string): Promise<boolean> {
  return locked(async () => {
    const slips = await readAll();
    const prev = slips.find((slip) => slip.id === id);
    if (!prev) return false;
    if (prev.status === "finalized") throw new Error("This slip is finalized");
    if (isMysqlConfigured()) await deleteMysqlSlip(id);
    else await writeFileSlips(slips.filter((slip) => slip.id !== id));
    return true;
  });
}

export function packStoreError(err: unknown): { message: string; status: number } {
  const raw = err instanceof Error ? err.message : "Could not save the slip";
  if (raw === "Slip not found") return { message: raw, status: 404 };
  if (raw === "Party name is required") return { message: raw, status: 400 };
  if (raw === "This slip is finalized") return { message: raw, status: 409 };
  return { message: publicDatabaseError(err), status: 500 };
}
