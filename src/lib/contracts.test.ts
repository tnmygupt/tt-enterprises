import { describe, expect, it } from "vitest";
import {
  applyContractUsage,
  reverseContractUsage,
  contractHeadroomQty,
  contractQtyLeft,
  contractValueLeft,
} from "./contracts";
import type { SupplierContract } from "./types";

function qtyContract(partial?: Partial<SupplierContract>): SupplierContract {
  return {
    id: "c1",
    number: "SC-1",
    supplierId: "s1",
    date: "2026-01-01",
    validFrom: "2026-01-01",
    scope: "product",
    productId: "p1",
    itemLabel: "HDPE",
    unit: "kg",
    rate: 100,
    contractedQty: 100,
    usedQty: 0,
    lockMode: "qty",
    active: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "test",
    ...partial,
  };
}

function valueContract(partial?: Partial<SupplierContract>): SupplierContract {
  return qtyContract({
    lockMode: "value",
    contractedValue: 10000,
    usedValue: 0,
    contractedQty: 0,
    ...partial,
  });
}

describe("contracts", () => {
  it("qty lock apply then reverse round-trips", () => {
    const c = qtyContract();
    applyContractUsage(c, 40, 100);
    expect(contractQtyLeft(c)).toBe(60);
    expect(c.usedQty).toBe(40);
    reverseContractUsage(c, 40, 100);
    expect(contractQtyLeft(c)).toBe(100);
    expect(c.usedQty).toBe(0);
  });

  it("value lock apply then reverse round-trips", () => {
    const c = valueContract();
    applyContractUsage(c, 25, 100); // ₹2500
    expect(contractValueLeft(c)).toBe(7500);
    expect(c.usedValue).toBe(2500);
    reverseContractUsage(c, 25, 100);
    expect(contractValueLeft(c)).toBe(10000);
    expect(c.usedValue).toBe(0);
  });

  it("qty lock does not exceed remaining", () => {
    const c = qtyContract({ contractedQty: 10 });
    applyContractUsage(c, 50, 100);
    expect(c.usedQty).toBe(10);
    expect(contractQtyLeft(c)).toBe(0);
  });

  it("caps a suggested lift to remaining qty or value", () => {
    expect(contractHeadroomQty(qtyContract({ usedQty: 90 }), 20, 100)).toEqual({
      qty: 10,
      capped: true,
      exhausted: false,
    });
    expect(contractHeadroomQty(qtyContract({ usedQty: 100 }), 20, 100)).toEqual({
      qty: 0,
      capped: true,
      exhausted: true,
    });
    expect(contractHeadroomQty(valueContract({ usedValue: 9500 }), 20, 100)).toEqual({
      qty: 5,
      capped: true,
      exhausted: false,
    });
  });
});
