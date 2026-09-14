"use client";

import { Suspense } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Link, useRouter } from "@/i18n/routing";
import { AdminAccessDenied } from "@/components/AdminAccessDenied";
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
  const router = useRouter();
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

  const setTab = (next: GuideTab) => {
    router.replace(next === "books" ? "/admin/help?tab=books" : "/admin/help");
  };

  return (
    <AdminShell>
      {salesDesk ? (
        <AdminAccessDenied />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-2">
            <button
              type="button"
              className={`rounded-lg px-4 py-2 text-sm font-bold ${
                tab === "desk"
                  ? "bg-[var(--brand)] text-white"
                  : "border border-[var(--line)] bg-white text-[var(--ink-muted)]"
              }`}
              onClick={() => setTab("desk")}
            >
              {t("helpDeskTab")}
            </button>
            {booksOk ? (
              <>
                <button
                  type="button"
                  className={`rounded-lg px-4 py-2 text-sm font-bold ${
                    tab === "books"
                      ? "bg-[var(--brand)] text-white"
                      : "border border-[var(--line)] bg-white text-[var(--ink-muted)]"
                  }`}
                  onClick={() => setTab("books")}
                >
                  {t("helpBooksTab")}
                </button>
                <Link
                  href="/admin/accounts/controls/flow-audit"
                  className="rounded-lg border border-[var(--line)] bg-white px-4 py-2 text-sm font-bold text-[var(--brand-deep)]"
                >
                  {t("flowAudit")}
                </Link>
              </>
            ) : null}
          </div>

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
