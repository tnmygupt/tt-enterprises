import { describe, expect, it } from "vitest";
import {
  autoReorderOwnerWhatsAppText,
  supplierPoWhatsAppText,
} from "./whatsapp";

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

describe("autoReorderOwnerWhatsAppText", () => {
  it("names the mill and says the mill was not messaged", () => {
    const text = autoReorderOwnerWhatsAppText({
      companyName: "T T Enterprises",
      locale: "en",
      alertCount: 2,
      pos: [
        {
          number: "PO-1003",
          millName: "Patel Mills",
          lines: [
            { itemLabel: "HDPE 12x18", qty: 10 },
            { itemLabel: "HDPE 15x18", qty: 4 },
          ],
        },
      ],
    });
    expect(text).toContain("Patel Mills");
    expect(text).toContain("PO-1003");
    expect(text).toContain("HDPE 12x18 × 10");
    expect(text).toMatch(/not sent to the mill/i);
    expect(text).not.toMatch(/please confirm/i);
  });
});

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
