import { NextRequest, NextResponse } from "next/server";
import {
  authorizeTallySync,
  loadCloudDb,
  saveCloudDb,
} from "@/lib/server/tally-posts";

/**
 * Bridge acknowledges a Tally import attempt.
 * Body: { id: string, ok: boolean, error?: string }
 */
export async function POST(req: NextRequest) {
  if (!authorizeTallySync(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { id?: string; ok?: boolean; error?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const id = typeof body.id === "string" ? body.id.trim() : "";
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (typeof body.ok !== "boolean") {
    return NextResponse.json({ error: "ok boolean required" }, { status: 400 });
  }

  for (let attempt = 0; attempt < 3; attempt++) {
    const { db, updatedAt, error, status } = await loadCloudDb();
    if (!db) {
      return NextResponse.json(
        { error: error || "Unavailable" },
        { status: status || 500 }
      );
    }

    if (!db.tallyPosts) db.tallyPosts = [];
    const post = db.tallyPosts.find((p) => p.id === id);
    if (!post) {
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    }

    post.attempts = (post.attempts || 0) + 1;
    if (body.ok) {
      post.status = "posted";
      post.postedAt = new Date().toISOString();
      post.lastError = undefined;
    } else {
      post.status = "failed";
      post.lastError =
        typeof body.error === "string" && body.error.trim()
          ? body.error.trim().slice(0, 500)
          : "Import failed";
    }

    const saved = await saveCloudDb(db, updatedAt);
    if (saved.conflict) continue;
    if (!saved.ok) {
      return NextResponse.json(
        { error: saved.error || "Save failed" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      post: {
        id: post.id,
        status: post.status,
        attempts: post.attempts,
        lastError: post.lastError,
        postedAt: post.postedAt,
      },
    });
  }

  return NextResponse.json(
    { error: "Conflict — retry later" },
    { status: 409 }
  );
}
