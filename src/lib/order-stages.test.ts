import { describe, expect, it } from "vitest";
import type { OrderStatus } from "./types";
import {
  allowedNextOrderStatuses,
  canTransitionOrderStatus,
  clampMergedOrders,
} from "./order-stages";

describe("canTransitionOrderStatus", () => {
  it("blocks dispatch and deliver until payment is verified", () => {
    expect(canTransitionOrderStatus("payment_pending", "dispatched")).toBe(
      false
    );
    expect(canTransitionOrderStatus("payment_pending", "delivered")).toBe(
      false
    );
    expect(canTransitionOrderStatus("confirmed", "dispatched")).toBe(false);
    expect(canTransitionOrderStatus("estimate", "delivered")).toBe(false);
  });

  it("allows dispatch and deliver after payment is verified", () => {
    expect(canTransitionOrderStatus("payment_verified", "dispatched")).toBe(
      true
    );
    expect(canTransitionOrderStatus("payment_verified", "delivered")).toBe(
      true
    );
    expect(canTransitionOrderStatus("dispatched", "delivered")).toBe(true);
  });

  it("hides dispatch from the status picker until verified", () => {
    expect(allowedNextOrderStatuses("payment_pending")).not.toContain(
      "dispatched"
    );
    expect(allowedNextOrderStatuses("payment_pending")).not.toContain(
      "delivered"
    );
    expect(allowedNextOrderStatuses("payment_verified")).toContain("dispatched");
  });
});

describe("clampMergedOrders", () => {
  it("rejects a client pushing dispatched before payment_verified", () => {
    const previous = [{ id: "a", status: "payment_pending" as OrderStatus }];
    const merged = [{ id: "a", status: "dispatched" as OrderStatus }];
    expect(clampMergedOrders(merged, previous)[0].status).toBe(
      "payment_pending"
    );
  });

  it("keeps a legal verified → dispatched update", () => {
    const previous = [{ id: "a", status: "payment_verified" as OrderStatus }];
    const merged = [{ id: "a", status: "dispatched" as OrderStatus }];
    expect(clampMergedOrders(merged, previous)[0].status).toBe("dispatched");
  });
});
