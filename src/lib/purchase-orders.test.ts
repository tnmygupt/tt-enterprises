import { describe, expect, it } from "vitest";
import {
  cancelDraftPurchaseOrder,
  confirmDraftPurchaseOrder,
} from "./purchase-orders";
import type { PurchaseOrder } from "./types";

const draft: PurchaseOrder = {
  id: "po1",
  number: "PO-1001",
  supplierId: "sup1",
  date: "2026-08-01",
  status: "draft",
  lines: [],
  total: 0,
  createdAt: "2026-08-01T00:00:00.000Z",
  createdBy: "plant",
};

describe("confirmDraftPurchaseOrder", () => {
  it("moves draft to ordered", () => {
    expect(confirmDraftPurchaseOrder(draft).status).toBe("ordered");
  });

  it("refuses a PO that is already ordered", () => {
    expect(() =>
      confirmDraftPurchaseOrder({ ...draft, status: "ordered" })
    ).toThrow(/draft/i);
  });
});

describe("cancelDraftPurchaseOrder", () => {
  it("cancels a draft", () => {
    expect(cancelDraftPurchaseOrder(draft).status).toBe("cancelled");
  });

  it("refuses a PO that is already ordered", () => {
    expect(() =>
      cancelDraftPurchaseOrder({ ...draft, status: "ordered" })
    ).toThrow(/draft/i);
  });
});
