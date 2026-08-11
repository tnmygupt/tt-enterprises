"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "@/i18n/routing";
import { useDb, useSession } from "@/lib/hooks";
import { logout } from "@/lib/store/db";

/** Paths guests may open without logging in (browse + auth). */
function isPublicPath(pathname: string): boolean {
  if (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/register" ||
    pathname === "/help" ||
    pathname === "/reset"
  ) {
    return true;
  }
  if (pathname === "/catalog" || pathname.startsWith("/catalog/")) return true;
  if (pathname === "/price-list") return true;
  return false;
}

/**
 * Guests can browse catalog / price list / help.
 * Orders, cart, wallet, admin require login.
 *
 * Also self-heals: if the session belongs to a disabled user, log out.
 */
export function AuthRedirect() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, ready } = useSession();
  const { db } = useDb();

  useEffect(() => {
    if (!ready) return;

    if (session) {
      const user = db?.users.find((u) => u.id === session.id);
      if (user && !user.active) {
        try {
          sessionStorage.setItem(
            "tt_auth_flash",
            "Account is disabled. Contact admin."
          );
        } catch {
          /* ignore */
        }
        logout();
        router.replace("/");
        return;
      }
      return;
    }

    if (isPublicPath(pathname)) return;
    router.replace("/");
  }, [ready, session, pathname, router, db]);

  return null;
}
