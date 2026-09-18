import { describe, expect, it } from "vitest";
import { NEW_ORDER_PAGE_SHELL, ORDERS_PAGE_SHELL } from "./admin-ui";

describe("admin desk shells", () => {
  it("puts the orders list on AdminShell, not the books rail", () => {
    expect(ORDERS_PAGE_SHELL).toBe("AdminShell");
  });

  it("puts punch-new-order on AdminShell", () => {
    expect(NEW_ORDER_PAGE_SHELL).toBe("AdminShell");
  });
});
