import { NextRequest, NextResponse } from "next/server";
import { ackTallyPost, applyTallyAvailability, tallyKeyOk } from "@/lib/tally-sync";
import { withTallyDb } from "@/lib/server/tally-store";

function authorize(req: NextRequest): boolean {
  return tallyKeyOk(
    req.headers.get("x-tally-sync-key"),
    process.env.TALLY_SYNC_KEY
  );
}

type AckBody = {
  remoteId?: string;
  status?: string;
  error?: string;
};

/**
 * Bridge callback after Tally accepts or rejects a queued sale.
 * Posted sales stop reserving website stock.
 */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: AckBody;
  try {
    body = (await req.json()) as AckBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const remoteId = (body.remoteId || "").trim();
  const status = body.status === "posted" ? "posted" : body.status === "failed" ? "failed" : "";
  if (!remoteId || !status) {
    return NextResponse.json(
      { error: "Expected { remoteId, status: 'posted' | 'failed', error? }" },
      { status: 400 }
    );
  }

  const saved = await withTallyDb((db) => {
    const post = ackTallyPost(db, remoteId, status, body.error);
    if (!post) throw new Error("Unknown remoteId");
    applyTallyAvailability(db);
    return { remoteId: post.remoteId, status: post.status };
  });
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: saved.status });
  }
  return NextResponse.json({ ok: true, ...saved.value });
}
