import { NextRequest, NextResponse } from "next/server";
import { cloudGetAppDb, cloudPutAppDb } from "@/lib/server/app-db";
import {
  applyOwnPassword,
  readNewPassword,
} from "@/lib/server/account-passwords";
import { liveSessionUser } from "@/lib/server/live-login";
import { rateLimit } from "@/lib/server/rate-limit";
import { readSessionCookie, verifyPassword } from "@/lib/server/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";

function clientKey(req: NextRequest, userId: string): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0]?.trim() || "unknown";
  return `pwchange:${ip}:${userId}`;
}

/** Logged-in user changes their own password. */
export async function POST(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session) {
    return NextResponse.json(
      { error: "Login required — please log in again" },
      { status: 401 },
    );
  }

  let body: { currentPassword?: string; newPassword?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const current = String(body.currentPassword || "");
  const next = readNewPassword(body.newPassword);
  if (!current) {
    return NextResponse.json(
      { error: "Current password is required" },
      { status: 400 },
    );
  }
  if (!next) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 },
    );
  }

  const limited = rateLimit(clientKey(req, session.id), 8, 15 * 60 * 1000);
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
      { error: "Cloud database not configured" },
      { status: 503 },
    );
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const { db, updatedAt, error } = await cloudGetAppDb();
    if (error) {
      return NextResponse.json({ error }, { status: 500 });
    }
    if (!db) {
      return NextResponse.json(
        { error: "Cloud database is empty" },
        { status: 503 },
      );
    }

    const user = liveSessionUser(db, session.id);
    if (!user) {
      return NextResponse.json(
        { error: "Account not found or disabled" },
        { status: 403 },
      );
    }
    if (!verifyPassword(current, user.passwordHash)) {
      return NextResponse.json(
        { error: "Current password is incorrect" },
        { status: 401 },
      );
    }

    applyOwnPassword(user, next);
    const result = await cloudPutAppDb(
      sanitizeDbForCloud(db),
      updatedAt ?? null,
    );
    if (result.conflict) continue;
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Could not save password" },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json(
    {
      error: "Could not save — another device updated the database. Try again.",
    },
    { status: 409 },
  );
}
