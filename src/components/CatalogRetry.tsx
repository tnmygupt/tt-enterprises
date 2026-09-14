"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { retryCloudCatalog } from "@/lib/hooks";

export function CatalogRetry({ className = "" }: { className?: string }) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);

  return (
    <div className={className}>
      <p className="text-sm text-[var(--ink-muted)]">{t("shop.catalogEmpty")}</p>
      <button
        type="button"
        className="tt-btn tt-btn-outline mt-3 min-h-11 px-4"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void retryCloudCatalog().finally(() => setBusy(false));
        }}
      >
        {busy ? t("common.loading") : t("connection.retry")}
      </button>
    </div>
  );
}
