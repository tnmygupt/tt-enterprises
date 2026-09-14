"use client";

import { NumberField } from "@/components/NumberField";
import {
  applyBillDiscounts,
  type ManualDiscountKind,
} from "@/lib/schemes";
import { formatInr } from "@/lib/pricing";

export function StaffBillDiscountFields({
  goodsSubtotal,
  schemeAmount,
  schemeLabel,
  kind,
  value,
  onKindChange,
  onValueChange,
  locale,
  disabled = false,
}: {
  goodsSubtotal: number;
  schemeAmount: number;
  schemeLabel?: string;
  kind?: ManualDiscountKind | "";
  value?: number | string;
  onKindChange: (kind: ManualDiscountKind | "") => void;
  onValueChange: (value: string) => void;
  locale: "en" | "hi";
  disabled?: boolean;
}) {
  const numericValue = Number(value);
  const applied = applyBillDiscounts({
    goodsSubtotal,
    schemeAmount,
    manualKind: kind,
    manualValue: Number.isFinite(numericValue) ? numericValue : 0,
  });
  const hi = locale === "hi";
  return (
    <div className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-3 text-sm">
      <p className="text-xs font-bold uppercase tracking-wide text-[var(--brand)]">
        {hi ? "इस बिल की छूट" : "This order discount"}
      </p>
      <div className="flex justify-between gap-2">
        <span className="text-[var(--ink-muted)]">
          {hi ? "स्कीम (ऑटो)" : "Scheme (auto)"}
          {schemeLabel ? ` · ${schemeLabel}` : ""}
        </span>
        <span className="tabular-nums font-semibold text-[var(--ok)]">
          {applied.schemeAmount > 0
            ? `−${formatInr(applied.schemeAmount, locale)}`
            : hi
              ? "कोई नहीं"
              : "None"}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-[minmax(0,11rem)_1fr]">
        <select
          className="tt-select"
          disabled={disabled}
          value={kind || ""}
          onChange={(e) =>
            onKindChange(e.target.value as ManualDiscountKind | "")
          }
        >
          <option value="">
            {hi ? "स्टाफ अतिरिक्त नहीं" : "No extra staff cut"}
          </option>
          <option value="percent">{hi ? "% छूट" : "% off goods"}</option>
          <option value="flat">{hi ? "₹ छूट" : "₹ off goods"}</option>
        </select>
        {kind ? (
          <NumberField
            emptyAs={null}
            step={kind === "percent" ? "0.1" : "1"}
            min={0}
            className="tt-input tabular-nums"
            disabled={disabled}
            placeholder={kind === "percent" ? (hi ? "%" : "%") : "₹"}
            value={value ?? ""}
            onValueChange={(v) =>
              onValueChange(v === "" ? "" : String(v))
            }
          />
        ) : null}
      </div>
      <p className="text-xs text-[var(--ink-muted)]">
        {hi
          ? "स्कीम + स्टाफ, माल की राशि तक। शिपिंग पर नहीं।"
          : "Scheme + staff, capped at goods amount. Not off shipping."}
      </p>
      {applied.manualAmount > 0 ? (
        <div className="flex justify-between gap-2 text-[var(--ok)]">
          <span>{hi ? "स्टाफ अतिरिक्त" : "Staff extra"}</span>
          <span className="tabular-nums">
            −{formatInr(applied.manualAmount, locale)}
          </span>
        </div>
      ) : null}
      {applied.total > 0 ? (
        <div className="flex justify-between gap-2 border-t border-[var(--line)] pt-2 font-semibold">
          <span>{hi ? "कुल छूट" : "Total off this bill"}</span>
          <span className="tabular-nums">
            −{formatInr(applied.total, locale)}
          </span>
        </div>
      ) : null}
    </div>
  );
}
