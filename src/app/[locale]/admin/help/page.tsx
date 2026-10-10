"use client";

import { Suspense } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { PageTabs } from "@/components/admin/PageTabs";
import { AdminShell } from "@/components/AdminShell";
import { HelpGuideView } from "@/components/HelpGuideView";
import { useDb, useSession } from "@/lib/hooks";
import { getHelpGuide } from "@/lib/help-guides";
import { checkCapability, isSalesDeskStaff } from "@/lib/store/db";

type GuideTab = "desk" | "books";

function HelpInner() {
  const t = useTranslations("accounts");
  const locale = useLocale() as "en" | "hi";
  const search = useSearchParams();
  const { db } = useDb();
  const { session } = useSession();
  const salesDesk = isSalesDeskStaff(session, db);
  const booksOk =
    !!session &&
    !salesDesk &&
    checkCapability(session, db, "manage_accounts");
  const requested = search.get("tab") === "books" ? "books" : "desk";
  const tab: GuideTab = requested === "books" && booksOk ? "books" : "desk";
  const guide = getHelpGuide(tab === "books" ? "accounts" : "admin", locale);
  const hi = locale === "hi";

  return (
    <AdminShell>
      {salesDesk ? (
        <AdminAccessDenied />
      ) : (
        <>
          <AdminPageHeader
            title={t("helpDeskTab")}
            hint={hi ? "डेस्क और बही कैसे चलते हैं" : "How the desk and books work"}
          />
          <PageTabs
            className="mb-6"
            value={tab}
            tabs={[
              { id: "desk", label: t("helpDeskTab"), href: "/admin/help" },
              ...(booksOk
                ? [
                    {
                      id: "books" as const,
                      label: t("helpBooksTab"),
                      href: "/admin/help?tab=books",
                    },
                  ]
                : []),
            ]}
          />

          <HelpGuideView
            key={tab}
            guide={guide}
            youtubeUrl={
              tab === "desk" ? db?.settings.adminHelpVideoUrl : undefined
            }
            showRecordingScript={tab === "desk" || tab === "books"}
            secondaryHref="/help"
            secondaryLabel={hi ? "← डीलर गाइड" : "← Dealer guide"}
          />
        </>
      )}
    </AdminShell>
  );
}

export default function AdminHelpPage() {
  return (
    <Suspense
      fallback={
        <AdminShell>
          <p className="text-sm text-[var(--ink-muted)]">…</p>
        </AdminShell>
      }
    >
      <HelpInner />
    </Suspense>
  );
}
