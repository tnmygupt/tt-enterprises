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
