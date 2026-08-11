"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/routing";
import { useSession } from "@/lib/hooks";

/** Old /login route → home auth screen */
export default function LoginRedirectPage() {
  const router = useRouter();
  const { session, ready } = useSession();

  useEffect(() => {
    if (!ready) return;
    router.replace(session ? (session.role === "customer" ? "/" : "/admin") : "/");
  }, [ready, session, router]);

  return null;
}
