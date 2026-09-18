import { resolveOpenContract } from "./contracts";
import {
  deriveSecondaryQty,
  parseCatalogRowValue,
  voucherLineAmount,
} from "./inventory";
import { isSqftUnit, resolveSqftPack } from "./pricing";
import type {
  Product,
  SupplierContract,
  VoucherLine,
  VoucherType,
} from "./types";

export type CatalogPickRow = {
  productId: string;
  variationId?: string;
  colorId?: string;
  name: string;
  stock: number;
};

export type ApplyCatalogResult =
  | { ok: true; line: VoucherLine; cleared: boolean }
  | { ok: false; error: string };

/** Fill or clear a voucher item line from a catalog SearchSelect value. */
export function applyCatalogToVoucherLine(opts: {
  line: VoucherLine;
  catalogValue: string;
  catalogItems: CatalogPickRow[];
  products: Product[];
  type: VoucherType;
  partyId?: string;
  date?: string;
  contracts?: SupplierContract[];
}): ApplyCatalogResult {
  const { line, catalogValue, catalogItems, products, type } = opts;
  if (!catalogValue) {
    return {
      ok: true,
      cleared: true,
      line: {
        ...line,
        productId: undefined,
        variationId: undefined,
        colorId: undefined,
        unit: undefined,
        accountId: undefined,
      },
    };
  }

  const { productId, variationId, colorId } =
    parseCatalogRowValue(catalogValue);
  const item = catalogItems.find(
    (c) =>
      c.productId === productId &&
      (c.variationId ?? "") === (variationId || "") &&
      (c.colorId ?? "") === (colorId || "")
  );
  if (type === "sale" && item && !(item.stock > 0)) {
    return { ok: false, error: `Out of stock: ${item.name}` };
  }

  const prod = products.find((p) => p.id === productId);
  const variation = prod?.variations.find((v) => v.id === variationId);
  const contract =
    type === "purchase" && opts.partyId
      ? resolveOpenContract(
          opts.contracts ?? [],
          products,
          opts.partyId,
          productId,
          opts.date,
          { variationId: variationId || undefined }
        )
      : undefined;
  const rate =
    isSqftUnit(prod?.unit) && prod
      ? (contract?.rate ?? resolveSqftPack(prod, variation).ratePerSqft)
      : (contract?.rate ?? variation?.rate ?? prod?.baseRate ?? line.rate);
  const qty = line.qty || 1;
  const unit = prod?.unit;
  const secondaryQty = prod
    ? deriveSecondaryQty(prod, qty, variationId || undefined)
    : qty;
  const updated: VoucherLine = {
    ...line,
    productId,
    variationId: variationId || undefined,
    colorId: colorId || undefined,
    accountId: undefined,
    itemLabel: item?.name || line.itemLabel,
    unit,
    qty,
    secondaryQty,
    rate,
    amount: 0,
  };
  updated.amount = voucherLineAmount(updated, prod);
  return { ok: true, cleared: false, line: updated };
}
