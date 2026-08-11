"use client";

import { useState, type KeyboardEvent } from "react";
import {
  columnKgTotals,
  parseKgInput,
  syncBundlesFromCells,
} from "@/lib/packing-slip";
import type { PackingSlip } from "@/lib/types";

type Props = {
  slip: PackingSlip;
  onChange: (next: PackingSlip) => void;
  locale?: "en" | "hi";
};

/** Compact weighment grid for sale vouchers (one cell per bundle). */
export function PackingSlipWeighmentGrid({
  slip,
  onChange,
  locale = "en",
}: Props) {
  const [cellDrafts, setCellDrafts] = useState<Record<string, string>>({});
  const rowCount = slip.rows.length;
  const hi = locale === "hi";
  const cellKey = (r: number, c: number) => `${r}:${c}`;

  const isCellActive = (r: number, c: number) => {
    const ordered = slip.columns[c]?.orderedBundles ?? 0;
    return r < ordered;
  };

  const focusCell = (r: number, c: number) => {
    const el = document.querySelector<HTMLInputElement>(
      `[data-vslip-cell="${r}-${c}"]`
    );
    if (!el || el.disabled) return;
    el.focus();
    el.select();
  };

  const findNext = (
    r: number,
    c: number,
    dr: number,
    dc: number
  ): { r: number; c: number } | null => {
    let nr = r + dr;
    let nc = c + dc;
    for (let i = 0; i < rowCount * slip.columns.length + 2; i++) {
      if (nr < 0 || nr >= rowCount || nc < 0 || nc >= slip.columns.length) {
        return null;
      }
      if (isCellActive(nr, nc)) return { r: nr, c: nc };
      nr += dr;
      nc += dc;
    }
    return null;
  };

  const setCell = (r: number, c: number, raw: string) => {
    const { value, display } = parseKgInput(raw);
    setCellDrafts((d) => ({ ...d, [cellKey(r, c)]: display }));
    const next = structuredClone(slip);
    while (next.rows.length <= r) {
      next.rows.push({
        cells: Array.from({ length: next.columns.length }, () => null),
      });
    }
    next.rows[r].cells[c] = value;
    onChange(syncBundlesFromCells(next));
  };

  const cellDisplay = (r: number, c: number): string => {
    const key = cellKey(r, c);
    if (cellDrafts[key] != null) return cellDrafts[key];
    const v = slip.rows[r]?.cells[c];
    return v == null ? "" : String(v);
  };

  const onKeyDown = (
    e: KeyboardEvent<HTMLInputElement>,
    r: number,
    c: number
  ) => {
    let dr = 0;
    let dc = 0;
    if (e.key === "ArrowUp") dr = -1;
    else if (e.key === "ArrowDown") dr = 1;
    else if (e.key === "ArrowLeft") dc = -1;
    else if (e.key === "ArrowRight") dc = 1;
    else if (e.key === "Enter") {
      e.preventDefault();
      dr = e.shiftKey ? -1 : 1;
    } else return;

    if (dc !== 0) {
      const input = e.currentTarget;
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      const len = input.value.length;
      const allSelected = start === 0 && end === len && len > 0;
      if (!allSelected) {
        if (dc < 0 && start > 0) return;
        if (dc > 0 && end < len) return;
      }
    }

    const next = findNext(r, c, dr, dc);
    if (!next) return;
    e.preventDefault();
    focusCell(next.r, next.c);
  };

  const kgTotals = columnKgTotals(slip);

  if (!slip.columns.length) {
    return (
      <p className="text-sm text-[var(--ink-muted)]">
        {hi
          ? "पहले स्टॉक आइटम और बंडल जोड़ें।"
          : "Add stock items and bundles first."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-[var(--ink-muted)]">
        {hi
          ? "हर पंक्ति = एक बंडल · उस बंडल का वजन (kg) भरें।"
          : "Each row = one bundle · enter that bundle’s weight (kg)."}
      </p>
      <div className="overflow-x-auto rounded-xl border border-[var(--line)]">
        <table className="tt-table min-w-full text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white">#</th>
              {slip.columns.map((col, c) => (
                <th key={c} className="min-w-[7rem]">
                  <div className="font-medium leading-tight">{col.label}</div>
                  <div className="text-[10px] font-normal text-[var(--ink-muted)]">
                    {col.orderedBundles ?? 0} {hi ? "बंडल" : "bdl"}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {slip.rows.map((_, r) => (
              <tr key={r}>
                <td className="sticky left-0 bg-white tabular-nums text-[var(--ink-muted)]">
                  {r + 1}
                </td>
                {slip.columns.map((_, c) => {
                  const active = isCellActive(r, c);
                  return (
                    <td key={c}>
                      {active ? (
                        <input
                          data-vslip-cell={`${r}-${c}`}
                          className="tt-input w-full min-w-[4.5rem] tabular-nums"
                          inputMode="decimal"
                          value={cellDisplay(r, c)}
                          onChange={(e) => setCell(r, c, e.target.value)}
                          onKeyDown={(e) => onKeyDown(e, r, c)}
                          onFocus={(e) => {
                            try {
                              e.target.select();
                            } catch {
                              /* ignore */
                            }
                          }}
                          onBlur={() =>
                            setCellDrafts((d) => {
                              const next = { ...d };
                              delete next[cellKey(r, c)];
                              return next;
                            })
                          }
                        />
                      ) : (
                        <span className="text-[var(--ink-muted)]">—</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr className="bg-[var(--surface-2)] font-semibold">
              <td className="sticky left-0 bg-[var(--surface-2)]">
                {hi ? "जोड़ kg" : "Total kg"}
              </td>
              {kgTotals.map((kg, c) => (
                <td key={c} className="tabular-nums">
                  {kg > 0 ? kg.toFixed(2) : "—"}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
