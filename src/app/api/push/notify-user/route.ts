import { NextRequest, NextResponse } from "next/server";
import { cloudGetAppDb, cloudPutAppDb } from "@/lib/server/app-db";
import { resolveCloudActor } from "@/lib/server/authorize-db";
import { rateLimit } from "@/lib/server/rate-limit";
import { isStaffRole, readSessionCookie } from "@/lib/server/session";
import {
  removePushEndpoint,
  sendWebPushToSubs,
  vapidConfigured,
} from "@/lib/server/web-push";
import { capabilityContextFrom, userHasCapability } from "@/lib/capabilities";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";

/**
 * Push to one user (dealer). Auth: cloud staff with manage_orders, or the target user themselves.
 */
export async function POST(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  const limited = rateLimit(`notify-user:${session.id}`, 20, 15 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "Too many notifications — try again later" },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  if (!vapidConfigured()) {
    return NextResponse.json(
      { ok: false, configured: false, error: "VAPID not configured" },
      { status: 503 },
    );
  }

  let body: {
    userId?: string;
    title?: string;
    body?: string;
    url?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = (body.userId || "").trim();
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, sent: 0, mode: "local_skip" });
  }
  const { db, updatedAt, error } = await cloudGetAppDb();
  if (error || !db) {
    return NextResponse.json(
      { error: error || "Cloud empty" },
      { status: 500 },
    );
  }

  let actor;
  try {
    ({ actor } = resolveCloudActor(db, session));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Session invalid" },
      { status: 401 },
    );
  }

  const self = actor.id === userId;
  const staffOk =
    isStaffRole(actor.role) &&
    userHasCapability(actor, "manage_orders", capabilityContextFrom(db));
  if (!self && !staffOk) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const title = (body.title || "TT Enterprises").slice(0, 80);
  const text = (body.body || "Order update").slice(0, 160);
  const url = (body.url || "/en/orders").slice(0, 200);

  const user = db.users.find((u) => u.id === userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { sent, deadEndpoints } = await sendWebPushToSubs(
    user.pushSubscriptions,
    { title, body: text, url },
  );

  if (deadEndpoints.length) {
    let next = user.pushSubscriptions;
    for (const ep of deadEndpoints) {
      next = removePushEndpoint(next, ep);
    }
    user.pushSubscriptions = next;
    await cloudPutAppDb(sanitizeDbForCloud(db), updatedAt ?? null);
  }

  return NextResponse.json({ ok: true, configured: true, sent });
}
