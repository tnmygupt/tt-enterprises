import { NextRequest, NextResponse } from "next/server";
import type { AppDatabase } from "@/lib/store/db";
import {
  dealerScopedProjection,
  mergeAuthorizedPush,
  publicCatalogProjection,
  resolveCloudActor,
  staffScopedProjection,
} from "@/lib/server/authorize-db";
import {
  cloudGetAppDb,
  cloudGetAppDbUpdatedAt,
  cloudPutAppDb,
} from "@/lib/server/app-db";
import {
  createSessionToken,
  isStaffRole,
  readSessionCookie,
  sessionCookieOptions,
} from "@/lib/server/session";
import { stripPrePurgeOps } from "@/lib/ops-purge";
import { getDbApiKey, isSupabaseConfigured } from "@/lib/supabase/config";
import { getRealtimePublicConfig } from "@/lib/supabase/live";
import { notifyStaffNewEstimateServer } from "@/lib/server/whatsapp-notify";

function jsonNoStore(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: {
      "Cache-Control": "private, no-store, no-cache, must-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      Vary: "Cookie, x-tt-db-key",
    },
  });
}

function authorizeDbKey(req: Request): boolean {
  const required = getDbApiKey();
  if (!required) {
    if (process.env.NODE_ENV === "production") return false;
    return true;
  }
  const got =
    req.headers.get("x-tt-db-key") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  return got === required;
}

/** Pull DB — public catalog / dealer scope / staff capability scope. */
export async function GET(req: NextRequest) {
  // GET does not require x-tt-db-key. That header is baked into the public
  // JS bundle anyway; when NEXT_PUBLIC_DB_API_KEY is missing from a Hostinger
  // build the whole shop 401'd (empty catalog, empty admin orders).
  // Session cookie still decides public vs dealer vs staff. PUT still requires the key.
  if (!isSupabaseConfigured()) {
    return jsonNoStore({ error: "Cloud database not configured" }, 503);
  }

  // Cheap change probe — clients skip full pull when updatedAt matches.
  if (req.nextUrl.searchParams.get("probe") === "1") {
    const probe = await cloudGetAppDbUpdatedAt();
    if (probe.error) {
      return jsonNoStore({ error: probe.error }, 500);
    }
    const session = readSessionCookie(req);
    return jsonNoStore({
      updatedAt: probe.updatedAt ?? null,
      probe: true,
      live:
        session && isStaffRole(session.role) ? getRealtimePublicConfig() : null,
    });
  }

  const { db, updatedAt, error } = await cloudGetAppDb();
  if (error) {
    return jsonNoStore({ error }, 500);
  }
  if (!db?.users && !db?.products) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie, x-tt-db-key",
      },
    });
  }
  if (!db) {
    return new NextResponse(null, {
      status: 204,
      headers: {
        "Cache-Control": "private, no-store",
        Vary: "Cookie, x-tt-db-key",
      },
    });
  }

  // Never serve pre-purge order history (stale sync may still sit in storage)
  const clean = stripPrePurgeOps(db);

  const session = readSessionCookie(req);
  const serveUpdatedAt = updatedAt;

  if (!session) {
    return jsonNoStore({
      updatedAt: serveUpdatedAt,
      db: publicCatalogProjection(clean),
      scope: "public",
    });
  }

  try {
    const { actor, role } = resolveCloudActor(clean, session);
    // Refresh the signed cookie from cloud truth so demotions take effect
    // without waiting for the full TTL (and renew while active).
    const needsCookieRefresh =
      session.role !== role ||
      session.name !== actor.name ||
      session.phone !== actor.phone;
    const attachCookie = (res: NextResponse) => {
      if (!needsCookieRefresh && session.role === role) {
        // Still renew periodically when role matches so active users stay signed in
        // with the shorter TTL — refresh when under 12h remaining.
        const remaining = session.exp - Math.floor(Date.now() / 1000);
        if (remaining > 12 * 60 * 60) return res;
      }
      const token = createSessionToken({
        id: actor.id,
        phone: actor.phone,
        email: actor.email,
        name: actor.name,
        role,
        locale: actor.locale === "hi" ? "hi" : "en",
      });
      const cookie = sessionCookieOptions(token);
      res.cookies.set(cookie.name, cookie.value, cookie);
      return res;
    };

    if (isStaffRole(role)) {
      return attachCookie(
        jsonNoStore({
          updatedAt: serveUpdatedAt,
          db: staffScopedProjection(clean, actor),
          scope: role === "super_admin" ? "owner" : "staff",
          role,
        }),
      );
    }
    return attachCookie(
      jsonNoStore({
        updatedAt: serveUpdatedAt,
        db: dealerScopedProjection(clean, { ...session, role }),
        scope: "dealer",
        role,
      }),
    );
  } catch (err) {
    return jsonNoStore(
      { error: err instanceof Error ? err.message : "Session invalid" },
      401,
    );
  }
}

