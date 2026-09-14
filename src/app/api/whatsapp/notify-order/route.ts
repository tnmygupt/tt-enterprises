import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/server/rate-limit";
import { isStaffRole, readSessionCookie } from "@/lib/server/session";
import { cloudGetAppDb } from "@/lib/server/app-db";
import { notifyCustomerOrderUpdateServer } from "@/lib/server/whatsapp-notify";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import type { OrderStatus } from "@/lib/types";

const STATUSES: OrderStatus[] = [
  "estimate",
  "confirmed",
  "payment_pending",
  "payment_verified",
  "dispatched",
  "delivered",
  "cancelled",
];

/**
 * Staff-triggered customer order WhatsApp. Text is built from the cloud
 * order — the client cannot pick a destination or invent the body.
 */
export async function POST(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session || !isStaffRole(session.role)) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 },
    );
  }

  const limited = rateLimit(`wa-order:${session.id}`, 30, 15 * 60 * 1000);
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
  let body: {
    orderId?: string;
    status?: string;
    extraNote?: string;
    locale?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 },
    );
  }

  const orderId = String(body.orderId || "").trim();
  const status = STATUSES.includes(body.status as OrderStatus)
    ? (body.status as OrderStatus)
    : null;
  if (!orderId || !status) {
    return NextResponse.json(
      { ok: false, error: "orderId and status required" },
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

  const order = (got.db.orders ?? []).find((o) => o.id === orderId);
  if (!order) {
    return NextResponse.json(
      { ok: false, error: "Order not found" },
      { status: 404 },
    );
  }

  const sent = await notifyCustomerOrderUpdateServer({
    order,
    status,
    settings: got.db.settings,
    locale: body.locale === "hi" ? "hi" : "en",
    extraNote: String(body.extraNote || "").slice(0, 400) || undefined,
  });

  return NextResponse.json({ ok: true, sent });
}
