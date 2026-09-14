import { NextRequest, NextResponse } from "next/server";
import type { UserProfile } from "@/lib/types";
import {
  applyDealerFileActions,
  type DealerFileAction,
  type DealerFilePatch,
} from "@/lib/dealer-file";
import {
  listAllDealers,
  listPendingDealers,
  putCloudDbRetry,
  staffCanAccessDealers,
  staffCanApproveDealers,
} from "@/lib/server/dealer-review";
import { notifyDealerReviewServer } from "@/lib/server/whatsapp-notify";

function parseAction(raw: string | undefined): DealerFileAction | "" {
  if (
    raw === "approve" ||
    raw === "reject" ||
    raw === "revoke" ||
    raw === "restore" ||
    raw === "update"
  ) {
    return raw;
  }
  return "";
}

/** Live dealer directory from cloud — not the admin browser’s localStorage. */
export async function GET(req: NextRequest) {
  const auth = await staffCanAccessDealers(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const users = auth.db.users ?? [];
  return NextResponse.json({
    ok: true,
    users: listPendingDealers(users),
    dealers: listAllDealers(users, auth.db),
  });
}

/** Approve, reject, revoke, restore, or edit a dealer in cloud. */
export async function POST(req: NextRequest) {
  const auth = await staffCanApproveDealers(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: {
    userId?: string;
    userIds?: unknown;
    action?: string;
    reason?: string;
    patch?: DealerFilePatch;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ids = [
    ...new Set(
      (Array.isArray(body.userIds)
        ? body.userIds.map((id) => String(id ?? "").trim())
        : [String(body.userId || "").trim()]
      ).filter(Boolean),
    ),
  ];
  const action = parseAction(body.action);
  if (!ids.length || !action) {
    return NextResponse.json(
      {
        error:
          "userId (or userIds) and action (approve|reject|revoke|restore|update) required",
      },
      { status: 400 },
    );
  }
  if (action === "update" && ids.length !== 1) {
    return NextResponse.json(
      { error: "Update one dealer at a time" },
      { status: 400 },
    );
  }

  const reviewed: UserProfile[] = [];
  const put = await putCloudDbRetry((db) => {
    reviewed.length = 0;
    reviewed.push(
      ...applyDealerFileActions(db, auth.actor, {
        action,
        ids,
        reason: body.reason,
        patch: body.patch,
      }),
    );
  });

  if (!put.ok) {
    return NextResponse.json({ error: put.error }, { status: put.status });
  }
  if (!reviewed.length) {
    return NextResponse.json({ error: "Dealer not found" }, { status: 404 });
  }

  let waSent = false;
  if (reviewed.length === 1 && (action === "approve" || action === "reject")) {
    waSent = await notifyDealerReviewServer({
      user: reviewed[0],
      action,
      settings: put.db.settings,
    });
  }
  const first = reviewed[0];
  return NextResponse.json({
    ok: true,
    action,
    waSent,
    count: reviewed.length,
    user: {
      id: first.id,
      name: first.name,
      phone: first.phone,
      approved: first.approved,
      active: first.active,
    },
    users: listPendingDealers(put.db.users ?? []),
    dealers: listAllDealers(put.db.users ?? [], put.db),
  });
}
