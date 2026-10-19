import { NextRequest, NextResponse } from "next/server";
import {
  applyLinkedTallyStock,
  applyTallyStock,
  tallyKeyOk,
  tallyRegistrySummary,
  upsertTallyRegistry,
  type TallyRegistryInput,
  type TallyRegistryLedgerInput,
  type TallyRegistryItemInput,
  type TallyStockInput,
} from "@/lib/tally-sync";
import { withTallyDb } from "@/lib/server/tally-store";

function authorize(req: NextRequest): boolean {
  return tallyKeyOk(
    req.headers.get("x-tally-sync-key"),
    process.env.TALLY_SYNC_KEY
  );
}

function asRecord(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

/** New bridge payload: full item + ledger lists. Legacy payloads are a stock array. */
function asRegistry(body: unknown): TallyRegistryInput | null {
  const rec = asRecord(body);
  if (!rec) return null;
  const ledgers = Array.isArray(rec.ledgers) ? rec.ledgers : null;
  const full = rec.full === true;
  if (!ledgers && !full) return null;
  const items = Array.isArray(rec.items) ? rec.items : [];
  return {
    items: items as TallyRegistryItemInput[],
    ledgers: (ledgers ?? []) as TallyRegistryLedgerInput[],
    full,
    source: "bridge",
  };
}

function asItems(body: unknown): TallyStockInput[] | null {
  const raw = Array.isArray(body)
    ? body
    : asRecord(body) && Array.isArray(asRecord(body)?.items)
      ? (asRecord(body)?.items as unknown[])
      : null;
  if (!Array.isArray(raw)) return null;
  return raw as TallyStockInput[];
}

/**
 * Receives the Tally master list (items + party ledgers) and writes stock
 * onto products that are already linked. A bare stock array is still accepted.
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

  const registry = asRegistry(body);
  const legacy = registry ? null : asItems(body);
  if (!registry && !legacy) {
    return NextResponse.json(
      {
        error:
          "Expected { items, ledgers, full } or an array of { name, stock }",
      },
      { status: 400 }
    );
  }

  const saved = await withTallyDb((db) => {
    if (registry) {
      const upserted = upsertTallyRegistry(db, registry);
      const stock = applyLinkedTallyStock(db);
      return { upserted, stock, summary: tallyRegistrySummary(db) };
    }
    const stock = applyTallyStock(db, legacy ?? []);
    return { upserted: null, stock, summary: tallyRegistrySummary(db) };
  });
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: saved.status });
  }

  const { upserted, stock, summary } = saved.value;
  return NextResponse.json({
    ok: true,
    received: registry
      ? (registry.items?.length ?? 0) + (registry.ledgers?.length ?? 0)
      : (legacy?.length ?? 0),
    applied: stock.applied,
    unknown: stock.unknown,
    items: {
      new: upserted?.items.created ?? summary.items.unlinked,
      linked: summary.items.linked,
      unlinked: summary.items.unlinked,
      missing: summary.items.missing,
    },
    ledgers: {
      new: upserted?.ledgers.created ?? 0,
      linked: summary.ledgers.linked,
      unlinked: summary.ledgers.unlinked,
      missing: summary.ledgers.missing,
    },
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
