"use client";

import { useEffect } from "react";
import { useRouter } from "@/i18n/routing";

export default function ItemSalesRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/accounts/item-sales");
  }, [router]);
  return <p className="p-6 text-sm">Loading…</p>;
}
