import { NextRequest, NextResponse } from "next/server";
import {
  cloudGetAppDb,
  cloudPutAppDb,
  createServerSupabase,
} from "@/lib/server/app-db";
import { rateLimit } from "@/lib/server/rate-limit";
import { hashPasswordSecure } from "@/lib/server/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";
import {
  sendWebPushToSubs,
  staffWithCapability,
} from "@/lib/server/web-push";
import type { Locale, UserProfile } from "@/lib/types";

function normalizePhone(phone: string): string {
  return (phone || "").replace(/\D/g, "").slice(-10);
}

function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length === 10 && na === nb;
}

function clientKey(req: NextRequest, phone: string): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0]?.trim() || "unknown";
  return `reg:${ip}:${normalizePhone(phone)}`;
}

/** Public dealer self-registration → pending approval in cloud DB. */
export async function POST(req: NextRequest) {
  let body: {
    name?: string;
    password?: string;
    phone?: string;
    company?: string;
    address?: string;
    pincode?: string;
    gstOrAadhar?: string;
    transport?: string;
    locale?: string;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = (body.name || "").trim();
  const password = body.password || "";
  const phone = normalizePhone(body.phone || "");
  const pincode = (body.pincode || "").replace(/\D/g, "").slice(0, 6);
  const locale: Locale = body.locale === "hi" ? "hi" : "en";

  if (!name || password.length < 4) {
    return NextResponse.json(
      { error: "Name and password (min 4 chars) required" },
      { status: 400 }
    );
  }
  if (phone.length !== 10) {
    return NextResponse.json(
      { error: "Enter a valid 10-digit mobile number" },
      { status: 400 }
    );
  }
  if (pincode.length !== 6) {
    return NextResponse.json(
      { error: "Enter a valid 6-digit pincode" },
      { status: 400 }
    );
  }

  const limited = rateLimit(clientKey(req, phone), 5, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limited.retryAfterSec}s` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Registration unavailable — cloud DB not configured" },
      { status: 503 }
    );
  }

  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Registration unavailable" },
      { status: 503 }
    );
  }

  const { db, updatedAt, error } = await cloudGetAppDb(supabase);
  if (error || !db) {
    return NextResponse.json(
      { error: error || "Cloud database empty" },
      { status: 500 }
    );
  }

  if ((db.users ?? []).some((u) => phonesMatch(u.phone, phone))) {
    return NextResponse.json(
      { error: "This phone number is already registered" },
      { status: 409 }
    );
  }

  const user: UserProfile = {
    id: `user_${crypto.randomUUID()}`,
    passwordHash: hashPasswordSecure(password),
    name,
    phone,
    company: body.company?.trim(),
    address: body.address?.trim(),
    pincode,
    gstOrAadhar: body.gstOrAadhar?.trim(),
    transport: body.transport?.trim(),
    role: "customer",
    locale,
    walletBalance: 0,
    assignedSchemeIds: [],
    liftingProgressKg: 0,
    schemeProgress: {},
    active: true,
    approved: false,
    createdAt: new Date().toISOString(),
  };

  const partyName = (user.company?.trim() || user.name).trim();
  db.users = [...(db.users ?? []), user];
  db.parties = [
    ...(db.parties ?? []),
    {
      id: `party_${crypto.randomUUID()}`,
      name: partyName,
      phone: user.phone,
      type: "customer",
      linkedUserId: user.id,
      openingBalance: 0,
      address: user.address,
      pincode: user.pincode,
      gstin: user.gstOrAadhar,
      active: true,
      createdAt: new Date().toISOString(),
    },
  ];

  const cleaned = sanitizeDbForCloud(db);
  const result = await cloudPutAppDb(supabase, cleaned, updatedAt ?? null);
  if (result.conflict) {
    return NextResponse.json(
      { error: "Conflict — please retry registration" },
      { status: 409 }
    );
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Registration failed" },
      { status: 500 }
    );
  }

  await pushSignupToApprovers(db.users, user, locale);

  return NextResponse.json({ ok: true, pendingApproval: true });
}

/**
 * Nobody is logged in during signup, so this cannot go through
 * /api/push/notify-staff — it sends straight from the register handler.
 * Best-effort: a failed push must never fail the registration.
 */
async function pushSignupToApprovers(
  users: UserProfile[],
  dealer: UserProfile,
  locale: Locale
): Promise<void> {
  try {
    const approvers = staffWithCapability(users, "manage_users").filter(
      (u) => u.id !== dealer.id
    );
    if (!approvers.length) return;
    const where = dealer.company?.trim() || dealer.phone;
    await Promise.all(
      approvers.map((u) =>
        sendWebPushToSubs(u.pushSubscriptions, {
          title: locale === "hi" ? "नया डीलर — मंज़ूरी बाकी" : "New dealer — approval pending",
          body: `${dealer.name} · ${where}`,
          url: `/${locale}/admin/users`,
        })
      )
    );
  } catch (err) {
    console.warn("[push] dealer signup notify failed", err);
  }
}
