import { describe, expect, it } from "vitest";
import { mergeByUpdatedAtKeepBoth } from "./authorize-db";

describe("mergeByUpdatedAtKeepBoth", () => {
  it("keeps cloud-only dealer estimates when admin local is stale", () => {
    const cloud = [
      { id: "old", updatedAt: "2026-08-10T00:00:00.000Z", status: "estimate" },
      { id: "new", updatedAt: "2026-08-21T10:00:00.000Z", status: "estimate" },
    ];
    const incoming = [
      { id: "old", updatedAt: "2026-08-10T00:00:00.000Z", status: "estimate" },
    ];
    const merged = mergeByUpdatedAtKeepBoth(incoming, cloud);
    expect(merged.map((o) => o.id).sort()).toEqual(["new", "old"]);
  });

  it("prefers the newer staff status change on a shared order", () => {
    const cloud = [
      { id: "a", updatedAt: "2026-08-21T10:00:00.000Z", status: "estimate" },
    ];
    const incoming = [
      { id: "a", updatedAt: "2026-08-21T11:00:00.000Z", status: "confirmed" },
    ];
    const merged = mergeByUpdatedAtKeepBoth(incoming, cloud);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("confirmed");
  });

  it("does not let a stale admin overwrite a newer dealer payment update", () => {
    const cloud = [
      {
        id: "a",
        updatedAt: "2026-08-21T12:00:00.000Z",
        status: "payment_pending",
      },
    ];
    const incoming = [
      { id: "a", updatedAt: "2026-08-21T10:00:00.000Z", status: "estimate" },
    ];
    const merged = mergeByUpdatedAtKeepBoth(incoming, cloud);
    expect(merged[0].status).toBe("payment_pending");
  });

  it("keeps cloud-only vouchers when a stale accounts tab sends an empty list", () => {
    const cloud = [
      { id: "v1", createdAt: "2026-08-10T00:00:00.000Z", total: 100 },
      { id: "v2", createdAt: "2026-08-21T10:00:00.000Z", total: 200 },
    ];
    const incoming: typeof cloud = [];
    const merged = mergeByUpdatedAtKeepBoth(incoming, cloud);
    expect(merged.map((v) => v.id).sort()).toEqual(["v1", "v2"]);
  });

  it("keeps cloud-only schemes when incoming schemes is empty", () => {
    const cloud = [
      { id: "s1", createdAt: "2026-08-01T00:00:00.000Z", active: true },
    ];
    const merged = mergeByUpdatedAtKeepBoth([], cloud);
    expect(merged).toHaveLength(1);
    expect(merged[0].id).toBe("s1");
  });
});
