"use client";

import { useMemo, useState } from "react";
import { useLocale } from "next-intl";
import { Link } from "@/i18n/routing";
import { AdminShell } from "@/components/AdminShell";
import { HelpGuideView } from "@/components/HelpGuideView";
import { useDb } from "@/lib/hooks";
import { getHelpGuide } from "@/lib/help-guides";

type GuideTab = "desk" | "books";

export default function AdminHelpPage() {
  const locale = useLocale() as "en" | "hi";
  const { db } = useDb();
  const [tab, setTab] = useState<GuideTab>("desk");
  // Accounts screens stay English-only; Books tab always uses the EN guide.
  const guide = getHelpGuide(
    tab === "books" ? "accounts" : "admin",
    tab === "books" ? "en" : locale
  );

  const hi = locale === "hi";

  return (
    <AdminShell>
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
          {hi ? "डेस्क (ऑर्डर)" : "Desk (orders)"}
        </button>
        <button
          type="button"
          className={`rounded-lg px-4 py-2 text-sm font-bold ${
            tab === "books"
              ? "bg-[var(--brand)] text-white"
              : "border border-[var(--line)] bg-white text-[var(--ink-muted)]"
          }`}
          onClick={() => setTab("books")}
        >
          {hi ? "किताबें (Accounts)" : "Books (Accounts)"}
        </button>
        <Link
          href="/admin/accounts/controls/flow-audit"
          className="rounded-lg border border-[var(--line)] bg-white px-4 py-2 text-sm font-bold text-[var(--brand-deep)]"
        >
          {hi ? "फ्लो ऑडिट" : "Flow audit"}
        </Link>
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
    </AdminShell>
  );
}
