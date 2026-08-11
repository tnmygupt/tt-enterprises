"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/routing";
import { useSession } from "@/lib/hooks";

/** Old /register route → home with the signup tab pre-opened. */
export default function RegisterRedirectPage() {
  const router = useRouter();
  const { session, ready } = useSession();

  useEffect(() => {
    if (!ready) return;
    if (!session) {
      try {
        sessionStorage.setItem("tt_auth_tab", "signup");
      } catch {
        /* ignore */
      }
    }
    router.replace("/");
  }, [ready, session, router]);

  return null;
}
