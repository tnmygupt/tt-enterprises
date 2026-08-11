import { NextRequest, NextResponse } from "next/server";
import { stockAlerts } from "@/lib/accounting/analysis";
import { buildDraftPosFromAlerts } from "@/lib/reorder-po";
import {
  cloudGetAppDb,
  cloudPutAppDb,
  createServerSupabase,
} from "@/lib/server/app-db";
import {
  removePushEndpoint,
  sendWebPushToSubs,
  staffWithManageOrders,
  vapidConfigured,
} from "@/lib/server/web-push";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";

function authorizeCron(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const header = req.headers.get("authorization") || "";
  const bearer = header.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const query = req.nextUrl.searchParams.get("secret")?.trim();
  return bearer === secret || query === secret;
}

/**
 * Weekly auto draft-PO from reorder alerts.
 * Auth: Authorization: Bearer CRON_SECRET (or ?secret= for simple Hostinger curl).
 */
export async function POST(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json({ error: "Cloud unavailable" }, { status: 503 });
  }

  const { db, updatedAt, error } = await cloudGetAppDb(supabase);
  if (error || !db) {
    return NextResponse.json(
      { error: error || "Cloud empty" },
      { status: 500 }
    );
  }

  if (!db.settings.autoReorderEnabled) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: "autoReorderEnabled is off",
      created: 0,
    });
  }

  const reorderRows = stockAlerts(db.products, db.stockMovements ?? []).filter(
    (r) => r.kind === "reorder"
  );
  const created = buildDraftPosFromAlerts(db, "cron_reorder", {
    rows: reorderRows,
    minQty: db.settings.autoReorderMinQty ?? 1,
  });

  const put = await cloudPutAppDb(
    supabase,
    sanitizeDbForCloud(db),
    updatedAt ?? null
  );
  if (!put.ok) {
    return NextResponse.json(
      { error: put.error || (put.conflict ? "Conflict" : "Save failed") },
      { status: put.conflict ? 409 : 500 }
    );
  }

  let pushSent = 0;
  if (created.length && vapidConfigured()) {
    const staff = staffWithManageOrders(db.users);
    const title = "Auto reorder POs";
    const text = `Created ${created.length} draft PO(s): ${created
      .map((p) => p.number)
      .join(", ")}`.slice(0, 160);
    const url = "/en/admin/accounts/purchases";
    let dirty = false;
    for (const u of staff) {
      const { sent, deadEndpoints } = await sendWebPushToSubs(
        u.pushSubscriptions,
        { title, body: text, url }
      );
      pushSent += sent;
      if (deadEndpoints.length) {
        let next = u.pushSubscriptions;
        for (const ep of deadEndpoints) {
          next = removePushEndpoint(next, ep);
        }
        u.pushSubscriptions = next;
        dirty = true;
      }
    }
    if (dirty) {
      await cloudPutAppDb(
        supabase,
        sanitizeDbForCloud(db),
        put.updatedAt ?? null
      );
    }
  }

  return NextResponse.json({
    ok: true,
    created: created.length,
    numbers: created.map((p) => p.number),
    alertCount: reorderRows.length,
    pushSent,
  });
}

/** Allow GET for simple Hostinger cron (same auth). */
export async function GET(req: NextRequest) {
  return POST(req);
}
