import { NextRequest, NextResponse } from "next/server";
import {
  applyTallyStock,
  tallyKeyOk,
  type TallyStockInput,
} from "@/lib/tally-sync";
import { withTallyDb } from "@/lib/server/tally-store";

function authorize(req: NextRequest): boolean {
  return tallyKeyOk(
    req.headers.get("x-tally-sync-key"),
    process.env.TALLY_SYNC_KEY
  );
}

function asItems(body: unknown): TallyStockInput[] | null {
  const raw = Array.isArray(body)
    ? body
    : body && typeof body === "object" && "items" in body
      ? (body as { items?: unknown }).items
      : null;
  if (!Array.isArray(raw)) return null;
  return raw as TallyStockInput[];
}

/**
 * Receives stock snapshots from the local TallyPrime bridge and writes
 * them onto products in MySQL. Match is tally item id, then SKU, then name.
 */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const items = asItems(body);
  if (!items) {
    return NextResponse.json(
      {
        error:
          "Expected array of { tallyItemId?, sku?, name?, productId?, variationId?, stock }",
      },
      { status: 400 }
    );
  }

  const saved = await withTallyDb((db) => applyTallyStock(db, items));
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: saved.status });
  }

  return NextResponse.json({
    ok: true,
    received: items.length,
    applied: saved.value.applied,
    unknown: saved.value.unknown,
    syncedAt: new Date().toISOString(),
    source: "tally-bridge",
    appliedTo: "mysql",
  });
}

export async function GET() {
  return NextResponse.json({
    service: "tt-enterprises-tally-sync",
    status: "ready",
    persist: "mysql",
  });
}
