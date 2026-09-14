import { describe, expect, it } from "vitest";
import { compactPayBase, nextPayRef, nextPayRefFromItems, parsePaySeq } from "./pay-ref";

describe("pay-ref", () => {
  it("builds TT-104-P1 then P2", () => {
    expect(nextPayRef("TT-104", 0)).toBe("TT-104-P1");
    expect(nextPayRef("TT-104", 1)).toBe("TT-104-P2");
  });

  it("counts existing proof items", () => {
    expect(
      nextPayRefFromItems("TT-104", [
        { id: "a", url: "x", type: "image", uploadedAt: "" },
      ])
    ).toBe("TT-104-P2");
  });

  it("keeps the UPI note short", () => {
    const long = "TT-EST-00042-A3F9-WITH-A-VERY-LONG-SUFFIX-XXXX";
    const ref = nextPayRef(long, 0);
    expect(ref.length).toBeLessThanOrEqual(50);
    expect(compactPayBase(long).length).toBeLessThanOrEqual(40);
  });

  it("parses the sequence", () => {
    expect(parsePaySeq("TT-104-P3")).toBe(3);
    expect(parsePaySeq("nope")).toBeNull();
  });
});
