import { readFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { ensureDataDir } from "@/lib/data-dir";

function isAuthorized(req: NextRequest): boolean {
  const required = process.env.TALLY_READ_KEY || process.env.TALLY_SYNC_KEY;
  if (!required) return process.env.NODE_ENV !== "production";
  const key =
    req.headers.get("x-tally-key") ||
    req.nextUrl.searchParams.get("key") ||
    "";
  return key === required;
}

/** Latest Tally stock payload for staff clients to auto-apply. */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const dir = await ensureDataDir();
    const file = path.join(dir, "tally-last-sync.json");
    const raw = await readFile(file, "utf8");
    const data = JSON.parse(raw) as {
      items?: unknown[];
      syncedAt?: string;
      received?: number;
    };
    return NextResponse.json({
      ok: true,
      items: data.items ?? [],
      syncedAt: data.syncedAt ?? null,
      received: data.received ?? 0,
    });
  } catch {
    return NextResponse.json({
      ok: true,
      items: [],
      syncedAt: null,
      received: 0,
    });
  }
}
