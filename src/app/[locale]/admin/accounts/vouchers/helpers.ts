import type { VoucherLine } from "@/lib/types";

export function blankLine(): VoucherLine {
  return {
    id: `vl_${crypto.randomUUID()}`,
    itemLabel: "",
    qty: 1,
    rate: 0,
    amount: 0,
    taxPercent: 0,
  };
}

export function blankChargeLine(preset: {
  accountId: string;
  label: string;
}): VoucherLine {
  return {
    id: `vl_${crypto.randomUUID()}`,
    itemLabel: preset.label,
    accountId: preset.accountId,
    qty: 1,
    secondaryQty: 1,
    rate: 0,
    amount: 0,
    taxPercent: 0,
  };
}

export function isChargeLine(l: VoucherLine): boolean {
  return !!l.accountId && !l.productId;
}

export function isEmptyItemLine(l: VoucherLine): boolean {
  return !isChargeLine(l) && !l.productId && !l.itemLabel.trim();
}

export function lastEmptyItemIndex(lines: VoucherLine[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (isEmptyItemLine(lines[i]!)) return i;
  }
  return -1;
}

export function lastItemLineIndex(lines: VoucherLine[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!isChargeLine(lines[i]!)) return i;
  }
  return -1;
}

/** Keep one trailing blank item row (Tally-style). */
export function withTrailingBlankItem(lines: VoucherLine[]): VoucherLine[] {
  if (lines.some(isEmptyItemLine)) return lines;
  return [...lines, blankLine()];
}

/** Fill the last empty item row, or append, then keep a trailing blank. */
export function mergeFilledItemLine(
  lines: VoucherLine[],
  filled: VoucherLine
): VoucherLine[] {
  const idx = lastEmptyItemIndex(lines);
  if (idx >= 0) {
    const next = [...lines];
    next[idx] = { ...filled, id: lines[idx]!.id };
    return withTrailingBlankItem(next);
  }
  return withTrailingBlankItem([...lines, filled]);
}

export const VOUCHER_TYPE_CHIPS: {
  type: string;
  label: string;
}[] = [
  { type: "", label: "All" },
  { type: "sale", label: "Sale" },
  { type: "receipt", label: "Receipt" },
  { type: "payment", label: "Payment" },
  { type: "purchase", label: "Purchase" },
  { type: "journal", label: "Journal" },
  { type: "credit_note", label: "Credit note" },
  { type: "debit_note", label: "Debit note" },
];
