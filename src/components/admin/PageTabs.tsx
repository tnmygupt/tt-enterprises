"use client";

import type { ReactNode } from "react";
import { Link } from "@/i18n/routing";

export type PageTabItem = {
  id: string;
  label: ReactNode;
  href?: string;
  count?: number;
};

export function PageTabs({
  tabs,
  value,
  onChange,
  className = "",
}: {
  tabs: PageTabItem[];
  value: string;
  onChange?: (id: string) => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap gap-2 print:hidden ${className}`.trim()}
      role="tablist"
    >
      {tabs.map((tab) => {
        const active = tab.id === value;
        const cls = `tt-chip min-h-11 ${active ? "tt-chip-active" : ""}`;
        const body = (
          <>
            <span>{tab.label}</span>
            {tab.count != null && tab.count > 0 ? (
              <span className="tt-chip-count">{tab.count}</span>
            ) : null}
          </>
        );
        if (tab.href) {
          return (
            <Link
              key={tab.id}
              href={tab.href}
              role="tab"
              aria-selected={active}
              className={cls}
            >
              {body}
            </Link>
          );
        }
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active}
            className={cls}
            onClick={() => onChange?.(tab.id)}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
