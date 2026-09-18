"use client";

import type { ReactNode } from "react";
import { Link } from "@/i18n/routing";

export type FilterChipItem = {
  id: string;
  label: ReactNode;
  href?: string;
  count?: number;
  active?: boolean;
};

export function FilterChips({
  items,
  onSelect,
  className = "",
}: {
  items: FilterChipItem[];
  onSelect?: (id: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-2 ${className}`.trim()}>
      {items.map((item) => {
        const cls = `tt-chip min-h-11 ${item.active ? "tt-chip-active" : ""}`;
        const body = (
          <>
            <span>{item.label}</span>
            {item.count != null ? (
              <span className="tt-chip-count">{item.count}</span>
            ) : null}
          </>
        );
        if (item.href) {
          return (
            <Link
              key={item.id}
              href={item.href}
              className={cls}
              aria-pressed={item.active}
            >
              {body}
            </Link>
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            className={cls}
            aria-pressed={item.active}
            onClick={() => onSelect?.(item.id)}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}
