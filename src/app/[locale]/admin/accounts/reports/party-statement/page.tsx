"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/routing";

/** Old nested URL → flat route */
export default function PartyStatementRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/accounts/party-statement");
  }, [router]);
  return <p className="p-6 text-sm">Loading…</p>;
}
