import { describe, expect, it } from "vitest";
import { digestRecentlySent } from "./whatsapp-digest";

describe("digestRecentlySent", () => {
  it("is false when never sent", () => {
    expect(digestRecentlySent(undefined, "2026-08-21")).toBe(false);
  });

  it("skips when last send was fewer than 6 days ago", () => {
    expect(digestRecentlySent("2026-08-16", "2026-08-21")).toBe(true);
  });

  it("allows another send the next day when cooldown is 1", () => {
    expect(digestRecentlySent("2026-08-21", "2026-08-22", 1)).toBe(false);
    expect(digestRecentlySent("2026-08-22", "2026-08-22", 1)).toBe(true);
  });
});