/** Reject oversized pushes before parsing — the doc is JSON without media blobs. */
const MAX_PUT_BYTES = 25 * 1024 * 1024;

/** Push — owner full doc; staff capability merge; customers own-slice. */
export async function PUT(req: NextRequest) {
  // Shared key is optional when a login cookie is present. Hostinger builds
  // often omit NEXT_PUBLIC_DB_API_KEY (live detect: hasPublicKey false),
  // which 401'd every staff save. Session still authorizes the merge below.
  const keyOk = authorizeDbKey(req);
  const earlySession = readSessionCookie(req);
  if (!keyOk && !earlySession) {
    return NextResponse.json(
      { error: "Login required to sync — please log in again" },
      { status: 401 },
    );
  }

  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_PUT_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Cloud database not configured" },
      { status: 503 },
    );
  }

  const existing = await cloudGetAppDb();
  if (existing.error) {
    return NextResponse.json({ error: existing.error }, { status: 500 });
  }

  const session = readSessionCookie(req);
  const cloudHasUsers = Boolean(existing.db?.users?.length);
  if (!session && cloudHasUsers) {
    return NextResponse.json(
      { error: "Login required to sync changes" },
      { status: 401 },
    );
  }

  // Rebind role from cloud before authorize
  let boundSession = session;
  if (session && existing.db) {
    try {
      const { role } = resolveCloudActor(existing.db, session);
      boundSession = { ...session, role };
    } catch (err) {
      return NextResponse.json(
        { error: err instanceof Error ? err.message : "Session invalid" },
        { status: 401 },
      );
    }
  }

  let body: { db?: unknown; baseUpdatedAt?: string | null };
  try {
    const raw = await req.text();
    if (raw.length > MAX_PUT_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    body = JSON.parse(raw) as {
      db?: unknown;
      baseUpdatedAt?: string | null;
    };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body?.db || typeof body.db !== "object") {
    return NextResponse.json({ error: "Missing db" }, { status: 400 });
  }

  let mergeResult: ReturnType<typeof mergeAuthorizedPush>;
  try {
    mergeResult = mergeAuthorizedPush(
      body.db as AppDatabase,
      existing.db,
      boundSession,
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Not allowed" },
      { status: 403 },
    );
  }

  const result = await cloudPutAppDb(
    mergeResult.db,
    body.baseUpdatedAt ?? null,
  );

  if (result.conflict) {
    return NextResponse.json(
      {
        error: "Conflict — cloud was updated elsewhere. Reload and retry.",
        conflict: true,
        updatedAt: result.updatedAt,
      },
      { status: 409 },
    );
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Save failed" },
      { status: 500 },
    );
  }

  if (boundSession?.role === "customer" && existing.db) {
    const prevIds = new Set((existing.db.orders ?? []).map((o) => o.id));
    const fresh = (mergeResult.db.orders ?? []).filter(
      (o) =>
        o.userId === boundSession.id &&
        o.status === "estimate" &&
        !prevIds.has(o.id),
    );
    if (fresh.length) {
      const db = mergeResult.db;
      void Promise.all(
        fresh.map((order) =>
          notifyStaffNewEstimateServer({
            users: db.users ?? [],
            order,
            companyName: db.settings?.companyName,
            locale: boundSession.locale === "hi" ? "hi" : "en",
            countryCode: db.settings?.whatsappCountryCode,
            enabled: db.settings?.whatsappNotifyEnabled,
            settings: db.settings,
          }),
        ),
      ).catch(() => undefined);
    }
  }

  return NextResponse.json({
    ok: true,
    updatedAt: result.updatedAt,
    rejectedOrders: mergeResult.rejectedOrders,
  });
}
