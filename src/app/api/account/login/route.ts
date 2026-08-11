import { NextRequest, NextResponse } from "next/server";
import {
  cloudGetAppDb,
  cloudPutAppDb,
  createServerSupabase,
} from "@/lib/server/app-db";
import { rateLimit } from "@/lib/server/rate-limit";
import {
  clearSessionCookieOptions,
  createSessionToken,
  hashPasswordSecure,
  needsPasswordUpgrade,
  readSessionCookie,
  sessionCookieOptions,
  verifyPassword,
} from "@/lib/server/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";
import {
  appendAccessPlace,
  buildAccessPlace,
} from "@/lib/server/access-log";

function phonesMatch(a: string, b: string): boolean {
  const na = (a || "").replace(/\D/g, "").slice(-10);
  const nb = (b || "").replace(/\D/g, "").slice(-10);
  return na.length === 10 && na === nb;
}

function clientKey(req: NextRequest, phone: string): string {
  const fwd = req.headers.get("x-forwarded-for") || "";
  const ip = fwd.split(",")[0]?.trim() || "unknown";
  return `${ip}:${phone.replace(/\D/g, "")}`;
}

export async function POST(req: NextRequest) {
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

  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Server auth unavailable" },
      { status: 503 }
    );
  }

  const { db, updatedAt, error } = await cloudGetAppDb(supabase);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  if (!db?.users?.length) {
    return NextResponse.json(
      { error: "No users in cloud database" },
      { status: 503 }
    );
  }

  const user = db.users.find((u) => phonesMatch(u.phone, phone));
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json(
      { error: "Invalid phone or password" },
      { status: 401 }
    );
  }
  if (!user.active) {
    return NextResponse.json(
      { error: "Account is disabled. Contact admin." },
      { status: 403 }
    );
  }
  if (user.role === "customer" && !user.approved) {
    return NextResponse.json(
      {
        error:
          "Awaiting admin approval. You can login after T T Enterprises approves your account.",
      },
      { status: 403 }
    );
  }

  // Upgrade legacy demo_* hashes to scrypt on successful login
  if (needsPasswordUpgrade(user.passwordHash)) {
    user.passwordHash = hashPasswordSecure(password);
    delete (user as { passwordVisible?: string }).passwordVisible;
  }

  try {
    const place = await buildAccessPlace({
      headers: req.headers,
      source: "login",
      user,
    });
    appendAccessPlace(db, place);
  } catch {
    /* analytics must never block login */
  }

  const cleaned = sanitizeDbForCloud(db);
  await cloudPutAppDb(supabase, cleaned, updatedAt ?? null);

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

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  const cookie = clearSessionCookieOptions();
  res.cookies.set(cookie.name, cookie.value, cookie);
  return res;
}
