import { NextRequest, NextResponse } from "next/server";
import {
  cloudGetAppDb,
  cloudPutAppDb,
  createServerSupabase,
} from "@/lib/server/app-db";
import { readSessionCookie, isStaffRole } from "@/lib/server/session";
import {
  removePushEndpoint,
  sendWebPushToSubs,
  vapidConfigured,
} from "@/lib/server/web-push";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";

/**
 * Push to one user (dealer). Auth: staff session, or the target user themselves.
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

  const allowed =
    session.id === userId || isStaffRole(session.role);
  if (!allowed) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const title = (body.title || "TT Enterprises").slice(0, 80);
  const text = (body.body || "Order update").slice(0, 160);
  const url = (body.url || "/en/orders").slice(0, 200);

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ ok: true, sent: 0, mode: "local_skip" });
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

  const user = db.users.find((u) => u.id === userId);
  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { sent, deadEndpoints } = await sendWebPushToSubs(
    user.pushSubscriptions,
    { title, body: text, url }
  );

  if (deadEndpoints.length) {
    let next = user.pushSubscriptions;
    for (const ep of deadEndpoints) {
      next = removePushEndpoint(next, ep);
    }
    user.pushSubscriptions = next;
    await cloudPutAppDb(supabase, sanitizeDbForCloud(db), updatedAt ?? null);
  }

  return NextResponse.json({ ok: true, configured: true, sent });
}
