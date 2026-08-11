import type { Party, Voucher, VoucherType } from "../types";
import { roundMoney } from "../pricing";

export type PartyGoodsLine = {
  date: string;
  voucherId: string;
  voucherNumber: string;
  voucherType: VoucherType;
  itemLabel: string;
  bundles: number;
  secondaryQty: number;
  unit?: string;
  rate: number;
  amount: number;
};

/**
 * Explode sale/purchase vouchers for a party into stock lines — used by the
 * Goods view on party statement (rate, kg, bundles).
 */
export function partyGoodsLines(
  party: Party,
  vouchers: Voucher[],
  from: string,
  to: string
): PartyGoodsLine[] {
  const wantType: VoucherType =
    party.type === "supplier" ? "purchase" : "sale";
  const out: PartyGoodsLine[] = [];
  for (const v of vouchers) {
    if (v.voided) continue;
    if (v.partyId !== party.id) continue;
    if (v.type !== wantType) continue;
    if (v.date < from || v.date > to) continue;
    for (const line of v.lines) {
      if (!line.productId && !line.itemLabel) continue;
      // Skip pure account charge lines on mixed vouchers
      if (line.accountId && !line.productId) continue;
      out.push({
        date: v.date,
        voucherId: v.id,
        voucherNumber: v.number,
        voucherType: v.type,
        itemLabel: line.itemLabel,
        bundles: line.qty,
        secondaryQty: line.secondaryQty ?? line.qty,
        unit: line.unit,
        rate: line.rate,
        amount: roundMoney(line.amount),
      });
    }
  }
  return out.sort(
    (a, b) => a.date.localeCompare(b.date) || a.voucherNumber.localeCompare(b.voucherNumber)
  );
}
