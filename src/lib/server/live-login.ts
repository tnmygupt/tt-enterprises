import type { AppDatabase } from "@/lib/store/db";
import type { UserProfile } from "@/lib/types";
import { tombsFromDb, userBeatsTomb } from "@/lib/user-tombs";

export function phonesMatch(a: string, b: string): boolean {
  const na = (a || "").replace(/\D/g, "").slice(-10);
  const nb = (b || "").replace(/\D/g, "").slice(-10);
  return na.length === 10 && na === nb;
}

/** Login row that still exists and is not tombstoned. */
export function liveLoginUser(
  db: AppDatabase,
  phone: string
): UserProfile | undefined {
  const tombs = tombsFromDb(db);
  for (const u of db.users ?? []) {
    if (!phonesMatch(u.phone, phone)) continue;
    if (!userBeatsTomb(u, tombs)) continue;
    return u;
  }
  return undefined;
}

/** Cookie session still maps to a live, allowed account. */
export function liveSessionUser(
  db: AppDatabase,
  sessionId: string
): UserProfile | undefined {
  const tombs = tombsFromDb(db);
  const user = (db.users ?? []).find((u) => u.id === sessionId);
  if (!user) return undefined;
  if (!userBeatsTomb(user, tombs)) return undefined;
  if (!user.active) return undefined;
  if (user.role === "customer" && user.approved !== true) return undefined;
  return user;
}
