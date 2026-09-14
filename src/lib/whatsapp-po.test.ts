import { describe, expect, it } from "vitest";
import { supplierPoWhatsAppText } from "./whatsapp";

describe("supplierPoWhatsAppText", () => {
  it("lists PO number, qty labels and company with no URL", () => {
    const text = supplierPoWhatsAppText({
      companyName: "T T Enterprises",
      locale: "en",
      po: {
        number: "PO-1002",
        date: "2026-08-20",
        lines: [
          { itemLabel: "FPL HD 8x5", qty: 20 },
          { itemLabel: "FPL HD 10x7", qty: 8 },
        ],
      },
    });
    expect(text).toContain("T T Enterprises");
    expect(text).toContain("PO-1002");
    expect(text).toContain("FPL HD 8x5 × 20");
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toMatch(/\/o\//);
  });
});
