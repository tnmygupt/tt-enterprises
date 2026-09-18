import type {
  StockBatch,
  BatchConsumption,
  Voucher,
  VoucherLine,
  UnitOfSale,
} from "../types";
import { isSqftUnit, roundMoney } from "../pricing";

/** Measure voucher line in secondary units (kg/pcs) */
export function lineMeasure(line: VoucherLine): number {
  return line.secondaryQty ?? line.qty;
}

/** Key for matching batches to consumption */
export function batchKey(
  productId: string,
  variationId?: string,
  colorId?: string
): string {
  return `${productId}|${variationId ?? ""}|${colorId ?? ""}`;
}

interface CreateBatchOpts {
  date: string;
  productId: string;
  variationId?: string;
  colorId?: string;
  qty: number;
  rate: number;
  unit?: UnitOfSale;
  source: "purchase" | "grn" | "opening" | "adjustment" | "sale_return" | "production";
  voucherId?: string;
  grnId?: string;
  provisional?: boolean;
}

export function createBatchFromLine(opts: CreateBatchOpts): StockBatch {
  return {
    id: `batch_${crypto.randomUUID()}`,
    date: opts.date.slice(0, 10),
    productId: opts.productId,
    variationId: opts.variationId,
    colorId: opts.colorId,
    qty: opts.qty,
    originalQty: opts.qty,
    rate: opts.rate,
    unit: opts.unit,
    source: opts.source,
    voucherId: opts.voucherId,
    grnId: opts.grnId,
    provisional: opts.provisional,
    createdAt: new Date().toISOString(),
  };
}

interface AddPurchaseLayersOpts {
  provisional?: boolean;
  source?: "purchase" | "grn" | "opening" | "adjustment" | "sale_return" | "production";
}

/** Add purchase/GRN batches for a voucher */
export function addPurchaseLayers(
  batches: StockBatch[],
  voucher: Voucher,
  opts: AddPurchaseLayersOpts = {}
): void {
  const source = opts.source ?? "purchase";
  for (const line of voucher.lines) {
    if (!line.productId) continue;
    const measure = lineMeasure(line);
    if (isSqftUnit(line.unit)) {
      const packets = line.qty;
      if (!(packets > 0)) continue;
      const pktRate = roundMoney(line.amount / packets);
      batches.push(
        createBatchFromLine({
          date: voucher.date,
          productId: line.productId,
          variationId: line.variationId,
          colorId: line.colorId,
          qty: packets,
          rate: pktRate,
          unit: line.unit,
          source,
          voucherId: voucher.id,
          provisional: opts.provisional,
        })
      );
      continue;
    }
    if (measure <= 0) continue;
    batches.push(
      createBatchFromLine({
        date: voucher.date,
        productId: line.productId,
        variationId: line.variationId,
        colorId: line.colorId,
        qty: measure,
        rate: line.rate,
        unit: line.unit,
        source,
        voucherId: voucher.id,
        provisional: opts.provisional,
      })
    );
  }
}

interface ConsumptionInput {
  voucherId: string;
  date: string;
  lines: {
    productId: string;
    variationId?: string;
    colorId?: string;
    qty: number;
  }[];
  allowShortfall?: boolean;
}

interface ConsumptionResult {
  totalCost: number;
  consumptions: BatchConsumption[];
}

