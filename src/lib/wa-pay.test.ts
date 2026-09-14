import { describe, expect, it } from "vitest";
import type { AppSettings, Order } from "./types";
import { resolveOrderPay } from "./wa-pay";

const order = {
  orderNumber: "TT-104",
  status: "payment_pending",
  estimatedTotal: 7200,
  actualBillAmount: 7200,
  walletUsed: 0,
  paymentProof: { items: [], uploadedAt: "", verified: false },
} as unknown as Order;

const settings = {
  companyName: "T T Enterprises",
  upiId: "shop@okaxis",
  upiPayeeName: "TT Enterprises",
  bankAccount: {
    accountName: "TT",
    accountNumber: "1",
    ifsc: "HDFC0001",
    bankName: "HDFC",
    branch: "Surat",
    upiId: "shop@okaxis",
  },
} as AppSettings;

describe("resolveOrderPay", () => {
  it("builds a UPI intent when the bill is ready and money is due", () => {
    const pay = resolveOrderPay(settings, order);
    expect(pay?.amount).toBe(7200);
    expect(pay?.upiUrl).toContain("upi://pay");
    expect(pay?.upiUrl).toContain("am=7200.00");
    expect(pay?.payRef).toMatch(/^TT-104/);
  });

  it("skips pay intent after payment is verified", () => {
    expect(
      resolveOrderPay(settings, { ...order, status: "payment_verified" })
    ).toBeNull();
  });
});
