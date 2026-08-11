import { describe, expect, it } from "vitest";
import {
  calcLineTotal,
  resolveRate,
  roundOffRupees,
  roundMoney,
} from "./pricing";
import type { Product, ProductVariation } from "./types";

const product = {
  id: "p1",
  baseRate: 100,
  pricingMode: "bundle",
} as Product;

const variation = {
  id: "v1",
  rate: 120,
} as ProductVariation;

describe("pricing", () => {
  it("calcLineTotal for bundle uses rate × weightKg", () => {
    expect(
      calcLineTotal({
        pricingMode: "bundle",
        rate: 10,
        quantity: 2,
        weightKg: 35,
      })
    ).toBe(350);
  });

  it("calcLineTotal for pcs uses rate × quantity", () => {
    expect(
      calcLineTotal({
        pricingMode: "pcs",
        rate: 25,
        quantity: 4,
        weightKg: 999,
      })
    ).toBe(100);
  });

  it("resolveRate prefers variation rate", () => {
    expect(resolveRate(product, variation)).toBe(120);
    expect(resolveRate(product, undefined)).toBe(100);
  });

  it("roundOffRupees rounds to nearest whole rupee", () => {
    expect(roundOffRupees(10.4)).toBe(10);
    expect(roundOffRupees(10.5)).toBe(11);
    expect(roundOffRupees(10.6)).toBe(11);
  });

  it("roundMoney keeps two decimals", () => {
    expect(roundMoney(1.005)).toBe(1.01);
    expect(roundMoney(10.999)).toBe(11);
  });
});
