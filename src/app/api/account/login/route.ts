import { NextRequest, NextResponse } from "next/server";
import { cloudGetAppDb } from "@/lib/server/app-db";
import { liveLoginUser, liveSessionUser } from "@/lib/server/live-login";
import { publicDatabaseMessage } from "@/lib/server/host-sql";
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

const NO_STORE = {
  "Cache-Control": "private, no-store, no-cache, must-revalidate",
  Pragma: "no-cache",
  Expires: "0",
} as const;

function json(
  data: unknown,
  status = 200,
  extra?: { cookie?: ReturnType<typeof sessionCookieOptions> }
): NextResponse {
  const res = NextResponse.json(data, { status, headers: NO_STORE });
  if (extra?.cookie) {
    res.cookies.set(extra.cookie.name, extra.cookie.value, extra.cookie);
  }
  return res;
}

function attachLiveCookie(
  req: NextRequest,
  session: {
    id: string;
    phone: string;
    email?: string;
    name: string;
    role: string;
    locale: "en" | "hi";
  }
) {
  return sessionCookieOptions(createSessionToken(session), req);
}

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
        : publicDatabaseMessage(raw);
    return json({ error: message }, 500);
  }
}

async function postLogin(req: NextRequest) {
  let body: { phone?: string; password?: string };
  try {
    body = (await req.json()) as { phone?: string; password?: string };
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const phone = (body.phone || "").trim();
  const password = body.password || "";
  if (!phone || !password) {
    return json({ error: "Phone and password required" }, 400);
  }

  // Cookie HMAC must work before we touch the password or cloud DB.
  try {
    getSessionSecret();
  } catch {
    return json({ error: "Server auth is misconfigured. Contact admin." }, 503);
  }

  const limited = rateLimit(clientKey(req, phone), 8, 15 * 60 * 1000);
  if (!limited.ok) {
    const res = json(
      { error: `Too many attempts. Try again in ${limited.retryAfterSec}s` },
      429
    );
    res.headers.set("Retry-After", String(limited.retryAfterSec));
    return res;
  }

  if (!isSupabaseConfigured()) {
    return json(
      { error: "Server auth unavailable — cloud DB not configured" },
      503
    );
  }
  const { db, error } = await cloudGetAppDb();
  if (error) {
    return json({ error: publicDatabaseMessage(error) }, 500);
  }
  if (!db?.users?.length) {
    return json({ error: "No users in cloud database" }, 503);
  }

  const user = liveLoginUser(db, phone);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return json({ error: "Invalid phone or password" }, 401);
  }
  if (!user.active) {
    return json(
      { error: "Account is disabled. Contact T T Enterprises." },
      403
    );
  }
  if (user.role === "customer" && user.approved !== true) {
    return json(
      {
        error:
          "Awaiting admin approval. You can login after T T Enterprises approves your account.",
      },
      403
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
  return json({ user: session }, 200, { cookie: attachLiveCookie(req, session) });
}

export async function GET(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session) {
    return json({ user: null }, 401);
  }

  const cookieUser = {
    id: session.id,
    phone: session.phone,
    email: session.email,
    name: session.name,
    role: session.role,
    locale: session.locale,
  };

  if (!isSupabaseConfigured()) {
    return json({ user: cookieUser }, 200, {
      cookie: attachLiveCookie(req, cookieUser),
    });
  }
  const { db, error } = await cloudGetAppDb();
  if (error || !db) {
    // Keep the cookie alive during a MySQL blip so staff are not kicked out.
    return json({ user: cookieUser }, 200, {
      cookie: attachLiveCookie(req, cookieUser),
    });
  }

  const user = liveSessionUser(db, session.id);
  if (!user) {
    return json(
      { user: null, error: "Account removed. Please log in again." },
      401,
      { cookie: clearSessionCookieOptions(req) }
    );
  }

  const live = {
    id: user.id,
    phone: user.phone,
    email: user.email,
    name: user.name,
    role: user.role,
    locale: (user.locale === "hi" ? "hi" : "en") as "en" | "hi",
  };
  return json({ user: live }, 200, { cookie: attachLiveCookie(req, live) });
}

export async function DELETE(req: NextRequest) {
  return json({ ok: true }, 200, { cookie: clearSessionCookieOptions(req) });
}
