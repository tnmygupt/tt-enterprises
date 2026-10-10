"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";

/**
 * Stock lives in the accounts book — it needs the FIFO layers and movement
 * register that live there. This route stayed as a near-duplicate screen for
 * a while; keep it as an alias so old links and bookmarks still land.
 */
export default function AdminInventoryRedirect() {
  const t = useTranslations();
  const router = useRouter();
  useEffect(() => {
    router.replace("/admin/accounts/inventory");
  }, [router]);
  return <p className="p-6 text-sm">{t("admin.loadingEllipsis")}</p>;
}
