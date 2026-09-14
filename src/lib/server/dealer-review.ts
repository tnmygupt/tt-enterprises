import type { AppDatabase } from "@/lib/store/db";
import type { UserProfile } from "@/lib/types";
import { cloudGetAppDb, cloudPutAppDb } from "@/lib/server/app-db";
import { resolveCloudActor } from "@/lib/server/authorize-db";
import { userHasCapability, capabilityContextFrom } from "@/lib/capabilities";
import { readSessionCookie } from "@/lib/server/session";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { sanitizeDbForCloud } from "@/lib/supabase/sanitize";
import { stampUserTomb, tombsFromDb, userBeatsTomb } from "@/lib/user-tombs";

export type PendingDealerRow = Pick<
  UserProfile,
  | "id"
  | "name"
  | "phone"
  | "company"
  | "address"
  | "pincode"
  | "locale"
  | "createdAt"
> & {
  role: "customer";
  approved: false;
  active: true;
};

export function isPendingDealer(u: UserProfile): boolean {
  return u.role === "customer" && u.active !== false && u.approved !== true;
}

export function toPendingDealerRow(u: UserProfile): PendingDealerRow {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    company: u.company,
    address: u.address,
    pincode: u.pincode,
    locale: u.locale === "hi" ? "hi" : "en",
    createdAt: u.createdAt,
    role: "customer",
    approved: false,
    active: true,
  };
}

export type DealerDirectoryRow = Pick<
  UserProfile,
  | "id"
  | "name"
  | "phone"
  | "company"
  | "address"
  | "pincode"
  | "gstOrAadhar"
  | "transport"
  | "locale"
  | "createdAt"
  | "walletBalance"
  | "liftingProgressKg"
  | "revokedAt"
  | "revokedBy"
  | "revokedReason"
> & {
  role: "customer";
  approved: boolean;
  active: boolean;
};

export function toDealerDirectoryRow(u: UserProfile): DealerDirectoryRow {
  return {
    id: u.id,
    name: u.name,
    phone: u.phone,
    company: u.company,
    address: u.address,
    pincode: u.pincode,
    gstOrAadhar: u.gstOrAadhar,
    transport: u.transport,
    locale: u.locale === "hi" ? "hi" : "en",
    createdAt: u.createdAt,
    walletBalance: Number(u.walletBalance) || 0,
    liftingProgressKg: Number(u.liftingProgressKg) || 0,
    revokedAt: u.revokedAt,
    revokedBy: u.revokedBy,
    revokedReason: u.revokedReason,
    role: "customer",
    approved: u.approved === true,
    active: u.active !== false,
  };
}

export function listAllDealers(
  users: UserProfile[],
  tombs?: { deletedUserIds?: string[]; deletedUserAt?: Record<string, string> },
): DealerDirectoryRow[] {
  const tombMap = tombs ? tombsFromDb(tombs) : {};
  return (users ?? [])
    .filter((u) => u.role === "customer" && userBeatsTomb(u, tombMap))
    .map(toDealerDirectoryRow)
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
}

export function listPendingDealers(users: UserProfile[]): PendingDealerRow[] {
  return (users ?? []).filter(isPendingDealer).map(toPendingDealerRow);
}

export function applyDeleteLogin(
  db: AppDatabase,
  userId: string,
  byAdminId: string,
): void {
  const actor = (db.users ?? []).find((u) => u.id === byAdminId);
  if (
    !actor ||
    !userHasCapability(actor, "manage_users", capabilityContextFrom(db))
  ) {
    throw new Error("Only admins can delete users");
  }
  if (userId === byAdminId) {
    throw new Error("You cannot delete your own account");
  }
  const user = (db.users ?? []).find((u) => u.id === userId);
  if (user?.role === "super_admin") {
    const otherOwner = (db.users ?? []).some(
      (u) => u.id !== user.id && u.role === "super_admin" && u.active,
    );
    if (!otherOwner) {
      throw new Error(
        "Cannot delete the last owner — create another owner first",
      );
    }
  }
  const linkedParty = (db.parties ?? []).find((p) => p.linkedUserId === userId);
  if (linkedParty) {
    linkedParty.linkedUserId = undefined;
    linkedParty.active = false;
  }
  db.users = (db.users ?? []).filter((u) => u.id !== userId);
  stampUserTomb(db, userId);
}

