import type {
  Product,
  SupplierContract,
  UnitOfSale,
} from "./types";
import { roundMoney } from "./pricing";

export function contractLockMode(
  c: SupplierContract
): "qty" | "value" {
  return c.lockMode === "value" ? "value" : "qty";
}

export function contractQtyLeft(c: SupplierContract): number {
  return Math.max(0, roundMoney(c.contractedQty - (c.usedQty || 0)));
}

/** ₹ left — value-locked uses usedValue; qty-locked derives rate × qtyLeft. */
export function contractValueLeft(c: SupplierContract): number {
  if (contractLockMode(c) === "value") {
    const committed = Math.max(0, c.contractedValue ?? 0);
    return Math.max(0, roundMoney(committed - (c.usedValue || 0)));
  }
  return roundMoney(contractQtyLeft(c) * (c.rate || 0));
}

export function isContractOpen(
  c: SupplierContract,
  asOf = new Date().toISOString().slice(0, 10)
): boolean {
  if (!c.active) return false;
  if (c.validFrom.slice(0, 10) > asOf) return false;
  if (c.validTo && c.validTo.slice(0, 10) < asOf) return false;
  if (contractLockMode(c) === "value") {
    return contractValueLeft(c) > 0.5;
  }
  return contractQtyLeft(c) > 0.009;
}

/**
 * Best matching open contract for supplier + product.
 * Priority: linked open contractId → exact variation → product (no variation) →
 * any product scope → category.
 */
export function resolveOpenContract(
  contracts: SupplierContract[],
  products: Product[],
  supplierId: string,
  productId: string | undefined,
  asOf = new Date().toISOString().slice(0, 10),
  opts?: { contractId?: string; variationId?: string }
): SupplierContract | undefined {
  if (opts?.contractId) {
    const linked = contracts.find((c) => c.id === opts.contractId);
    if (
      linked &&
      linked.supplierId === supplierId &&
      isContractOpen(linked, asOf)
    ) {
      return linked;
    }
  }

  if (!productId) return undefined;
  const product = products.find((p) => p.id === productId);
  if (!product) return undefined;

  const open = contracts.filter(
    (c) => c.supplierId === supplierId && isContractOpen(c, asOf)
  );

  if (opts?.variationId) {
    const exactVar = open.find(
      (c) =>
        c.scope === "product" &&
        c.productId === productId &&
        c.variationId === opts.variationId
    );
    if (exactVar) return exactVar;
  }

  const byProduct = open.find(
    (c) =>
      c.scope === "product" &&
      c.productId === productId &&
      !c.variationId
  );
  if (byProduct) return byProduct;

  const anyProduct = open.find(
    (c) => c.scope === "product" && c.productId === productId
  );
  if (anyProduct) return anyProduct;

  return open.find(
    (c) => c.scope === "category" && c.categoryId === product.category
  );
}

/**
 * Remaining qty this lift may take against a contract (0 when exhausted).
 * Value-locked contracts convert leftover ₹ at `rate`.
 */
export function contractHeadroomQty(
  contract: SupplierContract,
  wantQty: number,
  rate = contract.rate
): { qty: number; capped: boolean; exhausted: boolean } {
  const want = Math.max(0, wantQty);
  let max = want;
  if (contractLockMode(contract) === "value") {
    const left = contractValueLeft(contract);
    if (!(rate > 0)) {
      max = left > 0.5 ? want : 0;
    } else {
      max = Math.floor((left + 1e-9) / rate);
    }
  } else {
    max = contractQtyLeft(contract);
  }
  const qty = Math.max(0, Math.min(want, max));
  return {
    qty,
    capped: want > 0 && qty + 1e-9 < want,
    exhausted: want > 0 && qty <= 0,
  };
}

function isContractInForce(
  c: SupplierContract,
  asOf = new Date().toISOString().slice(0, 10)
): boolean {
  if (!c.active) return false;
  if (c.validFrom.slice(0, 10) > asOf) return false;
  if (c.validTo && c.validTo.slice(0, 10) < asOf) return false;
  return true;
}

/**
 * Matching in-force contract for reorder headroom — includes exhausted
 * books so a used-up contract cannot silently allow an over-lift.
 */
