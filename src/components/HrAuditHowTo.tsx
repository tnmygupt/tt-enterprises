"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

/** 1 start, 2 count SKUs, 3 cash, 4 submit, 5 owner. */
export function CountAuditHowTo({
  step,
  showOwnerStep,
}: {
  step: number;
  showOwnerStep: boolean;
}) {
  const t = useTranslations("admin");
  const keys = ["auditStep1", "auditStep2", "auditStep3", "auditStep4", "auditStep5"];
  return (
    <div className="tt-panel mt-4 p-4 print:hidden">
      <p className="text-sm font-semibold">{t("auditHowTo")}</p>
      <ol className="mt-2 space-y-1 text-sm">
        {keys.map((key, i) => {
          const n = i + 1;
          if (n === 5 && !showOwnerStep) return null;
          const here = n === step || (step === 2 && (n === 2 || n === 3));
          return (
            <li
              key={key}
              className={
                here
                  ? "font-semibold text-[var(--brand)]"
                  : "text-[var(--ink-muted)]"
              }
            >
              {t(key)}
              {here ? ` — ${t("auditStepNow")}` : ""}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export function MonthCloseHowTo({ month }: { month: string }) {
  const t = useTranslations("admin");
  return (
    <div className="tt-panel mt-4 p-4 print:hidden">
      <p className="text-sm font-semibold">{t("auditCloseHow")}</p>
      <ol className="mt-2 space-y-1 text-sm text-[var(--ink-muted)]">
        <li>{t("auditClose1")}</li>
        <li>{t("auditClose2")}</li>
        <li>{t("auditClose3")}</li>
        <li>{t("auditClose4")}</li>
      </ol>
      <Link
        href="/admin/audit/stock-count"
        className="tt-btn tt-btn-outline mt-3 inline-flex"
      >
        {t("auditGoCount")} · {month}
      </Link>
    </div>
  );
}
