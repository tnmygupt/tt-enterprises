import { describe, expect, it } from "vitest";
import {
  dateInIst,
  isInLastWeekOfMonth,
  lastWeekStart,
  monthRange,
  shiftMonth,
} from "./month-date";

describe("month-date", () => {
  it("bounds September and shifts to August / prior year", () => {
    expect(monthRange("2026-09")).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(shiftMonth("2026-09", -1)).toBe("2026-08");
    expect(shiftMonth("2026-09", -12)).toBe("2025-09");
    expect(monthRange("2026-02").to).toBe("2026-02-28");
  });

  it("treats the last 7 IST calendar days as last week", () => {
    expect(lastWeekStart("2026-09")).toBe("2026-09-24");
    expect(isInLastWeekOfMonth("2026-09-23")).toBe(false);
    expect(isInLastWeekOfMonth("2026-09-24")).toBe(true);
    expect(isInLastWeekOfMonth("2026-09-30")).toBe(true);
  });

  it("converts UTC instants to IST calendar dates", () => {
    // 2026-09-30 19:00 UTC is 2026-10-01 00:30 IST
    expect(dateInIst("2026-09-30T19:00:00.000Z")).toBe("2026-10-01");
    expect(dateInIst("2026-09-30T18:29:00.000Z")).toBe("2026-09-30");
  });
});
