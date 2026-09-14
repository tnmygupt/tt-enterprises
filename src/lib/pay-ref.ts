import type { PaymentProofItem } from "./types";

/** Compact base that still fits UPI `tn` (50 chars) with `-P12`. */
export function compactPayBase(orderNumber: string): string {
  const base = (orderNumber || "PAY").replace(/\s+/g, "");
  return base.slice(0, 40) || "PAY";
}

/** Next attempt ref, e.g. TT-104-P2. */
export function nextPayRef(
  orderNumber: string,
  existingCount: number
): string {
  const n = Math.max(0, Math.floor(existingCount)) + 1;
  return `${compactPayBase(orderNumber)}-P${n}`;
}

export function nextPayRefFromItems(
  orderNumber: string,
  items: PaymentProofItem[] | undefined
): string {
  return nextPayRef(orderNumber, items?.length ?? 0);
}

export function parsePaySeq(ref: string): number | null {
  const m = /-P(\d+)$/.exec(ref.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}
