import { NextRequest, NextResponse } from "next/server";
import {
  cloudGetAppDb,
  cloudPutAppDb,
  createServerSupabase,
} from "@/lib/server/app-db";
import {
  clearOrderHistoryKeepUsers,
  purgeOpsDataKeepCatalog,
} from "@/lib/purge-ops";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";
import { getDbApiKey, isSupabaseConfigured } from "@/lib/supabase/config";
import { getSessionSecret } from "@/lib/server/session";

/**
 * Admin purge.
 * Auth: x-tt-db-key + x-purge-token (SESSION_SECRET or UPLOAD_KEY)
 * Body:
 *  { confirm: "PURGE_OPS_KEEP_CATALOG", keepPhone: "6386685663" }
 *  { confirm: "CLEAR_ORDER_HISTORY" }  — orders only; keep users + stock
 */
export async function POST(req: NextRequest) {
  const dbKey = getDbApiKey();
  const gotKey =
    req.headers.get("x-tt-db-key") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (!dbKey || gotKey !== dbKey) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const purgeToken = (req.headers.get("x-purge-token") || "").trim();
  const allowed = [
    (process.env.SESSION_SECRET || "").trim(),
    (process.env.UPLOAD_KEY || "").trim(),
    getSessionSecret(),
  ].filter(Boolean);
  if (!purgeToken || !allowed.includes(purgeToken)) {
    return NextResponse.json({ error: "Invalid purge token" }, { status: 401 });
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  let body: { confirm?: string; keepPhone?: string };
  try {
    body = (await req.json()) as { confirm?: string; keepPhone?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const confirm = String(body.confirm || "").trim();
  if (
    confirm !== "PURGE_OPS_KEEP_CATALOG" &&
    confirm !== "CLEAR_ORDER_HISTORY"
  ) {
    return NextResponse.json(
      {
        error:
          'confirm must be "CLEAR_ORDER_HISTORY" or "PURGE_OPS_KEEP_CATALOG"',
      },
      { status: 400 }
    );
  }

  const supabase = createServerSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "Supabase not configured" },
      { status: 503 }
    );
  }

  const { db, updatedAt, error } = await cloudGetAppDb(supabase);
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  if (!db) {
    return NextResponse.json({ error: "Cloud DB empty" }, { status: 404 });
  }

  const { db: next, result } =
    confirm === "CLEAR_ORDER_HISTORY"
      ? clearOrderHistoryKeepUsers(db)
      : purgeOpsDataKeepCatalog(db, String(body.keepPhone || "").trim());
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }

  const put = await cloudPutAppDb(
    supabase,
    sanitizeDbForCloud(next),
    updatedAt
  );
  if (!put.ok) {
    return NextResponse.json(
      {
        error: put.conflict
          ? "Conflict — cloud changed; retry"
          : put.error || "Write failed",
        conflict: !!put.conflict,
      },
      { status: put.conflict ? 409 : 500 }
    );
  }

  return NextResponse.json({
    ...result,
    updatedAt: put.updatedAt,
    message:
      confirm === "CLEAR_ORDER_HISTORY"
        ? "Order history cleared. Users + products/stock kept. Hard-refresh all browsers."
        : "Ops data cleared. Products/stock kept. Reload all browsers (hard refresh) so local cache is replaced.",
  });
}
