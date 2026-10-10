import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/rate-limit";
import { readSessionCookie } from "@/lib/server/session";
import { cloudGetAppDb } from "@/lib/server/app-db";
import { notifyStaffWhatsAppServer } from "@/lib/server/whatsapp-notify";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { capabilityContextFrom } from "@/lib/capabilities";
import type { Capability } from "@/lib/types";

const CLIENT_CAPABILITIES = new Set<Capability>(["view_financials"]);

/**
 * Send one staff-broadcast WhatsApp. Any logged-in user may trigger it
 * (dealer new order / payment proof). Recipients are always cloud staff
 * phones — the client cannot pick a destination number.
 */
export async function POST(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const limited = rateLimit(`wa-staff:${session.id}`, 20, 15 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `Too many messages. Try again in ${limited.retryAfterSec}s`,
      },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { ok: false, error: "Cloud unavailable" },
      { status: 503 },
    );
  }
  let body: { text?: string; skipUserIds?: string[]; capability?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }
  const text = (body.text || "").trim();
  if (text.length < 8 || text.length > 2000) {
    return NextResponse.json(
      { ok: false, error: "Invalid text" },
      { status: 400 },
    );
  }

  const got = await cloudGetAppDb();
  if (got.error || !got.db) {
    return NextResponse.json(
      { ok: false, error: got.error || "Cloud empty" },
      { status: 500 },
    );
  }

  const skip = new Set(body.skipUserIds ?? []);
  skip.add(session.id);
  const capability = CLIENT_CAPABILITIES.has(body.capability as Capability)
    ? (body.capability as Capability)
    : undefined;
  const sent = await notifyStaffWhatsAppServer({
    users: got.db.users ?? [],
    capability,
    capabilityContext: capabilityContextFrom(got.db),
    text,
    countryCode: got.db.settings?.whatsappCountryCode,
    skipUserIds: [...skip],
    enabled: got.db.settings?.whatsappNotifyEnabled,
  });

  return NextResponse.json({ ok: true, sent });
}
