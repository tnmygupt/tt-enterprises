import { describe, expect, it } from "vitest";
import { isPackHost } from "./pack-site";
import {
  createPackSlip,
  nextPackSlipNo,
  packSlipKg,
  setPackBundles,
  setPackWeight,
  updatePackSlip,
} from "./pack-slips";

describe("standalone packing slips", () => {
  it("treats only the packing host as separate from the shop", () => {
    const previous = globalThis.window;
    globalThis.window = { location: { hostname: "pack.ttenterprises.shop" } } as Window & typeof globalThis;
    expect(isPackHost()).toBe(true);
    globalThis.window = { location: { hostname: "www.pack.ttenterprises.shop" } } as Window & typeof globalThis;
    expect(isPackHost()).toBe(true);
    globalThis.window = { location: { hostname: "app.ttenterprises.shop" } } as Window & typeof globalThis;
    expect(isPackHost()).toBe(false);
    globalThis.window = previous;
  });

  it("numbers slips on their own sequence", () => {
    expect(nextPackSlipNo([])).toBe("PS-1001");
    expect(nextPackSlipNo([{ slipNo: "PS-1004" }, { slipNo: "ORD-9" }])).toBe("PS-1005");
  });

  it("keeps only slip fields and drops anything else", () => {
    const slip = createPackSlip(
      {
        partyName: "  Raju  Traders ",
        partyPhone: "9876543210",
        items: [{ name: "Pipes", bundles: 2, rate: 10 }],
        weights: [[1.5, 2]],
        orderId: "shop-order",
        orderNumber: "TT-1",
      },
      "PS-1001",
      new Date("2026-10-21T00:00:00.000Z")
    );
    expect(slip.partyName).toBe("Raju Traders");
    expect(slip.status).toBe("draft");
    expect(slip.items).toHaveLength(1);
    expect(packSlipKg(slip, 0)).toBe(3.5);
    expect(slip).not.toHaveProperty("orderId");
    expect(slip).not.toHaveProperty("orderNumber");
  });

  it("locks a finalized slip until it is reopened", () => {
    const draft = createPackSlip(
      { partyName: "A", items: [{ name: "Box", bundles: 1 }] },
      "PS-1001"
    );
    const final = updatePackSlip(draft, { ...draft, status: "finalized" });
    expect(final.status).toBe("finalized");
    expect(() => updatePackSlip(final, { ...final, partyName: "B" })).toThrow(/finalized/);
    const reopened = updatePackSlip(final, { ...final, status: "draft", partyName: "B" });
    expect(reopened.status).toBe("draft");
    expect(reopened.partyName).toBe("B");
    expect(reopened.slipNo).toBe("PS-1001");
  });

  it("resizes weighment rows with the bundle count", () => {
    const slip = setPackWeight(
      createPackSlip({ partyName: "A", items: [{ name: "Box", bundles: 1 }] }, "PS-1001"),
      0,
      0,
      4
    );
    const grown = setPackBundles(slip, 0, 3);
    expect(grown.weights[0]).toEqual([4, null, null]);
    const shrunk = setPackBundles(grown, 0, 1);
    expect(shrunk.weights[0]).toEqual([4]);
    expect(packSlipKg(shrunk, 0)).toBe(4);
  });
});
