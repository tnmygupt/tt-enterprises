import { NextRequest, NextResponse } from "next/server";
import { cloudGetAppDb, cloudPutAppDb } from "@/lib/server/app-db";
import { shouldNotifyForgotAgain } from "@/lib/server/account-passwords";
import { capabilityContextFrom } from "@/lib/capabilities";
import { liveLoginUser } from "@/lib/server/live-login";
import { rateLimit } from "@/lib/server/rate-limit";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";
import { sendWebPushToSubs, staffWithCapability } from "@/lib/server/web-push";
import {
  notifyStaffPasswordResetRequest,
  notifyUserPasswordResetAck,
} from "@/lib/server/whatsapp-notify";
import type { AppDatabase } from "@/lib/store/db";
import type { Locale, UserProfile } from "@/lib/types";

function normalizePhone(phone: string): string {
  return (phone || "").replace(/\D/g, "").slice(-10);
}

function clientKey(req: NextRequest, phone: string): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0]?.trim() || "unknown";
  return `forgot:${ip}:${phone}`;
}

const GENERIC_OK = { ok: true as const };

/** Public forgot-password request — office sets a new password. */
export async function POST(req: NextRequest) {
  let body: { phone?: string; locale?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const phone = normalizePhone(body.phone || "");
  const locale: Locale = body.locale === "hi" ? "hi" : "en";
  if (phone.length !== 10) {
    return NextResponse.json(
      { error: "Enter a valid 10-digit mobile number" },
      { status: 400 },
    );
  }

  const limited = rateLimit(clientKey(req, phone), 4, 60 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limited.retryAfterSec}s` },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Request unavailable — cloud DB not configured" },
      { status: 503 },
    );
  }
  let recorded: UserProfile | null = null;
  let notify = false;
  let dbForNotify: AppDatabase | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const { db, updatedAt, error } = await cloudGetAppDb();
    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
    if (!db) {
      return NextResponse.json(GENERIC_OK);
    }

    const user = liveLoginUser(db, phone);
    if (!user) {
      return NextResponse.json(GENERIC_OK);
    }

    notify = shouldNotifyForgotAgain(user.passwordResetRequestedAt);
    user.passwordResetRequestedAt = new Date().toISOString();
    recorded = user;

    const result = await cloudPutAppDb(
      sanitizeDbForCloud(db),
      updatedAt ?? null,
    );
    if (result.conflict) continue;
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Could not save request" },
        { status: 500 },
      );
    }
    dbForNotify = db;
    break;
  }

  if (recorded && !dbForNotify) {
    return NextResponse.json(
      {
        error:
          "Could not save — another device updated the database. Try again.",
      },
      { status: 409 },
    );
  }

  if (recorded && dbForNotify && notify) {
    const db = dbForNotify;
    try {
      await notifyStaffPasswordResetRequest({
        users: db.users ?? [],
        requester: recorded,
        companyName: db.settings?.companyName,
        locale,
        countryCode: db.settings?.whatsappCountryCode,
        enabled: db.settings?.whatsappNotifyEnabled,
        capabilityContext: capabilityContextFrom(db),
      });
    } catch (err) {
      console.warn("[whatsapp] password reset staff notify failed", err);
    }
    try {
      await notifyUserPasswordResetAck({
        user: recorded,
        settings: db.settings,
      });
    } catch (err) {
      console.warn("[whatsapp] password reset ack failed", err);
    }
    try {
      const approvers = staffWithCapability(
        db.users ?? [],
        "manage_users",
        capabilityContextFrom(db),
      ).filter((u) => u.id !== recorded.id);
      const where = recorded.company?.trim() || recorded.phone;
      await Promise.all(
        approvers.map((u) =>
          sendWebPushToSubs(u.pushSubscriptions, {
            title:
              locale === "hi"
                ? "पासवर्ड रीसेट अनुरोध"
                : "Password reset request",
            body: `${recorded.name} · ${where}`,
            url: `/${locale}/admin/users`,
          }),
        ),
      );
    } catch (err) {
      console.warn("[push] password reset notify failed", err);
    }
  }

  return NextResponse.json(GENERIC_OK);
}
