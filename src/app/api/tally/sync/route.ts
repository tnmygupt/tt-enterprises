import { readFile, writeFile } from "fs/promises";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import { ensureDataDir } from "@/lib/data-dir";

type TallyItem = {
  productId: string;
  variationId?: string;
  tallyItemId: string;
  stock: number;
};

function syncFile(dir: string) {
  return path.join(dir, "tally-last-sync.json");
}

function authorize(req: NextRequest): boolean {
  const key = req.headers.get("x-tally-sync-key");
  const expected = process.env.TALLY_SYNC_KEY || "tt-enterprises-tally-dev-key";
  return key === expected;
}

/**
 * Receives stock snapshots from the local TallyPrime bridge.
 * Persists to data/tally-last-sync.json so all browsers auto-apply via /api/tally/latest.
 */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json();
    const items = (Array.isArray(body) ? body : body?.items) as TallyItem[];
    if (!Array.isArray(items)) {
      return NextResponse.json(
        {
          error:
            "Expected array of { productId, variationId?, tallyItemId, stock }",
        },
        { status: 400 }
      );
    }

    const cleaned: TallyItem[] = items
      .filter(
        (i) =>
          i &&
          typeof i.productId === "string" &&
          typeof i.tallyItemId === "string" &&
          Number.isFinite(Number(i.stock))
      )
      .map((i) => ({
        productId: i.productId,
        variationId: i.variationId || undefined,
        tallyItemId: i.tallyItemId,
        stock: Number(i.stock),
      }));

    const syncedAt = new Date().toISOString();
    const dir = await ensureDataDir();
    const payload = {
      ok: true,
      received: cleaned.length,
      syncedAt,
      items: cleaned,
      source: "tally-bridge",
    };
    await writeFile(syncFile(dir), JSON.stringify(payload, null, 2), "utf8");

    return NextResponse.json({
      ...payload,
      applied: "queued",
      hint: "Browsers auto-apply within ~60s via /api/tally/latest. Admin → Tally also shows status.",
    });
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
}

export async function GET() {
  try {
    const dir = await ensureDataDir();
    const raw = await readFile(syncFile(dir), "utf8");
    const data = JSON.parse(raw) as { syncedAt?: string; received?: number };
    return NextResponse.json({
      service: "tt-enterprises-tally-sync",
      status: "ready",
      lastSyncedAt: data.syncedAt ?? null,
      lastReceived: data.received ?? 0,
      persist: true,
    });
  } catch {
    return NextResponse.json({
      service: "tt-enterprises-tally-sync",
      status: "ready",
      lastSyncedAt: null,
      persist: true,
    });
  }
}
