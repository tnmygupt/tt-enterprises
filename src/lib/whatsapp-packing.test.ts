import { describe, expect, it } from "vitest";
import { packingSlipWhatsAppText } from "./whatsapp";

describe("packingSlipWhatsAppText", () => {
  it("attaches a notice instead of a second PDF URL", () => {
    const text = packingSlipWhatsAppText({
      partyName: "Ravi Traders",
      voucherNumber: "TT-104",
      companyName: "T T Enterprises",
      locale: "en",
      orderNumber: "TT-104",
      orderId: "ord-1",
      packingSlipName: "TT-104-packing-slip.pdf",
      pdfUrl: "https://example.com/api/media/bills/slip.pdf",
    });
    expect(text).toContain("Packing slip");
    expect(text).toContain("TT-104");
    expect(text).toContain("Packing slip PDF is attached in this chat.");
    expect(text).toMatch(/\/o\/TT-104/);
    expect(text).not.toMatch(/\/o\/p\//);
    expect(text).not.toContain("https://example.com/api/media/bills/slip.pdf");
    expect((text.match(/https:\/\//g) || []).length).toBe(1);
  });

  it("uses Hindi packing copy when locale is hi", () => {
    const text = packingSlipWhatsAppText({
      partyName: "रवि",
      voucherNumber: "TT-104",
      companyName: "T T Enterprises",
      locale: "hi",
      pdfUrl: "https://example.com/slip.pdf",
    });
    expect(text).toContain("पैकिंग स्लिप");
    expect(text).toContain("पैकिंग स्लिप PDF इस चैट में अटैच है।");
    expect(text).toMatch(/\/o\/TT-104/);
    expect(text).not.toMatch(/\/o\/p\//);
    expect(text.split("\n").map((l) => l.trim())).not.toContain("बिल");
  });

  it("includes UPI pay intent and one order link when settings have UPI", () => {
    const text = packingSlipWhatsAppText({
      partyName: "Ravi Traders",
      voucherNumber: "TT-104",
      companyName: "T T Enterprises",
      locale: "en",
      orderNumber: "TT-104",
      pdfUrl: "https://example.com/slip.pdf",
      billAmount: 7200,
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
    expect(text).toContain("upi://pay");
    expect(text).toMatch(/\/o\/TT-104\?pay=1/);
    expect(text).not.toMatch(/\/o\/p\//);
    expect((text.match(/https:\/\//g) || []).length).toBe(1);
  });
});
