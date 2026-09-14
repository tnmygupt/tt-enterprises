import { describe, expect, it } from "vitest";
import {
  isPurchaseCostVoucherType,
  staffMustHideVoucherRupees,
} from "./owner-sensitive";

describe("owner-sensitive voucher masks", () => {
  it("treats purchase and debit notes as cost types", () => {
    expect(isPurchaseCostVoucherType("purchase")).toBe(true);
    expect(isPurchaseCostVoucherType("debit_note")).toBe(true);
    expect(isPurchaseCostVoucherType("sale")).toBe(false);
    expect(isPurchaseCostVoucherType("payment")).toBe(false);
  });

  it("hides mill payments from staff but not the owner", () => {
    expect(staffMustHideVoucherRupees("payment", false)).toBe(true);
    expect(staffMustHideVoucherRupees("purchase", false)).toBe(true);
    expect(staffMustHideVoucherRupees("sale", false)).toBe(false);
    expect(staffMustHideVoucherRupees("payment", true)).toBe(false);
  });
});
