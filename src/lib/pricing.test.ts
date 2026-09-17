import { describe, expect, it } from "vitest";
import {
  calcLineTotal,
  packetWeightKgFromGsm,
  pcsPerPacketLabel,
  piecesInPacketLine,
  pieceWeightGFromGsm,
  pieceWeightKgFromGsm,
  ratePerPacket,
  ratePerPiece,
  resolvePcsPerPacket,
  resolveRate,
  resolveUnitWeightKg,
  resolveWeightKg,
  roundOffRupees,
  roundMoney,
  sqftPacketAmount,
  sqftPerPiece,
  sqftSizeLabel,
  unitLabel,
} from "./pricing";
import { applyBillDiscounts, lineDiscountedRate, lineOrderDiscountTier, orderDiscountMathLabel, resolveOrderDiscount } from "./schemes";
import type { OrderLine, Product, ProductVariation, Scheme } from "./types";

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

  it("sqft helpers: 12×18, 10 pcs/pkt, ₹2/sqft", () => {
    expect(sqftPerPiece(12, 18)).toBe(216);
    expect(sqftSizeLabel(12, 18)).toBe("12×18 ft");
    expect(ratePerPiece(2, 12, 18)).toBe(432);
    expect(ratePerPacket(2, 12, 18, 10)).toBe(4320);
    expect(
      sqftPacketAmount({
        packets: 2,
        ratePerSqft: 2,
        lengthFt: 12,
        widthFt: 18,
        pcsPerPacket: 10,
      })
    ).toBe(8640);
    expect(unitLabel("sqft", "en")).toBe("sq/ft");
    expect(unitLabel("sqft", "hi")).toBe("वर्ग फुट");
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

describe("GSM packet weight", () => {
  const silpauline = {
    id: "silp",
    baseRate: 2,
    pricingMode: "pcs",
    unit: "sqft",
    gsm: 120,
    lengthFt: 12,
    widthFt: 18,
    pcsPerPacket: 10,
    baseWeightKg: 1,
  } as Product;

  it("uses L × W × GSM × 0.092903 for grams and /1000 for kg", () => {
    expect(pieceWeightGFromGsm(12, 18, 120)).toBe(
      roundMoney(12 * 18 * 120 * 0.092903)
    );
    expect(pieceWeightGFromGsm(12, 18, 120)).toBe(2408.05);
    expect(pieceWeightKgFromGsm(12, 18, 120)).toBe(
      roundMoney((12 * 18 * 120 * 0.092903) / 1000)
    );
    expect(pieceWeightKgFromGsm(12, 18, 120)).toBe(2.41);
  });

  it("multiplies sheet kg by pcs for kg/pkt without compounding rounding", () => {
    expect(packetWeightKgFromGsm(12, 18, 120, 10)).toBe(
      roundMoney((12 * 18 * 120 * 10 * 0.092903) / 1000)
    );
    expect(packetWeightKgFromGsm(12, 18, 120, 10)).toBe(24.08);
  });

  it("resolveWeightKg uses GSM when pack kg is blank", () => {
    const variation = {
      id: "v1",
      rate: 2,
      lengthFt: 12,
      widthFt: 18,
      pcsPerPacket: 10,
    } as ProductVariation;
    expect(resolveUnitWeightKg(silpauline, variation)).toBe(24.08);
    expect(resolveWeightKg(silpauline, variation, 2)).toBe(48.16);
    expect(pcsPerPacketLabel(10, "en")).toBe("10 pcs/pkt");
    expect(pcsPerPacketLabel(10, "hi")).toBe("10 पीस/पैकेट");
    expect(piecesInPacketLine(10, "en")).toBe("10 pieces in 1 packet");
    expect(piecesInPacketLine(10, "hi")).toBe("10 पीस 1 पैकेट में");
  });

  it("uses product pcs when variation pcs is 0, and infers from pkt/pc rates", () => {
    expect(
      resolvePcsPerPacket(
        { pcsPerPacket: 12 } as Product,
        { pcsPerPacket: 0 } as ProductVariation
      )
    ).toBe(12);
    expect(
      resolvePcsPerPacket(
        {
          unit: "sqft",
          ratePerSqft: 4,
          lengthFt: 12,
          widthFt: 15,
        } as Product,
        {
          rate: 8640,
          lengthFt: 12,
          widthFt: 15,
          ratePerSqft: 4,
        } as ProductVariation
      )
    ).toBe(12);
  });

  it("keeps a typed pack-kg override", () => {
    const variation = {
      id: "v1",
      rate: 2,
      lengthFt: 12,
      widthFt: 18,
      pcsPerPacket: 10,
      weightKg: 20,
    } as ProductVariation;
    expect(resolveUnitWeightKg(silpauline, variation)).toBe(20);
    expect(resolveWeightKg(silpauline, variation, 3)).toBe(60);
  });

  it("ignores leftover dummy 1 kg on pack-count goods when GSM can compute", () => {
    const variation = {
      id: "v1",
      rate: 2,
      lengthFt: 12,
      widthFt: 18,
      pcsPerPacket: 10,
      weightKg: 1,
    } as ProductVariation;
    expect(resolveUnitWeightKg(silpauline, variation)).toBe(24.08);
  });
});

describe("applyBillDiscounts", () => {
  it("caps scheme + staff at goods subtotal, not shipping", () => {
    const d = applyBillDiscounts({
      goodsSubtotal: 1000,
      schemeAmount: 100,
      manualKind: "flat",
      manualValue: 50,
    });
    expect(d.schemeAmount).toBe(100);
    expect(d.manualAmount).toBe(50);
    expect(d.total).toBe(150);
  });

  it("applies staff percent on goods then caps combined", () => {
    const d = applyBillDiscounts({
      goodsSubtotal: 1000,
      schemeAmount: 100,
      manualKind: "percent",
      manualValue: 5,
    });
    expect(d.schemeAmount).toBe(100);
    expect(d.manualAmount).toBe(50);
    expect(d.total).toBe(150);
  });

  it("does not let combined discount exceed goods", () => {
    const d = applyBillDiscounts({
      goodsSubtotal: 100,
      schemeAmount: 80,
      manualKind: "flat",
      manualValue: 50,
    });
    expect(d.total).toBe(100);
    expect(d.manualAmount).toBe(20);
  });
});

const tarpProduct = {
  id: "p1",
  name: { en: "Tarp", hi: "टार्प" },
  category: "tarpaulin",
  pricingMode: "bundle",
  unit: "kg",
  active: true,
  variations: [
    {
      id: "v12",
      label: { en: "12x18", hi: "12x18" },
      size: { en: "12x18", hi: "12x18" },
      sku: "12x18",
      rate: 50,
      stock: 99,
    },
    {
      id: "v15",
      label: { en: "15x18", hi: "15x18" },
      size: { en: "15x18", hi: "15x18" },
      sku: "15x18",
      rate: 50,
      stock: 99,
    },
  ],
} as Product;

function perKgScheme(): Scheme {
  return {
    id: "s1",
    name: { en: "Rate off", hi: "रेट" },
    description: { en: "", hi: "" },
    termsAndConditions: { en: "", hi: "" },
    progressUnit: "kg",
    targetWeightKg: 100,
    rewardType: "order_per_kg",
    creditAmount: 0,
    discountPerKg: 2,
    levels: [
      {
        id: "t1",
        name: { en: "100+", hi: "100+" },
        targetAmount: 100,
        ratePerUnit: 2,
      },
    ],
    scopeType: "all",
    scopeProductIds: [],
    appliesToAllDealers: true,
    active: true,
    startDate: "2020-01-01",
    endDate: "2099-12-31",
    createdAt: "2020-01-01",
  };
}

function kgLine(opts: {
  estimateKg: number;
  actualKg?: number;
  rate?: number;
  quantity?: number;
  variationId?: string;
}): OrderLine {
  const rate = opts.rate ?? 50;
  const billed = opts.actualKg ?? opts.estimateKg;
  return {
    productId: "p1",
    productCode: "P1",
    productName: { en: "Tarp", hi: "टार्प" },
    variationId: opts.variationId,
    unit: "kg",
    pricingMode: "bundle",
    rate,
    quantity: opts.quantity ?? 1,
    weightKg: opts.estimateKg,
    estimatedWeightKg: opts.estimateKg,
    actualWeightKg: opts.actualKg,
    lineTotal: rate * billed,
  };
}

describe("order_rate discount", () => {
  function rateScheme(): Scheme {
    return {
      ...perKgScheme(),
      id: "s-rate",
      rewardType: "order_rate",
      discountPerKg: 1,
      levels: [
        {
          id: "t1",
          name: { en: "100+", hi: "100+" },
          targetAmount: 100,
          ratePerUnit: 1,
        },
      ],
    };
  }

  it("drops list rate 100 to 99 and saves ₹1 × actual kg", () => {
    const scheme = rateScheme();
    const lines = [kgLine({ estimateKg: 80, actualKg: 120, rate: 100 })];
    const d = resolveOrderDiscount(scheme, lines, [tarpProduct], {
      billedOnly: true,
    });
    expect(d.amount).toBe(120);
    expect(d.tier).toBeTruthy();
    const rates = lineDiscountedRate(
      scheme,
      d.tier!,
      { rate: 100, pricingMode: "bundle" },
      tarpProduct
    );
    expect(rates?.listRate).toBe(100);
    expect(rates?.discountedRate).toBe(99);
  });

  it("does not apply when billed kg is under the qty step", () => {
    const d = resolveOrderDiscount(
      rateScheme(),
      [kgLine({ estimateKg: 120, actualKg: 80, rate: 100 })],
      [tarpProduct],
      { billedOnly: true }
    );
    expect(d.amount).toBe(0);
  });
});

describe("order_per_kg discount", () => {
  it("saves actual kg × ₹/kg off when the qty tier is met", () => {
    const d = resolveOrderDiscount(
      perKgScheme(),
      [kgLine({ estimateKg: 80, actualKg: 120, rate: 50 })],
      [tarpProduct],
      { billedOnly: true }
    );
    expect(d.amount).toBe(240);
  });

  it("does not use leftover estimate kg when billedOnly", () => {
    const d = resolveOrderDiscount(
      perKgScheme(),
      [kgLine({ estimateKg: 120 })],
      [tarpProduct],
      { billedOnly: true }
    );
    expect(d.amount).toBe(0);
  });

  it("saves 0 when actual kg is under the tier", () => {
    const d = resolveOrderDiscount(
      perKgScheme(),
      [kgLine({ estimateKg: 120, actualKg: 80, rate: 50 })],
      [tarpProduct],
      { billedOnly: true }
    );
    expect(d.amount).toBe(0);
  });

  it("keeps staff cap at goods subtotal after scheme", () => {
    const d = applyBillDiscounts({
      goodsSubtotal: 6000,
      schemeAmount: 240,
      manualKind: "percent",
      manualValue: 5,
    });
    expect(d.schemeAmount).toBe(240);
    expect(d.manualAmount).toBe(300);
    expect(d.total).toBe(540);
  });

  it("uses billed kg × rate even when progressUnit is bundles", () => {
    const scheme: Scheme = {
      ...perKgScheme(),
      progressUnit: "bundles",
      discountPerKg: 1,
      levels: [
        {
          id: "t1",
          name: { en: "20+", hi: "20+" },
          targetAmount: 20,
          ratePerUnit: 1,
        },
      ],
    };
    const lines: OrderLine[] = [
      {
        ...kgLine({ estimateKg: 805, actualKg: 805, rate: 50 }),
        quantity: 23,
        weightKg: 805,
        estimatedWeightKg: 805,
      },
    ];
    const d = resolveOrderDiscount(scheme, lines, [tarpProduct], {
      billedOnly: true,
    });
    expect(d.amount).toBe(805);
    expect(d.amount).not.toBe(23);
    const math = orderDiscountMathLabel(
      { amount: d.amount, tier: d.tier, scheme },
      805,
      "en"
    );
    expect(math).toContain("805.00 kg");
    expect(math).not.toMatch(/23 bdl/);
  });
});

describe("per-item order discount (sizes merge, products do not)", () => {
  const shadeProduct = {
    ...tarpProduct,
    id: "p2",
    name: { en: "Shade net", hi: "शेड नेट" },
  } as Product;

  it("unlocks when two sizes of the same item are 10 + 10 against a 20-bundle step", () => {
    const scheme: Scheme = {
      ...perKgScheme(),
      progressUnit: "bundles",
      discountPerKg: 1,
      levels: [
        {
          id: "t1",
          name: { en: "20+", hi: "20+" },
          targetAmount: 20,
          ratePerUnit: 1,
        },
      ],
    };
    const lines = [
      kgLine({
        estimateKg: 350,
        actualKg: 350,
        rate: 50,
        quantity: 10,
        variationId: "v12",
      }),
      kgLine({
        estimateKg: 350,
        actualKg: 350,
        rate: 50,
        quantity: 10,
        variationId: "v15",
      }),
    ];
    const d = resolveOrderDiscount(scheme, lines, [tarpProduct], {
      billedOnly: true,
    });
    expect(d.amount).toBe(700);
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0]?.key).toBe("p1");
  });

  it("does not merge qty across different products", () => {
    const scheme: Scheme = {
      ...perKgScheme(),
      progressUnit: "bundles",
      discountPerKg: 1,
      levels: [
        {
          id: "t1",
          name: { en: "20+", hi: "20+" },
          targetAmount: 20,
          ratePerUnit: 1,
        },
      ],
    };
    const lines = [
      kgLine({
        estimateKg: 350,
        actualKg: 350,
        rate: 50,
        quantity: 10,
        variationId: "v12",
      }),
      {
        ...kgLine({
          estimateKg: 350,
          actualKg: 350,
          rate: 50,
          quantity: 10,
          variationId: "v12",
        }),
        productId: "p2",
        productName: { en: "Shade net", hi: "शेड नेट" },
      },
    ];
    const d = resolveOrderDiscount(scheme, lines, [tarpProduct, shadeProduct], {
      billedOnly: true,
    });
    expect(d.amount).toBe(0);
    expect(d.groups).toEqual([]);
  });

  it("applies ₹/kg to every size of the item once the bundle step is hit", () => {
    const scheme: Scheme = {
      ...perKgScheme(),
      progressUnit: "bundles",
      discountPerKg: 1,
      levels: [
        {
          id: "t1",
          name: { en: "20+", hi: "20+" },
          targetAmount: 20,
          ratePerUnit: 1,
        },
      ],
    };
    const lines = [
      kgLine({
        estimateKg: 700,
        actualKg: 700,
        rate: 50,
        quantity: 20,
        variationId: "v12",
      }),
      kgLine({
        estimateKg: 175,
        actualKg: 175,
        rate: 50,
        quantity: 5,
        variationId: "v15",
      }),
    ];
    const d = resolveOrderDiscount(scheme, lines, [tarpProduct], {
      billedOnly: true,
    });
    expect(d.amount).toBe(875);
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0]?.key).toBe("p1");
    const best = { amount: d.amount, tier: d.tier, scheme, groups: d.groups };
    expect(lineOrderDiscountTier(best, lines[0])).toBeTruthy();
    expect(lineOrderDiscountTier(best, lines[1])).toBeTruthy();
    const math = orderDiscountMathLabel(best, 875, "en");
    expect(math).toContain("12x18");
    expect(math).toContain("15x18");
    expect(math).toContain("875.00 kg");
  });

  it("uses one shared tier for all sizes of the same item (340 kg × ₹2)", () => {
    const scheme: Scheme = {
      ...perKgScheme(),
      progressUnit: "kg",
      discountPerKg: 1,
      levels: [
        {
          id: "t1",
          name: { en: "100+", hi: "100+" },
          targetAmount: 100,
          ratePerUnit: 1,
        },
        {
          id: "t2",
          name: { en: "200+", hi: "200+" },
          targetAmount: 200,
          ratePerUnit: 2,
        },
      ],
    };
    const lines = [
      kgLine({
        estimateKg: 220,
        actualKg: 220,
        rate: 50,
        variationId: "v12",
      }),
      kgLine({
        estimateKg: 120,
        actualKg: 120,
        rate: 50,
        variationId: "v15",
      }),
    ];
    const d = resolveOrderDiscount(scheme, lines, [tarpProduct], {
      billedOnly: true,
    });
    expect(d.amount).toBe(680);
    expect(d.groups).toHaveLength(1);
    const math = orderDiscountMathLabel(
      { amount: d.amount, tier: d.tier, scheme, groups: d.groups },
      340,
      "en"
    );
    expect(math).toContain("12x18");
    expect(math).toContain("15x18");
    expect(math).toContain("₹2/kg");
    expect(math).not.toContain("₹1/kg");
  });
});
