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
  createServerSupabase,
} from "@/lib/server/app-db";
import {
  createSessionToken,
  isStaffRole,
  readSessionCookie,
  sessionCookieOptions,
} from "@/lib/server/session";
import { stripPrePurgeOps } from "@/lib/ops-purge";
import { getDbApiKey, isSupabaseConfigured } from "@/lib/supabase/config";

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
  if (!authorizeDbKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  // Cheap change probe — clients skip full pull when updatedAt matches.
  if (req.nextUrl.searchParams.get("probe") === "1") {
    const probe = await cloudGetAppDbUpdatedAt(supabase);
    if (probe.error) {
      return NextResponse.json({ error: probe.error }, { status: 500 });
    }
    return NextResponse.json({
      updatedAt: probe.updatedAt ?? null,
      probe: true,
    });
  }

  const { db, updatedAt, error } = await cloudGetAppDb(supabase);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  if (!db?.users && !db?.products) {
    return new NextResponse(null, { status: 204 });
  }
  if (!db) {
    return new NextResponse(null, { status: 204 });
  }

  // Never serve pre-purge order history (stale sync may still sit in storage)
  const clean = stripPrePurgeOps(db);
  const storageDirty =
    (db.orders?.length ?? 0) !== (clean.orders?.length ?? 0) ||
    (db.walletTransactions?.length ?? 0) !==
      (clean.walletTransactions?.length ?? 0) ||
    (db.stockMovements?.length ?? 0) !== (clean.stockMovements?.length ?? 0);

  const session = readSessionCookie(req);
  let serveUpdatedAt = updatedAt;

  // Owner GET persists strip once so every tab does not race to push cleanup
  if (storageDirty && session) {
    try {
      const { role } = resolveCloudActor(db, session);
      if (role === "super_admin") {
        const put = await cloudPutAppDb(supabase, clean, updatedAt ?? null);
        if (put.ok && put.updatedAt) serveUpdatedAt = put.updatedAt;
      }
    } catch {
      /* ignore — still serve cleaned projection */
    }
  }

  if (!session) {
    return NextResponse.json({
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
        NextResponse.json({
          updatedAt: serveUpdatedAt,
          db: staffScopedProjection(clean, actor),
          scope: role === "super_admin" ? "owner" : "staff",
          role,
        })
      );
    }
    return attachCookie(
      NextResponse.json({
        updatedAt: serveUpdatedAt,
        db: dealerScopedProjection(clean, { ...session, role }),
        scope: "dealer",
        role,
      })
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Session invalid" },
      { status: 401 }
    );
  }
}

/** Reject oversized pushes before parsing — the doc is JSON without media blobs. */
const MAX_PUT_BYTES = 25 * 1024 * 1024;

/** Push — owner full doc; staff capability merge; customers own-slice. */
export async function PUT(req: NextRequest) {
  if (!authorizeDbKey(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const declaredLength = Number(req.headers.get("content-length") || 0);
  if (declaredLength > MAX_PUT_BYTES) {
    return NextResponse.json(
      { error: "Payload too large" },
      { status: 413 }
    );
  }
  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  const existing = await cloudGetAppDb(supabase);
  if (existing.error) {
    return NextResponse.json({ error: existing.error }, { status: 500 });
  }

  const session = readSessionCookie(req);
  const cloudHasUsers = Boolean(existing.db?.users?.length);
  if (!session && cloudHasUsers) {
    return NextResponse.json(
      { error: "Login required to sync changes" },
      { status: 401 }
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
        { status: 401 }
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
      boundSession
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Not allowed" },
      { status: 403 }
    );
  }

  const result = await cloudPutAppDb(
    supabase,
    mergeResult.db,
    body.baseUpdatedAt ?? null
  );

  if (result.conflict) {
    return NextResponse.json(
      {
        error: "Conflict — cloud was updated elsewhere. Reload and retry.",
        conflict: true,
        updatedAt: result.updatedAt,
      },
      { status: 409 }
    );
  }
  if (!result.ok) {
    return NextResponse.json(
      { error: result.error || "Save failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    updatedAt: result.updatedAt,
    rejectedOrders: mergeResult.rejectedOrders,
  });
}