export async function putCloudDbRetry(
  mutate: (db: AppDatabase) => void,
  attempts = 4,
): Promise<
  { ok: true; db: AppDatabase } | { ok: false; error: string; status: number }
> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Cloud database not configured", status: 503 };
  }
  for (let i = 0; i < attempts; i++) {
    const got = await cloudGetAppDb();
    if (got.error || !got.db) {
      return { ok: false, error: got.error || "Cloud empty", status: 500 };
    }
    try {
      mutate(got.db);
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "Update failed",
        status: 400,
      };
    }
    const put = await cloudPutAppDb(
      sanitizeDbForCloud(got.db),
      got.updatedAt ?? null,
    );
    if (put.ok) return { ok: true, db: got.db };
    if (!put.conflict) {
      return { ok: false, error: put.error || "Save failed", status: 500 };
    }
  }
  return { ok: false, error: "Conflict — please retry", status: 409 };
}

export function actorMayViewDealers(
  actor: UserProfile,
  db: AppDatabase,
): boolean {
  const ctx = capabilityContextFrom(db);
  return (
    userHasCapability(actor, "approve_dealers", ctx) ||
    userHasCapability(actor, "manage_users", ctx) ||
    userHasCapability(actor, "manage_orders", ctx)
  );
}

export function actorMayApproveDealers(
  actor: UserProfile,
  db: AppDatabase,
): boolean {
  return userHasCapability(actor, "approve_dealers", capabilityContextFrom(db));
}

export async function staffCanAccessDealers(
  req: Request,
): Promise<
  { ok: true; db: AppDatabase } | { ok: false; error: string; status: number }
> {
  const session = readSessionCookie(req);
  if (!session) {
    return {
      ok: false,
      error: "Login required — please log in again",
      status: 401,
    };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Cloud database not configured", status: 503 };
  }
  const got = await cloudGetAppDb();
  if (got.error || !got.db) {
    return { ok: false, error: got.error || "Cloud empty", status: 500 };
  }
  try {
    const { actor } = resolveCloudActor(got.db, session);
    if (!actorMayViewDealers(actor, got.db)) {
      return { ok: false, error: "No permission to view dealers", status: 403 };
    }
    return { ok: true, db: got.db };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Session invalid",
      status: 401,
    };
  }
}

export async function staffCanApproveDealers(
  req: Request,
): Promise<
  | { ok: true; db: AppDatabase; actor: UserProfile }
  | { ok: false; error: string; status: number }
> {
  const session = readSessionCookie(req);
  if (!session) {
    return {
      ok: false,
      error: "Login required — please log in again",
      status: 401,
    };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Cloud database not configured", status: 503 };
  }
  const got = await cloudGetAppDb();
  if (got.error || !got.db) {
    return { ok: false, error: got.error || "Cloud empty", status: 500 };
  }
  try {
    const { actor } = resolveCloudActor(got.db, session);
    if (!actorMayApproveDealers(actor, got.db)) {
      return {
        ok: false,
        error: "No permission to approve dealers",
        status: 403,
      };
    }
    return { ok: true, db: got.db, actor };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Session invalid",
      status: 401,
    };
  }
}

export async function staffCanManageUsers(
  req: Request,
): Promise<
  { ok: true; db: AppDatabase } | { ok: false; error: string; status: number }
> {
  const session = readSessionCookie(req);
  if (!session) {
    return {
      ok: false,
      error: "Login required — please log in again",
      status: 401,
    };
  }
  if (!isSupabaseConfigured()) {
    return { ok: false, error: "Cloud database not configured", status: 503 };
  }
  const got = await cloudGetAppDb();
  if (got.error || !got.db) {
    return { ok: false, error: got.error || "Cloud empty", status: 500 };
  }
  try {
    const { actor } = resolveCloudActor(got.db, session);
    if (
      !userHasCapability(actor, "manage_users", capabilityContextFrom(got.db))
    ) {
      return {
        ok: false,
        error: "No permission to manage staff users",
        status: 403,
      };
    }
    return { ok: true, db: got.db };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Session invalid",
      status: 401,
    };
  }
}
