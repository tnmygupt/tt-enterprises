import { describe, expect, it } from "vitest";
import { applyDealerFileActions } from "./dealer-file";
import type { Party, PeopleActivity, UserProfile } from "./types";

function user(
  partial: Partial<UserProfile> & Pick<UserProfile, "id" | "role">
): UserProfile {
  return {
    passwordHash: "x",
    name: partial.name || "N",
    phone: partial.phone || "9000000000",
    locale: "en",
    walletBalance: 0,
    assignedSchemeIds: [],
    liftingProgressKg: 0,
    schemeProgress: {},
    active: true,
    approved: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("applyDealerFileActions", () => {
  it("lets plant revoke a dealer and writes an owner log", () => {
    const plant = user({
      id: "plant",
      role: "plant_manager",
      name: "Plant",
      phone: "9111111111",
    });
    const dealer = user({
      id: "d1",
      role: "customer",
      name: "Ravi",
      phone: "9000000001",
    });
    const db = {
      users: [plant, dealer],
      parties: [] as Party[],
      peopleActivity: [] as PeopleActivity[],
    };
    applyDealerFileActions(db, plant, {
      action: "revoke",
      ids: ["d1"],
      reason: "Bad cheque",
    });
    expect(dealer.active).toBe(false);
    expect(dealer.revokedBy).toBe("plant");
    expect(dealer.revokedReason).toBe("Bad cheque");
    expect(db.peopleActivity).toHaveLength(1);
    expect(db.peopleActivity[0].action).toBe("revoke");
    expect(db.peopleActivity[0].actorName).toBe("Plant");
    expect(db.parties[0]?.type).toBe("customer");
    expect(db.parties[0]?.active).toBe(false);
  });

  it("edits dealer file fields and logs the diff", () => {
    const plant = user({ id: "plant", role: "plant_manager", name: "Plant" });
    const dealer = user({
      id: "d1",
      role: "customer",
      name: "Ravi",
      phone: "9000000001",
      address: "Old",
    });
    const db = {
      users: [plant, dealer],
      parties: [] as Party[],
      peopleActivity: [] as PeopleActivity[],
    };
    applyDealerFileActions(db, plant, {
      action: "update",
      ids: ["d1"],
      patch: {
        name: "Ravi Traders",
        phone: "9000000001",
        address: "Panki",
        creditLimit: 50000,
      },
    });
    expect(dealer.name).toBe("Ravi Traders");
    expect(dealer.address).toBe("Panki");
    expect(db.parties[0]?.creditLimit).toBe(50000);
    expect(db.peopleActivity[0].action).toBe("edit");
    expect(db.peopleActivity[0].changes?.some((c) => c.field === "name")).toBe(
      true
    );
  });

  it("does not touch staff logins", () => {
    const plant = user({ id: "plant", role: "plant_manager" });
    const sales = user({ id: "s1", role: "sales", name: "Sales" });
    const db = {
      users: [plant, sales],
      parties: [] as Party[],
      peopleActivity: [] as PeopleActivity[],
    };
    expect(() =>
      applyDealerFileActions(db, plant, { action: "revoke", ids: ["s1"] })
    ).toThrow(/Dealer not found/);
    expect(sales.active).toBe(true);
    expect(db.peopleActivity).toEqual([]);
  });
});
