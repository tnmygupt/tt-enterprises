import { NextRequest, NextResponse } from "next/server";
import { cloudGetAppDb, cloudPutAppDb } from "@/lib/server/app-db";
import { readSessionCookie } from "@/lib/server/session";
import { mergePushSubscription, type PushSub } from "@/lib/server/web-push";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";

export async function POST(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  let body: { subscription?: PushSub };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sub = body.subscription;
  if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
    return NextResponse.json(
      { error: "Invalid push subscription" },
      { status: 400 },
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      ok: true,
      mode: "local_only",
      hint: "Cloud off — save subscription on device via client upsert",
    });
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const { db, updatedAt, error } = await cloudGetAppDb();
    if (error || !db) {
      return NextResponse.json(
        { error: error || "Cloud empty" },
        { status: 500 },
      );
    }
    const user = db.users.find((u) => u.id === session.id);
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }
    user.pushSubscriptions = mergePushSubscription(user.pushSubscriptions, sub);
    const put = await cloudPutAppDb(sanitizeDbForCloud(db), updatedAt ?? null);
    if (put.conflict) continue;
    if (!put.ok) {
      return NextResponse.json(
        { error: put.error || "Save failed" },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, mode: "cloud" });
  }

  return NextResponse.json({ error: "Conflict — retry" }, { status: 409 });
}
