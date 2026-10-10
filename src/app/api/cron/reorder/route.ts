import { NextRequest, NextResponse } from "next/server";
import {
  autoReorderOwnerPoSummaries,
  runAutoReorder,
} from "@/lib/reorder-po";
import { authorizeCron } from "@/lib/server/cron-auth";
import { cloudGetAppDb, cloudPutAppDb } from "@/lib/server/app-db";
import { notifyStaffWhatsAppServer } from "@/lib/server/whatsapp-notify";
import { ownerUsers } from "@/lib/owner-daily-summary";
import {
  removePushEndpoint,
  sendWebPushToSubs,
  vapidConfigured,
} from "@/lib/server/web-push";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";
import {
  autoReorderOwnerPushBody,
  autoReorderOwnerWhatsAppText,
  whatsappCountryCode,
} from "@/lib/whatsapp";

/**
 * Weekly auto ordered-POs from reorder alerts. WhatsApps owners only — never the mill.
 * Auth: Authorization: Bearer CRON_SECRET (or ?secret= for simple Hostinger curl).
 */
export async function POST(req: NextRequest) {
  if (!authorizeCron(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Cloud database not configured" },
      { status: 503 }
    );
  }
  const { db, updatedAt, error } = await cloudGetAppDb();
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

  const { created, alertCount } = runAutoReorder(db, "cron_reorder", {
    minQty: db.settings.autoReorderMinQty ?? 1,
  });

  const put = await cloudPutAppDb(sanitizeDbForCloud(db), updatedAt ?? null);
  if (!put.ok) {
    return NextResponse.json(
      { error: put.error || (put.conflict ? "Conflict" : "Save failed") },
      { status: put.conflict ? 409 : 500 }
    );
  }

  let pushSent = 0;
  let waSent = 0;
  if (created.length) {
    const owners = ownerUsers(db.users);
    const title = "Auto reorder POs";
    const text = autoReorderOwnerPushBody({
      poCount: created.length,
      numbers: created.map((p) => p.number),
    });
    const url = "/en/admin/accounts/purchases";
    if (vapidConfigured()) {
      let dirty = false;
      for (const u of owners) {
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
        await cloudPutAppDb(sanitizeDbForCloud(db), put.updatedAt ?? null);
      }
    }
    waSent = await notifyStaffWhatsAppServer({
      users: owners,
      countryCode: whatsappCountryCode(db.settings),
      enabled: db.settings.whatsappNotifyEnabled,
      text: autoReorderOwnerWhatsAppText({
        companyName: db.settings.companyName || "TT Enterprises",
        locale: "en",
        pos: autoReorderOwnerPoSummaries(created, db.parties),
        alertCount,
      }),
    });
  }

  return NextResponse.json({
    ok: true,
    created: created.length,
    numbers: created.map((p) => p.number),
    alertCount,
    pushSent,
    waSent,
  });
}

/** Allow GET for simple Hostinger cron (same auth). */
export async function GET(req: NextRequest) {
  return POST(req);
}
