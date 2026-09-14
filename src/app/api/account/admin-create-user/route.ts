import { NextRequest, NextResponse } from "next/server";
import { cloudGetAppDb, cloudPutAppDb } from "@/lib/server/app-db";
import { hashPasswordSecure, readSessionCookie } from "@/lib/server/session";
import { resolveCloudActor } from "@/lib/server/authorize-db";
import { capabilityContextFrom, userHasCapability } from "@/lib/capabilities";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";
import { tombsFromDb, userBeatsTomb } from "@/lib/user-tombs";
import { notifyDealerReviewServer } from "@/lib/server/whatsapp-notify";
import { ensureStaffHrTerms } from "@/lib/hr";
import type { Capability, UserProfile, UserRole } from "@/lib/types";

function normalizePhone(phone: string): string {
  return (phone || "").replace(/\D/g, "").slice(-10);
}

function phonesMatch(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  return na.length === 10 && na === nb;
}

const STAFF_ROLES: UserRole[] = [
  "sales",
  "accounts",
  "dispatch",
  "plant_manager",
  "viewer",
  "super_admin",
];

function sanitizeCapabilityOverrides(
  role: UserRole,
  extra?: Capability[],
  denied?: Capability[],
): { extraCapabilities?: Capability[]; deniedCapabilities?: Capability[] } {
  if (role === "super_admin" || role === "customer") {
    return {};
  }
  const cleanExtra = [...new Set(extra ?? [])];
  const cleanDenied = [...new Set(denied ?? [])];
  return {
    extraCapabilities: cleanExtra.length ? cleanExtra : undefined,
    deniedCapabilities: cleanDenied.length ? cleanDenied : undefined,
  };
}

/**
 * Admin creates staff (sales etc.) or dealer in the SHARED cloud DB
 * so other devices see them immediately.
 */
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
      { error: "Cloud database not configured — cannot create shared users" },
      { status: 503 },
    );
  }
  let body: {
    kind?: "staff" | "dealer";
    name?: string;
    phone?: string;
    password?: string;
    role?: UserRole;
    email?: string;
    company?: string;
    address?: string;
    pincode?: string;
    gstOrAadhar?: string;
    transport?: string;
    extraCapabilities?: Capability[];
    deniedCapabilities?: Capability[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const kind = body.kind === "dealer" ? "dealer" : "staff";
  const name = (body.name || "").trim();
  const phone = normalizePhone(body.phone || "");
  const password = String(body.password || "").trim();

  if (!name) {
    return NextResponse.json({ error: "Name is required" }, { status: 400 });
  }
  if (phone.length !== 10) {
    return NextResponse.json(
      { error: "Enter a valid 10-digit mobile number" },
      { status: 400 },
    );
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "Password must be at least 6 characters" },
      { status: 400 },
    );
  }

  const role: UserRole =
    kind === "dealer" ? "customer" : (body.role as UserRole) || "sales";
  if (kind === "staff") {
    if (!STAFF_ROLES.includes(role)) {
      return NextResponse.json(
        {
          error:
            "Invalid staff role — use sales, accounts, dispatch, plant_manager, viewer, or super_admin",
        },
        { status: 400 },
      );
    }
  }

  // Retry once on optimistic-lock conflict
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

    const { actor } = resolved;

    if (!userHasCapability(actor, "manage_users", capabilityContextFrom(db))) {
      return NextResponse.json(
        { error: "Only admins can create users" },
        { status: 403 },
      );
    }

    if (role === "super_admin" && actor.role !== "super_admin") {
      return NextResponse.json(
        { error: "Only an owner can create another super admin" },
        { status: 403 },
      );
    }

    const tombs = tombsFromDb(db);
    if (
      db.users.some(
        (u) => phonesMatch(u.phone, phone) && userBeatsTomb(u, tombs),
      )
    ) {
      return NextResponse.json(
        { error: "This phone number already exists" },
        { status: 409 },
      );
    }

    const caps =
      kind === "staff" && actor.role === "super_admin"
        ? sanitizeCapabilityOverrides(
            role,
            body.extraCapabilities,
            body.deniedCapabilities,
          )
        : {};

    const now = new Date().toISOString();
    const user: UserProfile = {
      id: `user_${crypto.randomUUID()}`,
      email: body.email?.trim().toLowerCase() || undefined,
      passwordHash: hashPasswordSecure(password),
      passwordVisible: password,
      name,
      phone,
      role,
      ...caps,
      locale: "en",
      walletBalance: 0,
      assignedSchemeIds: [],
      liftingProgressKg: 0,
      schemeProgress: {},
      active: true,
      approved: true,
      createdAt: now,
      company: body.company?.trim() || undefined,
      address: body.address?.trim() || undefined,
      pincode: body.pincode?.replace(/\D/g, "").slice(0, 6) || undefined,
      gstOrAadhar: body.gstOrAadhar?.trim() || undefined,
      transport: body.transport?.trim() || undefined,
    };

    if (kind === "dealer") {
      const partyName = (user.company?.trim() || user.name).trim();
      db.parties = db.parties || [];
      db.parties.push({
        id: `party_${crypto.randomUUID()}`,
        name: partyName,
        phone: user.phone,
        type: "customer",
        linkedUserId: user.id,
        openingBalance: 0,
        address: user.address,
        pincode: user.pincode,
        gstin: user.gstOrAadhar,
        active: true,
        createdAt: now,
      });
    }

    db.users.push(user);
    if (kind === "staff") {
      ensureStaffHrTerms(db, db.users);
    }
    // Clear tombstone if this phone/id was previously force-deleted
    if (db.deletedUserIds?.length) {
      db.deletedUserIds = db.deletedUserIds.filter((id) => id !== user.id);
    }
    if (db.deletedUserAt?.[user.id]) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit by key
      const { [user.id]: _, ...rest } = db.deletedUserAt;
      db.deletedUserAt = rest;
    }
    const cleaned = sanitizeDbForCloud(db);
    // Keep passwordVisible only in API response, not in cloud
    for (const u of cleaned.users) {
      delete (u as { passwordVisible?: string }).passwordVisible;
    }

    const result = await cloudPutAppDb(cleaned, updatedAt ?? null);
    if (result.conflict) {
      continue;
    }
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || "Failed to save user to cloud" },
        { status: 500 },
      );
    }

    let waSent = false;
    if (kind === "dealer") {
      waSent = await notifyDealerReviewServer({
        user,
        action: "approve",
        settings: cleaned.settings,
      });
    }

    return NextResponse.json({
      ok: true,
      waSent,
      user: {
        ...user,
        passwordHash: "",
        passwordVisible: password,
      },
      message:
        kind === "dealer"
          ? `Dealer ${name} created on cloud`
          : `Staff ${name} (${role}) created on cloud`,
    });
  }

  return NextResponse.json(
    {
      error: "Could not save — another device updated the database. Try again.",
    },
    { status: 409 },
  );
}
