import { NextRequest, NextResponse } from "next/server";
import { cloudGetAppDb } from "@/lib/server/app-db";
import { liveLoginUser, liveSessionUser } from "@/lib/server/live-login";
import { rateLimit } from "@/lib/server/rate-limit";
import {
  clearSessionCookieOptions,
  createSessionToken,
  getSessionSecret,
  readSessionCookie,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/server/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";

function clientKey(req: NextRequest, phone: string): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0]?.trim() || "unknown";
  return `${ip}:${phone.replace(/\D/g, "")}`;
}

export async function POST(req: NextRequest) {
  try {
    return await postLogin(req);
  } catch (err) {
    const raw = err instanceof Error ? err.message : "Login failed";
    const message =
      raw.includes("SESSION_SECRET") || raw.includes("TT_APP_DB_GATE")
        ? "Server auth is misconfigured. Contact admin."
        : raw;
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function postLogin(req: NextRequest) {
  let body: { phone?: string; password?: string };
  try {
    body = (await req.json()) as { phone?: string; password?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const phone = (body.phone || "").trim();
  const password = body.password || "";
  if (!phone || !password) {
    return NextResponse.json(
      { error: "Phone and password required" },
      { status: 400 }
    );
  }

  // Cookie HMAC must work before we touch the password or cloud DB.
  try {
    getSessionSecret();
  } catch {
    return NextResponse.json(
      { error: "Server auth is misconfigured. Contact admin." },
      { status: 503 }
    );
  }

  const limited = rateLimit(clientKey(req, phone), 8, 15 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limited.retryAfterSec}s` },
      { status: 429, headers: { "Retry-After": String(limited.retryAfterSec) } }
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Server auth unavailable — cloud DB not configured" },
      { status: 503 }
    );
  }
  const { db, error } = await cloudGetAppDb();
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  if (!db?.users?.length) {
    return NextResponse.json(
      { error: "No users in cloud database" },
      { status: 503 }
    );
  }

  const user = liveLoginUser(db, phone);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json(
      { error: "Invalid phone or password" },
      { status: 401 }
    );
  }
  if (!user.active) {
    return NextResponse.json(
      { error: "Account is disabled. Contact T T Enterprises." },
      { status: 403 }
    );
  }
  if (user.role === "customer" && user.approved !== true) {
    return NextResponse.json(
      {
        error:
          "Awaiting admin approval. You can login after T T Enterprises approves your account.",
      },
      { status: 403 }
    );
  }

  const session = {
    id: user.id,
    phone: user.phone,
    email: user.email,
    name: user.name,
    role: user.role,
    locale: (user.locale === "hi" ? "hi" : "en") as "en" | "hi",
  };
  const token = createSessionToken(session);
  const res = NextResponse.json({ user: session });
  const cookie = sessionCookieOptions(token);
  res.cookies.set(cookie.name, cookie.value, cookie);
  return res;
}

export async function GET(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session) {
    return NextResponse.json({ user: null }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({
      user: {
        id: session.id,
        phone: session.phone,
        email: session.email,
        name: session.name,
        role: session.role,
        locale: session.locale,
      },
    });
  }
  const { db, error } = await cloudGetAppDb();
  if (error || !db) {
    // Do not log everyone out on a transient cloud blip.
    return NextResponse.json({
      user: {
        id: session.id,
        phone: session.phone,
        email: session.email,
        name: session.name,
        role: session.role,
        locale: session.locale,
      },
    });
  }

  const user = liveSessionUser(db, session.id);
  if (!user) {
    const res = NextResponse.json(
      { user: null, error: "Account removed. Please log in again." },
      { status: 401 }
    );
    const cookie = clearSessionCookieOptions();
    res.cookies.set(cookie.name, cookie.value, cookie);
    return res;
  }

  return NextResponse.json({
    user: {
      id: user.id,
      phone: user.phone,
      email: user.email,
      name: user.name,
      role: user.role,
      locale: (user.locale === "hi" ? "hi" : "en") as "en" | "hi",
    },
  });
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  const cookie = clearSessionCookieOptions();
  res.cookies.set(cookie.name, cookie.value, cookie);
  return res;
}
