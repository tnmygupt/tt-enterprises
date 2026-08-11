"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import {
  type DatePreset,
  type DateRange,
  defaultRange,
  loadStoredRange,
  rangeForPreset,
  saveStoredRange,
} from "@/lib/date-range";

const PRESETS: { key: Exclude<DatePreset, "custom">; en: string; hi: string }[] =
  [
    { key: "today", en: "Today", hi: "आज" },
    { key: "7d", en: "7 days", hi: "7 दिन" },
    { key: "mtd", en: "Month", hi: "इस माह" },
  ];

export function useAdminDateRange(
  initial: Exclude<DatePreset, "custom"> = "today"
): [DateRange, (next: DateRange) => void] {
  const [range, setRangeState] = useState<DateRange>(() => defaultRange(initial));

  useEffect(() => {
    // Hydrate from localStorage after mount — server render has no storage.
    /* eslint-disable react-hooks/set-state-in-effect */
    const stored = loadStoredRange();
    if (!stored) {
      setRangeState(defaultRange(initial));
      return;
    }
    // Re-resolve presets so "today" always means the current calendar day
    if (stored.preset !== "custom") {
      setRangeState(rangeForPreset(stored.preset));
    } else {
      setRangeState(stored);
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [initial]);

  const setRange = (next: DateRange) => {
    setRangeState(next);
    saveStoredRange(next);
  };

  return [range, setRange];
}

export function DateRangeBar({
  value,
  onChange,
  className = "",
}: {
  value: DateRange;
  onChange: (next: DateRange) => void;
  className?: string;
}) {
  const locale = useLocale() as "en" | "hi";

  return (
    <div
      className={`tt-date-range ${className}`}
      role="group"
      aria-label={locale === "hi" ? "तारीख सीमा" : "Date range"}
    >
      <div className="tt-date-range-presets">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onChange(rangeForPreset(p.key))}
            className={`tt-date-chip ${
              value.preset === p.key ? "tt-date-chip-active tt-selected" : ""
            }`}
          >
            {locale === "hi" ? p.hi : p.en}
          </button>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange({
              preset: "custom",
              from: value.from,
              to: value.to,
            })
          }
          className={`tt-date-chip ${
            value.preset === "custom" ? "tt-date-chip-active tt-selected" : ""
          }`}
        >
          {locale === "hi" ? "कस्टम" : "Custom"}
        </button>
      </div>

      <div className="tt-date-range-fields">
        <label className="tt-date-field">
          <span>{locale === "hi" ? "से" : "From"}</span>
          <input
            type="date"
            className="tt-input tt-input-date"
            value={value.from}
            onChange={(e) =>
              onChange({
                preset: "custom",
                from: e.target.value || value.from,
                to: value.to < (e.target.value || value.from)
                  ? e.target.value || value.to
                  : value.to,
              })
            }
          />
        </label>
        <span className="tt-date-sep" aria-hidden>
          –
        </span>
        <label className="tt-date-field">
          <span>{locale === "hi" ? "तक" : "To"}</span>
          <input
            type="date"
            className="tt-input tt-input-date"
            value={value.to}
            min={value.from}
            onChange={(e) =>
              onChange({
                preset: "custom",
                from: value.from,
                to: e.target.value || value.to,
              })
            }
          />
        </label>
      </div>
    </div>
  );
}
