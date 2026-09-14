import { NextRequest, NextResponse } from "next/server";
import {
  applyDeleteLogin,
  listAllDealers,
  listPendingDealers,
  putCloudDbRetry,
  staffCanManageUsers,
} from "@/lib/server/dealer-review";
import { readSessionCookie } from "@/lib/server/session";

/** Staff force-delete a login in cloud so Admin Users poll cannot resurrect it. */
export async function POST(req: NextRequest) {
  const auth = await staffCanManageUsers(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const session = readSessionCookie(req);
  if (!session) {
    return NextResponse.json({ error: "Login required" }, { status: 401 });
  }

  let body: { userId?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const userId = (body.userId || "").trim();
  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }

  const put = await putCloudDbRetry((db) => {
    applyDeleteLogin(db, userId, session.id);
  });
  if (!put.ok) {
    return NextResponse.json({ error: put.error }, { status: put.status });
  }

  return NextResponse.json({
    ok: true,
    users: listPendingDealers(put.db.users ?? []),
    dealers: listAllDealers(put.db.users ?? [], put.db),
  });
}
