import { NextRequest, NextResponse } from "next/server";
import {
  cloudGetAppDb,
  cloudPutAppDb,
  createServerSupabase,
} from "@/lib/server/app-db";
import { resolveCloudActor } from "@/lib/server/authorize-db";
import { rateLimit } from "@/lib/server/rate-limit";
import { isStaffRole, readSessionCookie } from "@/lib/server/session";
import {
  removePushEndpoint,
  sendWebPushToSubs,
  staffWithManageOrders,
  vapidConfigured,
} from "@/lib/server/web-push";
import { userHasCapability } from "@/lib/capabilities";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";

/**
 * Broadcast a push to all staff with manage_orders + subscriptions.
 * Staff with manage_orders may set custom title/body.
 * Dealers may only trigger a fixed "new order" template (rate-limited).
 */
export async function POST(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const limited = rateLimit(
    `notify-staff:${session.id}`,
    10,
    15 * 60 * 1000
  );
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many notifications — try again later" },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
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

  let actor;
  try {
    ({ actor } = resolveCloudActor(db, session));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Session invalid" },
      { status: 401 }
    );
  }

  const canManage = userHasCapability(actor, "manage_orders");
  const staffActor = isStaffRole(actor.role);

  // Dealers may ping staff only with a fixed template (new estimate alerts).
  // Staff without manage_orders cannot broadcast at all.
  if (staffActor && !canManage) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const title = canManage
    ? (body.title || "TT Enterprises").slice(0, 80)
    : "New estimate order";
  const text = canManage
    ? (body.body || "New order activity").slice(0, 160)
    : "A dealer placed a new estimate — open Orders.";
  const url = canManage
    ? (body.url || "/en/admin/orders?filter=estimate").slice(0, 200)
    : "/en/admin/orders?filter=estimate";

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
