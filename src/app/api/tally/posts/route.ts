import { NextRequest, NextResponse } from "next/server";
import {
  authorizeTallySync,
  filterPosts,
  loadCloudDb,
} from "@/lib/server/tally-posts";

/**
 * Bridge pulls pending (or filtered) Tally Sales/Receipt posts.
 * Auth: x-tally-sync-key (same as stock sync).
 */
export async function GET(req: NextRequest) {
  if (!authorizeTallySync(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { db, error, status } = await loadCloudDb();
  if (!db) {
    return NextResponse.json(
      { error: error || "Unavailable" },
      { status: status || 500 }
    );
  }

  const statusFilter = req.nextUrl.searchParams.get("status") || "pending";
  const posts = filterPosts(db.tallyPosts ?? [], statusFilter);

  return NextResponse.json({
    ok: true,
    status: statusFilter,
    count: posts.length,
    posts,
  });
}
