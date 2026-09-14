import { NextRequest, NextResponse } from "next/server";
import { authorizeCron } from "@/lib/server/cron-auth";
import { runWhatsAppDigest } from "@/lib/server/whatsapp-digest";
import { cloudGetAppDb, cloudPutAppDb } from "@/lib/server/app-db";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";

/**
 * Weekly overdue / credit-limit / scheme-ending WhatsApp.
 * Auth: Authorization: Bearer CRON_SECRET (or ?secret=).
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

  const digest = await runWhatsAppDigest(db);

  if (digest.dirty) {
    const put = await cloudPutAppDb(sanitizeDbForCloud(db), updatedAt ?? null);
    if (!put.ok) {
      return NextResponse.json(
        { error: put.error || (put.conflict ? "Conflict" : "Save failed") },
        { status: put.conflict ? 409 : 500 },
      );
    }
  }

  return NextResponse.json({ ok: true, ...digest });
}

export async function GET(req: NextRequest) {
  return POST(req);
}
