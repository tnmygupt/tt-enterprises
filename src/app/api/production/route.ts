import { NextRequest, NextResponse } from "next/server";
import type { AppDatabase } from "@/lib/store/db";
import { capabilityContextFrom, userHasCapability } from "@/lib/capabilities";
import type { CapabilitySubject } from "@/lib/capabilities";
import { resolveCloudActor } from "@/lib/server/authorize-db";
import { cloudGetAppDb, cloudPutAppDb } from "@/lib/server/app-db";
import { rateLimit } from "@/lib/server/rate-limit";
import { isStaffRole, readSessionCookie } from "@/lib/server/session";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { ensurePerpetualAccounting } from "@/lib/store/db";
import {
  cancelIssuedJobCardOn,
  completeJobCardOn,
  createJobCardOn,
  issueJobCardOn,
  orderJobMaterialsOn,
  upsertBomOn,
  type JobOutputInput,
} from "@/lib/production";

function cloneDb(db: AppDatabase): AppDatabase {
  return JSON.parse(JSON.stringify(db)) as AppDatabase;
}

function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status });
}

function canProduce(actor: CapabilitySubject, db: AppDatabase): boolean {
  const ctx = capabilityContextFrom(db);
  return (
    userHasCapability(actor, "manage_accounts", ctx) ||
    userHasCapability(actor, "manage_products", ctx) ||
    userHasCapability(actor, "manage_reorder", ctx)
  );
}

/**
 * Plant/accounts production mutations against the full cloud books.
 * Plant GET projections strip vouchers — issue/complete must not run locally.
 */
export async function POST(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session || !isStaffRole(session.role)) {
    return json({ error: "Unauthorized" }, 401);
  }
  const limited = rateLimit(`prod:${session.id}`, 40, 15 * 60 * 1000);
  if (!limited.ok) {
    return json({ error: "Too many requests" }, 429);
  }
  if (!isSupabaseConfigured()) {
    return json({ error: "Cloud unavailable" }, 503);
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const action = String(body.action || "");

  const attempt = async (baseUpdatedAt: string | null) => {
    const got = await cloudGetAppDb();
    if (got.error || !got.db) {
      return { error: got.error || "Cloud empty", status: 500 as const };
    }
    let actor;
    try {
      actor = resolveCloudActor(got.db, session);
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Session invalid",
        status: 401 as const,
      };
    }
    if (!canProduce(actor.actor, got.db)) {
      return { error: "Not allowed", status: 403 as const };
    }

    const db = cloneDb(got.db);
    ensurePerpetualAccounting(db);
    if (!db.boms) db.boms = [];
    if (!db.jobCards) db.jobCards = [];
    const createdBy = session.id;
    const prod = {
      ...db,
      boms: db.boms,
      jobCards: db.jobCards,
    };

    try {
      if (action === "upsertBom") {
        upsertBomOn(prod, {
          id: typeof body.id === "string" ? body.id : undefined,
          outputProductId: String(body.outputProductId || ""),
          outputVariationId: body.outputVariationId
            ? String(body.outputVariationId)
            : undefined,
          outputColorId: body.outputColorId
            ? String(body.outputColorId)
            : undefined,
          outputQty: Number(body.outputQty) || 0,
          lines: Array.isArray(body.lines)
            ? (body.lines as { productId: string; variationId?: string; colorId?: string; qty: number }[])
            : [],
          createdBy,
          active: body.active !== false,
        });
      } else if (action === "createJob") {
        createJobCardOn(prod, {
          date: String(body.date || new Date().toISOString().slice(0, 10)),
          createdBy,
          bomId: body.bomId ? String(body.bomId) : undefined,
          outputProductId: body.outputProductId
            ? String(body.outputProductId)
            : undefined,
          outputVariationId: body.outputVariationId
            ? String(body.outputVariationId)
            : undefined,
          outputColorId: body.outputColorId
            ? String(body.outputColorId)
            : undefined,
          plannedQty: Number(body.plannedQty) || 0,
          outputs: Array.isArray(body.outputs)
            ? (body.outputs as JobOutputInput[])
            : undefined,
          inputLines: Array.isArray(body.inputLines)
            ? (body.inputLines as {
                productId: string;
                variationId?: string;
                colorId?: string;
                qty: number;
                bundles: number;
              }[])
            : undefined,
        });
      } else if (action === "issue") {
        issueJobCardOn(prod, String(body.jobId || ""), createdBy);
      } else if (action === "complete") {
        completeJobCardOn(prod, {
          jobId: String(body.jobId || ""),
          actualQty:
            body.actualQty == null ? undefined : Number(body.actualQty) || 0,
          actuals: Array.isArray(body.actuals)
            ? (body.actuals as { id?: string; actualQty: number }[])
            : undefined,
          createdBy,
        });
      } else if (action === "materialOrder") {
        const ordered = orderJobMaterialsOn(
          prod,
          String(body.jobId || ""),
          createdBy
        );
        db.purchaseOrders = prod.purchaseOrders ?? db.purchaseOrders;
        const put = await cloudPutAppDb(
          sanitizeDbForCloud(db),
          baseUpdatedAt ?? got.updatedAt ?? null
        );
        if (put.conflict) {
          return { conflict: true as const, updatedAt: put.updatedAt };
        }
        if (!put.ok) {
          return { error: put.error || "Save failed", status: 500 as const };
        }
        return {
          ok: true as const,
          poNumbers: ordered.orders.map((p) => p.number),
          missingSupplier: ordered.missingSupplier,
        };
      } else if (action === "cancelIssue") {
        cancelIssuedJobCardOn(prod, String(body.jobId || ""), createdBy);
      } else {
        return { error: "Unknown action", status: 400 as const };
      }
    } catch (err) {
      return {
        error: err instanceof Error ? err.message : "Failed",
        status: 400 as const,
      };
    }

    db.boms = prod.boms;
    db.jobCards = prod.jobCards;
    const put = await cloudPutAppDb(
      sanitizeDbForCloud(db),
      baseUpdatedAt ?? got.updatedAt ?? null
    );
    if (put.conflict) {
      return { conflict: true as const, updatedAt: put.updatedAt };
    }
    if (!put.ok) {
      return { error: put.error || "Save failed", status: 500 as const };
    }
    return { ok: true as const };
  };

  let result = await attempt(null);
  if ("conflict" in result && result.conflict) {
    result = await attempt(result.updatedAt ?? null);
  }
  if ("ok" in result && result.ok) {
    return json(result);
  }
  if ("error" in result) {
    return json({ error: result.error }, result.status ?? 400);
  }
  return json({ error: "Conflict" }, 409);
}
