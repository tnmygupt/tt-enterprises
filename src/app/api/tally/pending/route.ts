import { NextRequest, NextResponse } from "next/server";
import { tallyKeyOk } from "@/lib/tally-sync";
import { cloudGetAppDb, isCloudDbConfigured } from "@/lib/server/app-db";

function authorize(req: NextRequest): boolean {
  const key =
    req.headers.get("x-tally-sync-key") || req.headers.get("x-tally-key");
  return tallyKeyOk(key, process.env.TALLY_SYNC_KEY);
}

/** Sales the local bridge should post into TallyPrime. */
export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isCloudDbConfigured()) {
    return NextResponse.json({ error: "Cloud unavailable" }, { status: 503 });
  }
  const got = await cloudGetAppDb();
  if (got.error || !got.db) {
    return NextResponse.json(
      { error: got.error || "Cloud empty" },
      { status: 500 }
    );
  }
  const posts = (got.db.tallyPosts ?? []).filter(
    (p) => p.kind === "sale" && (p.status === "pending" || p.status === "failed") && p.lastError !== "Order cancelled"
  );
  return NextResponse.json({
    ok: true,
    posts: posts.map((p) => ({
      remoteId: p.remoteId,
      kind: p.kind,
      orderId: p.orderId,
      orderNumber: p.orderNumber,
      partyName: p.partyName,
      partyPhone: p.partyPhone ?? "",
      partyGstin: p.partyGstin ?? "",
      amount: p.amount,
      date: p.date,
      narration: p.narration,
      lines: p.lines ?? [],
      status: p.status,
      attempts: p.attempts,
      lastError: p.lastError ?? "",
    })),
  });
}
