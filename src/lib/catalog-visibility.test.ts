import { describe, expect, it } from "vitest";
import { publicCatalogProjection } from "./server/authorize-db";
import type { AppDatabase } from "./store/db";
import type { Product } from "./types";
import { isPublicCatalogProduct, isRawMaterial } from "./catalog-visibility";

function product(partial: Partial<Product> & Pick<Product, "id">): Product {
  return {
    code: partial.id,
    category: "tarpaulin",
    itemName: { en: partial.id, hi: partial.id },
    name: { en: partial.id, hi: partial.id },
    description: { en: "", hi: "" },
    unit: "kg",
    baseRate: 10,
    pricingMode: "bundle",
    variations: [],
    colors: [],
    media: [],
    active: true,
    featured: false,
    stock: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  } as Product;
}

describe("catalog visibility", () => {
  it("treats only an explicit raw-material flag as hidden", () => {
    expect(isRawMaterial(product({ id: "sheet" }))).toBe(false);
    expect(isPublicCatalogProduct(product({ id: "sheet" }))).toBe(true);
    expect(
      isPublicCatalogProduct(product({ id: "resin", rawMaterial: true }))
    ).toBe(false);
    expect(
      isPublicCatalogProduct(product({ id: "old", active: false }))
    ).toBe(false);
  });

  it("omits raw materials from the public catalog", () => {
    const db = {
      products: [
        product({ id: "sheet", name: { en: "Sheet", hi: "शीट" } }),
        product({
          id: "resin",
          name: { en: "Resin", hi: "रेजिन" },
          rawMaterial: true,
        }),
      ],
      schemes: [],
      categories: [],
      shippingRules: [],
      settings: { companyName: "TT" },
    } as unknown as AppDatabase;
    const pub = publicCatalogProjection(db);
    expect(pub.products.map((p) => p.id)).toEqual(["sheet"]);
  });
});
