import { NextRequest, NextResponse } from "next/server";
import { stockAlertsFromDb } from "@/lib/accounting/analysis";
import { buildDraftPosFromAlerts } from "@/lib/reorder-po";
import { authorizeCron } from "@/lib/server/cron-auth";
import { cloudGetAppDb, cloudPutAppDb } from "@/lib/server/app-db";
import { notifyStaffWhatsAppServer } from "@/lib/server/whatsapp-notify";
import { capabilityContextFrom, staffMatchingAnyCap } from "@/lib/capabilities";
import {
  removePushEndpoint,
  sendWebPushToSubs,
  staffWithAnyCapability,
  vapidConfigured,
} from "@/lib/server/web-push";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";
import { lowStockStaffWhatsAppText, whatsappCountryCode } from "@/lib/whatsapp";

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
      { error: "Cloud database not configured" },
      { status: 503 },
    );
  }
  const { db, updatedAt, error } = await cloudGetAppDb();
  if (error || !db) {
    return NextResponse.json(
      { error: error || "Cloud empty" },
      { status: 500 },
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

  const reorderRows = stockAlertsFromDb(db).filter((r) => r.kind === "reorder");
  const created = buildDraftPosFromAlerts(db, "cron_reorder", {
    rows: reorderRows,
    minQty: db.settings.autoReorderMinQty ?? 1,
  });

  const put = await cloudPutAppDb(sanitizeDbForCloud(db), updatedAt ?? null);
  if (!put.ok) {
    return NextResponse.json(
      { error: put.error || (put.conflict ? "Conflict" : "Save failed") },
      { status: put.conflict ? 409 : 500 },
    );
  }

  let pushSent = 0;
  let waSent = 0;
  if (created.length) {
    const title = "Auto reorder POs";
    const text = `Created ${created.length} draft PO(s): ${created
      .map((p) => p.number)
      .join(", ")}`.slice(0, 160);
    const url = "/en/admin/accounts/purchases";
    if (vapidConfigured()) {
      const staff = staffWithAnyCapability(
        db.users,
        ["manage_orders", "manage_reorder"],
        capabilityContextFrom(db),
      );
      let dirty = false;
      for (const u of staff) {
        const { sent, deadEndpoints } = await sendWebPushToSubs(
          u.pushSubscriptions,
          { title, body: text, url },
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
        await cloudPutAppDb(sanitizeDbForCloud(db), put.updatedAt ?? null);
      }
    }
    waSent = await notifyStaffWhatsAppServer({
      users: staffMatchingAnyCap(
        db.users,
        ["manage_orders", "manage_reorder"],
        capabilityContextFrom(db),
      ),
      countryCode: whatsappCountryCode(db.settings),
      enabled: db.settings.whatsappNotifyEnabled,
      text: lowStockStaffWhatsAppText({
        companyName: db.settings.companyName || "TT Enterprises",
        locale: "en",
        poCount: created.length,
        numbers: created.map((p) => p.number),
        alertCount: reorderRows.length,
      }),
    });
  }

  return NextResponse.json({
    ok: true,
    created: created.length,
    numbers: created.map((p) => p.number),
    alertCount: reorderRows.length,
    pushSent,
    waSent,
  });
}

/** Allow GET for simple Hostinger cron (same auth). */
export async function GET(req: NextRequest) {
  return POST(req);
}
