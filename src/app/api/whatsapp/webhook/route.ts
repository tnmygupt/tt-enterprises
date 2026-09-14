import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/rate-limit";
import {
  authorizeMetaVerify,
  authorizeWhatsAppWebhook,
} from "@/lib/server/whatsapp-webhook-auth";

export const runtime = "nodejs";

function clientIp(req: NextRequest): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  return fwd.split(",")[0]?.trim() || "unknown";
}

/** Kept so an old Tally webhook URL does not 404; chats are not stored. */
export async function GET(req: NextRequest) {
  const challenge = authorizeMetaVerify(req);
  if (challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }
  return NextResponse.json({
    ok: true,
    service: "tt-enterprises-whatsapp-webhook",
  });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(`wa-hook:${clientIp(req)}`, 180, 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many webhook posts" },
      { status: 429 },
    );
  }

  let body: unknown = {};
  try {
    const raw = await req.text();
    if (raw.length > 8_000_000) {
      return NextResponse.json(
        { ok: false, error: "Payload too large" },
        { status: 413 },
      );
    }
    if (raw.trim()) body = JSON.parse(raw) as unknown;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  if (!authorizeWhatsAppWebhook(req, body)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  return NextResponse.json({ ok: true, stored: 0 });
}
