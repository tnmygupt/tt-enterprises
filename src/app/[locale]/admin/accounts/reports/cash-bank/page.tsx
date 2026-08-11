"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/routing";

export default function CashBankRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/accounts/cash-bank");
  }, [router]);
  return <p className="p-6 text-sm">Loading…</p>;
}
