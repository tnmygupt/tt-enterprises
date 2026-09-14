import { NextRequest, NextResponse } from "next/server";
import type { AppDatabase } from "@/lib/store/db";
import { placeEstimateOnDatabase } from "@/lib/place-estimate";
import { capabilityContextFrom, userHasCapability } from "@/lib/capabilities";
import { resolveCloudActor } from "@/lib/server/authorize-db";
import { cloudGetAppDb, cloudPutAppDb } from "@/lib/server/app-db";
import { rateLimit } from "@/lib/server/rate-limit";
import { isStaffRole, readSessionCookie } from "@/lib/server/session";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import {
  notifyCustomerOrderUpdateServer,
  notifyStaffNewEstimateServer,
} from "@/lib/server/whatsapp-notify";
import type { CartItem, Locale, Order } from "@/lib/types";

function cloneDb(db: AppDatabase): AppDatabase {
  return JSON.parse(JSON.stringify(db)) as AppDatabase;
}

function sanitizeCart(raw: unknown): CartItem[] {
  if (!Array.isArray(raw)) return [];
  const out: CartItem[] = [];
  for (const item of raw.slice(0, 80)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Partial<CartItem>;
    const productId = String(row.productId || "").slice(0, 80);
    if (!productId) continue;
    const quantity = Math.max(
      0,
      Math.min(999, Math.round(Number(row.quantity) || 0)),
    );
    if (!(quantity > 0)) continue;
    out.push({
      key: String(
        row.key || `${productId}:${row.variationId || ""}:${row.colorId || ""}`,
      ).slice(0, 120),
      productId,
      variationId: row.variationId
        ? String(row.variationId).slice(0, 80)
        : undefined,
      colorId: row.colorId ? String(row.colorId).slice(0, 80) : undefined,
      quantity,
      weightKg: Math.max(0, Number(row.weightKg) || 0),
    });
  }
  return out;
}

/**
 * Place an estimate against cloud stock and notify staff WhatsApp.
 * Dealers can only order for themselves. Staff with manage_orders may punch
 * for a dealer by passing that dealer's userId.
 */
export async function POST(req: NextRequest) {
  const session = readSessionCookie(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const limited = rateLimit(`est:${session.id}`, 12, 15 * 60 * 1000);
  if (!limited.ok) {
    return NextResponse.json(
      { error: `Too many orders. Try again in ${limited.retryAfterSec}s` },
      {
        status: 429,
        headers: { "Retry-After": String(limited.retryAfterSec) },
      },
    );
  }

  if (!isSupabaseConfigured()) {
    return NextResponse.json({ error: "Cloud unavailable" }, { status: 503 });
  }
  let body: {
    userId?: string;
    cart?: unknown;
    deliveryAddress?: string;
    customerNotes?: string;
    checkoutName?: string;
    gstOrAadhar?: string;
    phone?: string;
    transport?: string;
    walletToUse?: number;
    fullTruckRequested?: boolean;
    locale?: string;
    manualDiscountKind?: "percent" | "flat";
    manualDiscountValue?: number;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const cart = sanitizeCart(body.cart);
  const deliveryAddress = String(body.deliveryAddress || "")
    .trim()
    .slice(0, 500);
  const checkoutName = String(body.checkoutName || "")
    .trim()
    .slice(0, 120);
  const phone = String(body.phone || "")
    .replace(/\D/g, "")
    .slice(0, 15);
  if (!cart.length) {
    return NextResponse.json({ error: "Cart is empty" }, { status: 400 });
  }
  if (!deliveryAddress || !checkoutName || phone.length < 8) {
    return NextResponse.json(
      { error: "Name, phone and delivery address are required" },
      { status: 400 },
    );
  }

  const locale: Locale = body.locale === "hi" ? "hi" : "en";

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

    const staffPunch =
      isStaffRole(actor.role) &&
      userHasCapability(
        actor.actor,
        "manage_orders",
        capabilityContextFrom(got.db),
      );
    const userId = staffPunch ? String(body.userId || session.id) : session.id;
    if (!staffPunch && userId !== session.id) {
      return { error: "Not allowed", status: 403 as const };
    }

    const manualKind =
      body.manualDiscountKind === "percent" ||
      body.manualDiscountKind === "flat"
        ? body.manualDiscountKind
        : undefined;
    const manualValue = Math.max(0, Number(body.manualDiscountValue) || 0);

    const db = cloneDb(got.db);
    let order: Order;
    try {
      order = placeEstimateOnDatabase(db, {
        userId,
        cart,
        deliveryAddress,
        customerNotes: String(body.customerNotes || "").slice(0, 500),
        checkoutName,
        gstOrAadhar: String(body.gstOrAadhar || "").slice(0, 40),
        phone,
        transport: String(body.transport || "").slice(0, 120),
        walletToUse: Math.max(0, Number(body.walletToUse) || 0),
        fullTruckRequested: !!body.fullTruckRequested,
        allowManualDiscount: staffPunch,
        manualDiscountKind: staffPunch ? manualKind : undefined,
        manualDiscountValue: staffPunch ? manualValue : undefined,
        enforceDealerApproval: !staffPunch,
        locale: body.locale === "hi" ? "hi" : "en",
        punchedById: staffPunch && userId !== session.id ? session.id : undefined,
        punchedByName:
          staffPunch && userId !== session.id
            ? actor.actor.name
            : undefined,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not place order";
      return {
        error: message,
        status: 400 as const,
      };
    }

    if (staffPunch && userId !== session.id && !order.punchedBy) {
      order.source = "staff";
      order.punchedBy = session.id;
      order.timeline.push({
        status: order.status,
        at: new Date().toISOString(),
        note: `Punched in by ${actor.actor.name} (admin)`,
      });
      order.updatedAt = new Date().toISOString();
    }

    const put = await cloudPutAppDb(
      sanitizeDbForCloud(db),
      baseUpdatedAt ?? got.updatedAt ?? null,
    );
    if (put.conflict) {
      return { conflict: true as const, updatedAt: put.updatedAt };
    }
    if (!put.ok) {
      return { error: put.error || "Save failed", status: 500 as const };
    }

    void notifyStaffNewEstimateServer({
      users: db.users ?? [],
      order,
      companyName: db.settings?.companyName,
      locale,
      countryCode: db.settings?.whatsappCountryCode,
      enabled: db.settings?.whatsappNotifyEnabled,
      skipUserIds: staffPunch ? [session.id] : undefined,
      settings: db.settings,
    }).catch(() => undefined);

    const waSent = await notifyCustomerOrderUpdateServer({
      order,
      status: "estimate",
      settings: db.settings,
      locale,
    }).catch(() => false);

    return { order, updatedAt: put.updatedAt, waSent };
  };

  let result = await attempt(null);
  if ("conflict" in result && result.conflict) {
    result = await attempt(result.updatedAt ?? null);
  }
  if ("conflict" in result && result.conflict) {
    return NextResponse.json(
      { error: "Cloud was updated elsewhere. Try again." },
      { status: 409 },
    );
  }
  if ("error" in result) {
    return NextResponse.json(
      { error: result.error },
      { status: result.status || 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    order: result.order,
    updatedAt: result.updatedAt,
    waSent: "waSent" in result ? result.waSent : false,
  });
}
