"use client";

import { useLocale } from "next-intl";
import { HelpGuideView } from "@/components/HelpGuideView";
import { useDb, useSession } from "@/lib/hooks";
import { getHelpGuide } from "@/lib/help-guides";
import { isStaff } from "@/lib/store/db";

export default function DealerHelpPage() {
  const locale = useLocale() as "en" | "hi";
  const { db } = useDb();
  const { session } = useSession();
  const guide = getHelpGuide("dealer", locale);
  const staff = !!session && isStaff(session.role);

  return (
    <section className="tt-section">
      <div className="tt-wrap max-w-3xl">
        <HelpGuideView
          guide={guide}
          youtubeUrl={db?.settings.dealerHelpVideoUrl}
          secondaryHref={staff ? "/admin/help" : undefined}
          secondaryLabel={
            staff
              ? locale === "hi"
                ? "स्टाफ गाइड →"
                : "Staff guide →"
              : undefined
          }
        />
      </div>
    </section>
  );
}
