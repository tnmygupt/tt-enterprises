import { describe, expect, it } from "vitest";
import type { Order } from "./types";
import {
  applyWaTemplate,
  findOrderByCode,
  orderQtyTotal,
  renderWaTemplate,
  shortOrderUrl,
  waVarsFromOrder,
} from "./wa-format";

const order = {
  id: "ord_abc",
  orderNumber: "TT-104",
  userName: "Ravi",
  checkoutName: "Ravi Traders",
  phone: "9876543210",
  status: "payment_pending",
  lines: [
    {
      productName: { en: "FPL HD", hi: "FPL HD" },
      size: { en: "8x5", hi: "8x5" },
      colorName: { en: "Blue", hi: "नीला" },
      quantity: 5,
      weightKg: 40,
      lineTotal: 4000,
    },
    {
      productName: { en: "FPL HD", hi: "FPL HD" },
      size: { en: "10x7", hi: "10x7" },
      colorName: { en: "Green", hi: "हरा" },
      quantity: 2,
      weightKg: 28,
      lineTotal: 2800,
    },
  ],
  estimatedTotal: 7200,
  actualBillAmount: 7200,
  schemeDiscount: 200,
  shippingAmount: 400,
  walletUsed: 0,
  paymentProof: { items: [], uploadedAt: "", verified: false },
} as unknown as Order;

describe("wa-format", () => {
  it("builds qty, kg, payment and a short order link", () => {
    const vars = waVarsFromOrder({
      order,
      locale: "en",
      companyName: "T T Enterprises",
    });
    expect(vars.qty).toBe("Qty: 7 bundles");
    expect(vars.kg).toBe("68 kg");
    expect(vars.payment).toContain("Payment due");
    expect(vars.items).toContain("FPL HD 8x5 Blue × 5");
    expect(vars.link).toMatch(/\/o\/TT-104$/);
    expect(vars.link).not.toMatch(/\/o\/p\//);
    expect(vars.pay).toBe("");
    expect(orderQtyTotal(order)).toBe(7);
  });

  it("adds a UPI pay link and a single order URL when payment is due", () => {
    const vars = waVarsFromOrder({
      order,
      locale: "en",
      companyName: "T T Enterprises",
      settings: {
        companyName: "T T Enterprises",
        upiId: "shop@okaxis",
        upiPayeeName: "TT",
        bankAccount: {
          accountName: "TT",
          accountNumber: "1",
          ifsc: "HDFC0001",
          bankName: "HDFC",
          branch: "Surat",
          upiId: "shop@okaxis",
        },
      } as never,
    });
    expect(vars.pay).toContain("upi://pay");
    expect(vars.pay).toContain("pa=shop%40okaxis");
    expect(vars.link).toMatch(/\/o\/TT-104\?pay=1/);
    expect(vars.link).not.toMatch(/\/o\/p\//);
    expect((vars.link.match(/https:\/\//g) || []).length).toBe(1);
  });

  it("applies a custom template and drops empty tokens", () => {
    const text = applyWaTemplate("*{company}*\n{order}\n{lr}\n{link}", {
      company: "T T Enterprises",
      order: "TT-104",
      lr: "",
      link: "https://app.ttenterprises.shop/o/TT-104",
    });
    expect(text).toBe(
      "*T T Enterprises*\nTT-104\n\nhttps://app.ttenterprises.shop/o/TT-104"
    );
  });

  it("uses a custom settings template for order updates", () => {
    const text = renderWaTemplate(
      "order",
      "en",
      waVarsFromOrder({ order, locale: "en", companyName: "TT" }),
      {
        whatsappTemplates: {
          order: { en: "{order} | {qty} | {bill}" },
        },
      } as never
    );
    expect(text).toContain("TT-104");
    expect(text).toContain("Qty: 7 bundles");
    expect(text).toMatch(/₹\s?7,200/);
  });

  it("finds orders by number", () => {
    expect(findOrderByCode([order], "TT-104")?.id).toBe("ord_abc");
    expect(findOrderByCode([order], "missing")).toBeUndefined();
  });

  it("shortens the order URL", () => {
    expect(shortOrderUrl("TT-104")).toMatch(/\/o\/TT-104$/);
  });
});