export function resolveInForceContract(
  contracts: SupplierContract[],
  products: Product[],
  supplierId: string,
  productId: string | undefined,
  asOf = new Date().toISOString().slice(0, 10),
  opts?: { contractId?: string; variationId?: string }
): SupplierContract | undefined {
  if (opts?.contractId) {
    const linked = contracts.find((c) => c.id === opts.contractId);
    if (
      linked &&
      linked.supplierId === supplierId &&
      isContractInForce(linked, asOf)
    ) {
      return linked;
    }
  }

  if (!productId) return undefined;
  const product = products.find((p) => p.id === productId);
  if (!product) return undefined;

  const open = contracts.filter(
    (c) => c.supplierId === supplierId && isContractInForce(c, asOf)
  );

  if (opts?.variationId) {
    const exactVar = open.find(
      (c) =>
        c.scope === "product" &&
        c.productId === productId &&
        c.variationId === opts.variationId
    );
    if (exactVar) return exactVar;
  }

  const byProduct = open.find(
    (c) =>
      c.scope === "product" &&
      c.productId === productId &&
      !c.variationId
  );
  if (byProduct) return byProduct;

  const anyProduct = open.find(
    (c) => c.scope === "product" && c.productId === productId
  );
  if (anyProduct) return anyProduct;

  return open.find(
    (c) => c.scope === "category" && c.categoryId === product.category
  );
}

/** @deprecated prefer resolveOpenContract — kept for call-site compatibility */
export function findContractForProduct(
  contracts: SupplierContract[],
  products: Product[],
  supplierId: string,
  productId: string | undefined,
  asOf = new Date().toISOString().slice(0, 10)
): SupplierContract | undefined {
  return resolveOpenContract(contracts, products, supplierId, productId, asOf);
}

/**
 * Consume contract against a lift. Qty is always recorded; value-locked also
 * burns ₹ at `rate × qty` (capped by remaining value).
 */
export function applyContractUsage(
  contract: SupplierContract,
  qtyInUnit: number,
  rate = contract.rate
): void {
  const qty = Math.max(0, qtyInUnit);
  if (qty <= 0) return;

  if (contractLockMode(contract) === "value") {
    const valueLeft = contractValueLeft(contract);
    const want = roundMoney(qty * Math.max(0, rate));
    const useValue = Math.min(valueLeft, want);
    if (useValue <= 0) return;
    // Scale qty to what the remaining ₹ can buy at this rate
    const useQty =
      rate > 0 ? roundMoney(useValue / rate) : qty;
    contract.usedValue = roundMoney((contract.usedValue || 0) + useValue);
    contract.usedQty = roundMoney((contract.usedQty || 0) + useQty);
    return;
  }

  const left = contractQtyLeft(contract);
  const use = Math.min(left, qty);
  contract.usedQty = roundMoney((contract.usedQty || 0) + use);
}

/** Undo a previous applyContractUsage (void purchase / GRN). */
export function reverseContractUsage(
  contract: SupplierContract,
  qtyInUnit: number,
  rate = contract.rate
): void {
  const qty = Math.max(0, qtyInUnit);
  if (qty <= 0) return;
  contract.usedQty = Math.max(
    0,
    roundMoney((contract.usedQty || 0) - qty)
  );
  if (contractLockMode(contract) === "value") {
    const value = roundMoney(qty * Math.max(0, rate));
    contract.usedValue = Math.max(
      0,
      roundMoney((contract.usedValue || 0) - value)
    );
  }
}

export function formatContractLabel(
  c: SupplierContract,
  showRate: boolean,
  unitLabelFn: (u: UnitOfSale) => string
): string {
  const ratePart = showRate
    ? ` @ ₹${c.rate}/${unitLabelFn(c.unit)}`
    : "";
  if (contractLockMode(c) === "value") {
    return `${c.number} · ${c.itemLabel}${ratePart} · left ₹${contractValueLeft(c)}`;
  }
  const left = contractQtyLeft(c);
  return `${c.number} · ${c.itemLabel}${ratePart} · left ${left} ${unitLabelFn(c.unit)}`;
}

/** Group flat contract rows that share a CTR number (multi-line book). */
export function groupContractsByNumber(
  contracts: SupplierContract[]
): { number: string; lines: SupplierContract[] }[] {
  const map = new Map<string, SupplierContract[]>();
  for (const c of contracts) {
    const list = map.get(c.number) ?? [];
    list.push(c);
    map.set(c.number, list);
  }
  return [...map.entries()]
    .map(([number, lines]) => ({
      number,
      lines: lines.sort((a, b) => a.itemLabel.localeCompare(b.itemLabel)),
    }))
    .sort((a, b) => b.number.localeCompare(a.number));
}
