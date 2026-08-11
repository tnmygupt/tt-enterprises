import { NextRequest, NextResponse } from "next/server";
import {
  cloudGetAppDb,
  cloudPutAppDb,
  createServerSupabase,
} from "@/lib/server/app-db";
import { readSessionCookie } from "@/lib/server/session";
import {
  removePushEndpoint,
  sendWebPushToSubs,
  staffWithManageOrders,
  vapidConfigured,
} from "@/lib/server/web-push";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";

/**
 * Broadcast a push to all staff with manage_orders + subscriptions.
 * Auth: logged-in staff session (best-effort from client after new estimate).
 */
export async function POST(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  if (!vapidConfigured()) {
    return NextResponse.json(
      { ok: false, configured: false, error: "VAPID not configured" },
      { status: 503 }
    );
  }

  let body: { title?: string; body?: string; url?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const title = (body.title || "TT Enterprises").slice(0, 80);
  const text = (body.body || "New order activity").slice(0, 160);
  const url = (body.url || "/en/admin/orders?filter=estimate").slice(0, 200);

  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      ok: true,
      sent: 0,
      mode: "local_skip",
    });
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

  const staff = staffWithManageOrders(db.users);
  let totalSent = 0;
  let dirty = false;

  for (const u of staff) {
    const { sent, deadEndpoints } = await sendWebPushToSubs(
      u.pushSubscriptions,
      { title, body: text, url }
    );
    totalSent += sent;
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
    await cloudPutAppDb(supabase, sanitizeDbForCloud(db), updatedAt ?? null);
  }

  return NextResponse.json({
    ok: true,
    configured: true,
    sent: totalSent,
    staffTargets: staff.length,
  });
}
