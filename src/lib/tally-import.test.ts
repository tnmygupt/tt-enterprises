import { describe, expect, it } from "vitest";
import { namesFromCsv, namesFromRows } from "@/lib/tally-import";

describe("tally name import", () => {
  it("reads a Name column and skips the title and totals", () => {
    const names = namesFromRows([
      ["List of Accounts"],
      ["Name", "Parent"],
      ["HDPE Roll", "Primary"],
      ["Shade Net", "Primary"],
      ["HDPE Roll", "Primary"],
      ["Total"],
    ]);
    expect(names).toEqual(["HDPE Roll", "Shade Net"]);
  });

  it("parses a csv export", () => {
    const names = namesFromCsv('Name,Group\n"Ram Traders","Sundry Debtors"\nHDFC Bank,Bank Accounts\n');
    expect(names).toEqual(["Ram Traders", "HDFC Bank"]);
  });
});
