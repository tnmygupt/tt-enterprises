import { NextRequest, NextResponse } from "next/server";
import { cloudGetAppDb, cloudPutAppDb } from "@/lib/server/app-db";
import {
  applyAdminResetPassword,
  readNewPassword,
} from "@/lib/server/account-passwords";
import { capabilityContextFrom, userHasCapability } from "@/lib/capabilities";
import { resolveCloudActor } from "@/lib/server/authorize-db";
import { readSessionCookie } from "@/lib/server/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";
import { tombsFromDb, userBeatsTomb } from "@/lib/user-tombs";

/** Admin sets a new password and can share it back. */
export async function POST(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session) {
    return NextResponse.json(
      { error: "Login required — please log in again" },
      { status: 401 },
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json(
      { error: "Cloud database not configured" },
      { status: 503 },
    );
  }
  let body: { userId?: string; newPassword?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = String(body.userId || "").trim();
  const next = readNewPassword(body.newPassword);
  if (!userId) {
    return NextResponse.json({ error: "User is required" }, { status: 400 });
  }
  if (!next) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 },
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

    let resolved;
    try {
      resolved = resolveCloudActor(db, session);
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Your session is invalid — log in again",
        },
        { status: 401 },
      );
    }

    if (
      !userHasCapability(
        resolved.actor,
        "manage_users",
        capabilityContextFrom(db),
      )
    ) {
      return NextResponse.json(
        { error: "Only admins can reset passwords" },
        { status: 403 },
      );
    }

    const tombs = tombsFromDb(db);
    const user = (db.users ?? []).find((u) => u.id === userId);
    if (!user || !userBeatsTomb(user, tombs)) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    applyAdminResetPassword(user, next);
    const cleaned = sanitizeDbForCloud(db);
    const result = await cloudPutAppDb(cleaned, updatedAt ?? null);
    if (result.conflict) continue;
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Could not save password" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        name: user.name,
        passwordVisible: next,
        passwordResetRequestedAt: undefined,
      },
    });
  }

  return NextResponse.json(
    {
      error: "Could not save — another device updated the database. Try again.",
    },
    { status: 409 },
  );
}
