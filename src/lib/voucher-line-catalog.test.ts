import { describe, expect, it } from "vitest";
import {
  blankChargeLine,
  blankLine,
  lastEmptyItemIndex,
  mergeFilledItemLine,
  withTrailingBlankItem,
} from "@/app/[locale]/admin/accounts/vouchers/helpers";
import { catalogRowValue } from "./inventory";
import type { Product, SupplierContract, VoucherLine } from "./types";
import { applyCatalogToVoucherLine } from "./voucher-line-catalog";

function makeProduct(stock = 10): Product {
  return {
    id: "p1",
    code: "TARP",
    category: "tarpaulin",
    itemName: { en: "Tarpaulin", hi: "तिरपाल" },
    name: { en: "HDPE", hi: "एचडीपीई" },
    description: { en: "", hi: "" },
    unit: "kg",
    baseRate: 100,
    baseWeightKg: 35,
    pricingMode: "bundle",
    minOrderQty: 1,
    stock,
    stockSecondary: stock * 35,
    variations: [
      {
        id: "v1",
        label: { en: "12x18", hi: "12x18" },
        size: { en: "12x18", hi: "12x18" },
        sku: "T-1218",
        rate: 100,
        weightKg: 35,
        stock,
        stockSecondary: stock * 35,
      },
    ],
    colors: [
      {
        id: "c1",
        name: { en: "Blue", hi: "नीला" },
        hex: "#00f",
      },
    ],
    stockMatrix: { "v1__c1": stock },
    media: [],
    active: true,
    featured: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

const catalogValue = catalogRowValue({
  productId: "p1",
  variationId: "v1",
  colorId: "c1",
});

function catalogRow(stock: number) {
  return {
    productId: "p1",
    variationId: "v1",
    colorId: "c1",
    name: "HDPE · 12x18 · Blue",
    stock,
  };
}

function apply(opts: {
  type: "sale" | "purchase";
  stock?: number;
  line?: VoucherLine;
  partyId?: string;
  contracts?: SupplierContract[];
}) {
  const stock = opts.stock ?? 10;
  return applyCatalogToVoucherLine({
    line: opts.line ?? blankLine(),
    catalogValue,
    catalogItems: [catalogRow(stock)],
    products: [makeProduct(stock)],
    type: opts.type,
    partyId: opts.partyId,
    date: "2026-01-02",
    contracts: opts.contracts,
  });
}

describe("applyCatalogToVoucherLine", () => {
  it("fills a line from a catalog value", () => {
    const result = apply({ type: "sale" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cleared).toBe(false);
    expect(result.line.productId).toBe("p1");
    expect(result.line.variationId).toBe("v1");
    expect(result.line.colorId).toBe("c1");
    expect(result.line.itemLabel).toBe("HDPE · 12x18 · Blue");
    expect(result.line.unit).toBe("kg");
    expect(result.line.qty).toBe(1);
    expect(result.line.secondaryQty).toBe(35);
    expect(result.line.rate).toBe(100);
    expect(result.line.amount).toBe(3500);
  });

  it("rejects sale of an out-of-stock catalog row", () => {
    const result = apply({ type: "sale", stock: 0 });
    expect(result).toEqual({
      ok: false,
      error: "Out of stock: HDPE · 12x18 · Blue",
    });
  });

  it("still fills a purchase line when stock is 0", () => {
    const result = apply({ type: "purchase", stock: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.line.productId).toBe("p1");
    expect(result.line.rate).toBe(100);
  });

  it("uses the open supplier contract rate on purchase", () => {
    const contract: SupplierContract = {
      id: "c1",
      number: "SC-1",
      supplierId: "s1",
      date: "2026-01-01",
      validFrom: "2026-01-01",
      scope: "product",
      productId: "p1",
      variationId: "v1",
      itemLabel: "HDPE",
      unit: "kg",
      rate: 88,
      contractedQty: 100,
      usedQty: 0,
      lockMode: "qty",
      active: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      createdBy: "test",
    };
    const result = apply({
      type: "purchase",
      partyId: "s1",
      contracts: [contract],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.line.rate).toBe(88);
  });
});

describe("trailing blank item rows", () => {
  it("reuses the last empty item line then keeps a trailing blank", () => {
    const empty = blankLine();
    const filled = {
      ...empty,
      productId: "p1",
      itemLabel: "HDPE",
      qty: 1,
      rate: 100,
      amount: 100,
    };
    const next = mergeFilledItemLine([empty], filled);
    expect(next).toHaveLength(2);
    expect(next[0]?.id).toBe(empty.id);
    expect(next[0]?.productId).toBe("p1");
    expect(next[1]?.productId).toBeUndefined();
    expect(next[1]?.itemLabel).toBe("");
    expect(lastEmptyItemIndex(next)).toBe(1);
  });

  it("appends when every item line is filled", () => {
    const filled: VoucherLine = {
      ...blankLine(),
      productId: "p1",
      itemLabel: "HDPE",
      qty: 1,
      rate: 100,
      amount: 100,
    };
    const extra: VoucherLine = {
      ...blankLine(),
      productId: "p2",
      itemLabel: "Shade",
      qty: 2,
      rate: 50,
      amount: 100,
    };
    const next = mergeFilledItemLine([filled], extra);
    expect(next).toHaveLength(3);
    expect(next[0]?.productId).toBe("p1");
    expect(next[1]?.productId).toBe("p2");
    expect(next[2]?.itemLabel).toBe("");
  });

  it("does not treat charge lines as empty item slots", () => {
    const charge = blankChargeLine({
      accountId: "acct_freight",
      label: "Freight",
    });
    const filled: VoucherLine = {
      ...blankLine(),
      productId: "p1",
      itemLabel: "HDPE",
    };
    const next = mergeFilledItemLine([charge], filled);
    expect(next[0]?.accountId).toBe("acct_freight");
    expect(next[1]?.productId).toBe("p1");
    expect(next.some((l) => !l.productId && !l.accountId && !l.itemLabel)).toBe(
      true
    );
  });

  it("withTrailingBlankItem is a no-op when an empty item already exists", () => {
    const empty = blankLine();
    expect(withTrailingBlankItem([empty])).toEqual([empty]);
  });
});
