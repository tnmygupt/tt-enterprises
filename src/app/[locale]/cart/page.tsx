"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/routing";
import { useSession } from "@/lib/hooks";

/** Cart UI removed — Quick Order is the order builder. */
export default function CartRedirectPage() {
  const router = useRouter();
  const { session, ready } = useSession();

  useEffect(() => {
    if (!ready) return;
    router.replace(session ? "/quick-order" : "/");
  }, [router, ready, session]);

  return null;
}
