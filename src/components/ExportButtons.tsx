"use client";

import { useState } from "react";
import { useDb } from "@/lib/hooks";
import { companyFromSettings } from "@/lib/export-pdf";
import {
  exportPdf,
  exportTableExcel,
  type ExportTableOptions,
} from "@/lib/export-table";

type Props = {
  options: ExportTableOptions;
  /** Hide when there is nothing to export */
  disabled?: boolean;
  className?: string;
};

/**
 * Shared PDF + Excel buttons for every accounts report.
 * Excel loads SheetJS only on click.
 */
export function ExportButtons({ options, disabled, className }: Props) {
  const [busy, setBusy] = useState(false);
  const { db } = useDb();

  // Every report goes through here, so the letterhead is filled in once
  // rather than at ~30 call sites.
  const withCompany: ExportTableOptions = {
    ...options,
    company: options.company ?? companyFromSettings(db?.settings),
  };

  return (
    <div className={`flex flex-wrap gap-2 ${className ?? ""}`}>
      <button
        type="button"
        className="tt-btn tt-btn-outline"
        disabled={disabled || busy}
        onClick={() => {
          void exportPdf(withCompany).catch((err) => {
            console.error(err);
            window.alert(
              err instanceof Error ? err.message : "PDF export failed"
            );
          });
        }}
      >
        Export PDF
      </button>
      <button
        type="button"
        className="tt-btn tt-btn-outline"
        disabled={disabled || busy}
        onClick={() => {
          setBusy(true);
          void exportTableExcel(withCompany)
            .catch((err) => {
              console.error(err);
              window.alert(
                err instanceof Error ? err.message : "Excel export failed"
              );
            })
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Excel…" : "Export Excel"}
      </button>
    </div>
  );
}