/** Consume stock using FIFO from oldest batches */
export function consumeFifo(
  batches: StockBatch[],
  consumptions: BatchConsumption[],
  input: ConsumptionInput
): ConsumptionResult {
  const result: BatchConsumption[] = [];
  let totalCost = 0;

  for (const reqLine of input.lines) {
    let remaining = reqLine.qty;
    if (remaining <= 0) continue;

    // Find matching batches (same product+variation; color optional)
    const candidates = batches
      .filter((b) => {
        if (b.productId !== reqLine.productId) return false;
        if (b.variationId !== reqLine.variationId) return false;
        // If consumption has colorId, batch must match; else match any color
        if (reqLine.colorId && b.colorId !== reqLine.colorId) return false;
        return b.qty > 0;
      })
      .sort((a, b) => {
        // Oldest first
        const dateCompare = a.date.localeCompare(b.date);
        if (dateCompare !== 0) return dateCompare;
        return a.createdAt.localeCompare(b.createdAt);
      });

    for (const batch of candidates) {
      if (remaining <= 0.0001) break;
      const consume = Math.min(remaining, batch.qty);
      const cost = roundMoney(consume * batch.rate);

      const consumption: BatchConsumption = {
        id: `bc_${crypto.randomUUID()}`,
        date: input.date.slice(0, 10),
        batchId: batch.id,
        voucherId: input.voucherId,
        productId: reqLine.productId,
        variationId: reqLine.variationId,
        colorId: reqLine.colorId || batch.colorId,
        qty: consume,
        rate: batch.rate,
        costAmount: cost,
        createdAt: new Date().toISOString(),
      };
      result.push(consumption);
      consumptions.push(consumption);

      batch.qty = roundMoney(batch.qty - consume);
      totalCost = roundMoney(totalCost + cost);
      remaining = roundMoney(remaining - consume);
    }

    // Handle shortfall
    if (remaining > 0.0001) {
      if (!input.allowShortfall) {
        throw new Error(
          `Insufficient stock layers for ${reqLine.productId} (${reqLine.variationId ?? "no variation"}): needed ${reqLine.qty}, short by ${remaining}`
        );
      }
      // Cost missing qty at 0 (or skip recording?)
      // For migration, we just skip — historical sales stay as-is
    }
  }

  return {
    totalCost: roundMoney(totalCost),
    consumptions: result,
  };
}

/** Reverse costing for a voided voucher */
export function reverseVoucherCosting(
  batches: StockBatch[],
  consumptions: BatchConsumption[],
  voucherId: string
): void {
  // Restore batch qty from consumptions
  const voucherConsumptions = consumptions.filter(
    (c) => c.voucherId === voucherId
  );
  for (const c of voucherConsumptions) {
    const batch = batches.find((b) => b.id === c.batchId);
    if (batch) {
      batch.qty = roundMoney(batch.qty + c.qty);
    }
  }

  // Remove consumptions
  for (let i = consumptions.length - 1; i >= 0; i--) {
    if (consumptions[i].voucherId === voucherId) {
      consumptions.splice(i, 1);
    }
  }

  // Remove batches created by this voucher
  for (let i = batches.length - 1; i >= 0; i--) {
    if (batches[i].voucherId === voucherId) {
      batches.splice(i, 1);
    }
  }
}

interface ValuationRow {
  productId: string;
  variationId?: string;
  colorId?: string;
  qty: number;
  avgRate: number;
  value: number;
  hasProvisional: boolean;
}

/** Stock valuation from remaining batches */
export function stockValuation(batches: StockBatch[]): ValuationRow[] {
  const map = new Map<string, ValuationRow>();

  for (const batch of batches) {
    if (batch.qty <= 0) continue;
    const key = batchKey(batch.productId, batch.variationId, batch.colorId);
    const existing = map.get(key);
    const batchValue = roundMoney(batch.qty * batch.rate);

    if (existing) {
      existing.qty = roundMoney(existing.qty + batch.qty);
      existing.value = roundMoney(existing.value + batchValue);
      if (batch.provisional) existing.hasProvisional = true;
    } else {
      map.set(key, {
        productId: batch.productId,
        variationId: batch.variationId,
        colorId: batch.colorId,
        qty: batch.qty,
        avgRate: batch.rate,
        value: batchValue,
        hasProvisional: batch.provisional || false,
      });
    }
  }

  // Recompute avg rate
  for (const row of map.values()) {
    row.avgRate = row.qty > 0 ? roundMoney(row.value / row.qty) : 0;
  }

  return [...map.values()].sort((a, b) => b.value - a.value);
}
