import { describe, expect, it } from "vitest";
import {
  OWNER_ONLY_CAPABILITIES,
  effectiveCapabilities,
  isSalesDeskOnly,
  sanitizeRolePresets,
  sanitizeStaffJob,
  userHasCapability,
} from "./capabilities";
import { canManageHr } from "./hr";
import { ROLE_CAPABILITIES, type Capability, type StaffJob } from "./types";

describe("effectiveCapabilities", () => {
  it("applies an owner overlay on built-in role defaults", () => {
    const user = { role: "sales" as const };
    expect(effectiveCapabilities(user)).toEqual(ROLE_CAPABILITIES.sales);
    const overlay: { sales: Capability[] } = {
      sales: ["manage_orders", "upload_lr", "view_reports", "manage_shipping"],
    };
    expect(effectiveCapabilities(user, { rolePresets: overlay })).toEqual([
      "manage_orders",
      "manage_shipping",
      "upload_lr",
      "view_reports",
    ]);
  });

  it("uses the job matrix instead of personal extra/denied", () => {
    const job: StaffJob = {
      id: "job_1",
      name: { en: "Dispatch lead", hi: "डिस्पैच" },
      baseRole: "dispatch",
      extraCapabilities: ["manage_products"],
      deniedCapabilities: ["view_reports"],
    };
    const user = {
      role: "sales" as const,
      jobId: "job_1",
      extraCapabilities: ["manage_wallet"] as Capability[],
      deniedCapabilities: ["manage_orders"] as Capability[],
    };
    const caps = effectiveCapabilities(user, { staffJobs: [job] });
    expect(caps).toContain("upload_lr");
    expect(caps).toContain("manage_shipping");
    expect(caps).toContain("manage_products");
    expect(caps).not.toContain("view_reports");
    expect(caps).not.toContain("manage_wallet");
  });

  it("falls back to personal overrides when the job is missing", () => {
    const user = {
      role: "sales" as const,
      jobId: "gone",
      extraCapabilities: ["manage_shipping"] as Capability[],
    };
    const caps = effectiveCapabilities(user, { staffJobs: [] });
    expect(caps).toContain("manage_shipping");
    expect(caps).toContain("manage_orders");
  });

  it("never grants owner-only caps via a job or preset", () => {
    const job: StaffJob = {
      id: "job_2",
      name: { en: "Fake owner", hi: "फेक" },
      baseRole: "sales",
      extraCapabilities: ["manage_users", "view_financials", "manage_hr", "manage_products"],
    };
    const user = { role: "sales" as const, jobId: "job_2" };
    const caps = effectiveCapabilities(user, { staffJobs: [job] });
    expect(caps).toContain("manage_products");
    expect(caps).toContain("manage_hr");
    expect(caps).not.toContain("manage_users");
    expect(caps).not.toContain("view_financials");
    expect(
      userHasCapability(user, "manage_users", { staffJobs: [job] })
    ).toBe(false);

    const fromPreset = effectiveCapabilities(
      { role: "accounts" },
      { rolePresets: { accounts: ["manage_users", "verify_payment"] as Capability[] } }
    );
    expect(fromPreset).toContain("verify_payment");
    expect(fromPreset).not.toContain("manage_users");
  });

  it("keeps the full owner set even if a jobId is set", () => {
    expect(
      effectiveCapabilities({ role: "super_admin", jobId: "job_1" })
    ).toEqual(ROLE_CAPABILITIES.super_admin);
  });

  it("gives plant manager catalog + reorder + dealer file, not books or staff", () => {
    const caps = effectiveCapabilities({ role: "plant_manager" });
    expect(caps).toEqual([
      "manage_products",
      "manage_reorder",
      "approve_dealers",
      "view_reports",
    ]);
    expect(caps).not.toContain("manage_accounts");
    expect(caps).not.toContain("manage_users");
    expect(caps).not.toContain("view_financials");
    expect(caps).not.toContain("manage_hr");
    expect(caps).toContain("approve_dealers");
  });

  it("keeps default sales on the orders desk only", () => {
    expect(isSalesDeskOnly({ role: "sales" })).toBe(true);
    expect(isSalesDeskOnly({ role: "accounts" })).toBe(false);
    expect(
      isSalesDeskOnly({
        role: "sales",
        extraCapabilities: ["manage_shipping"],
      })
    ).toBe(false);
  });

  it("lets accounts approve dealers without staff CRUD or owner books", () => {
    const caps = effectiveCapabilities({ role: "accounts" });
    expect(caps).toContain("approve_dealers");
    expect(caps).toContain("manage_accounts");
    expect(caps).not.toContain("manage_hr");
    expect(caps).not.toContain("manage_users");
    expect(caps).not.toContain("view_financials");
    expect(caps).not.toContain("manage_reorder");
  });

  it("keeps approve_dealers and manage_reorder on the owner set", () => {
    expect(ROLE_CAPABILITIES.super_admin).toContain("approve_dealers");
    expect(ROLE_CAPABILITIES.super_admin).toContain("manage_reorder");
    expect(
      userHasCapability({ role: "super_admin" }, "approve_dealers")
    ).toBe(true);
    expect(
      userHasCapability({ role: "super_admin" }, "manage_reorder")
    ).toBe(true);
  });
});

describe("sanitize helpers", () => {
  it("strips owner-only caps from jobs", () => {
    const job = sanitizeStaffJob({
      id: "j",
      name: { en: "X", hi: "" },
      baseRole: "sales",
      extraCapabilities: ["manage_users", "manage_hr", "manage_products"] as Capability[],
    });
    expect(job?.extraCapabilities).toEqual(["manage_hr", "manage_products"]);
  });

  it("strips owner-only caps from role presets", () => {
    const p = sanitizeRolePresets({
      sales: ["manage_users", "manage_orders"] as Capability[],
    });
    expect(p.sales).toEqual(["manage_orders"]);
  });
});

describe("canManageHr", () => {
  it("is grantable to staff, unlike owner-only financials", () => {
    expect(OWNER_ONLY_CAPABILITIES).not.toContain("manage_hr");
  });

  it("follows the manage_hr capability", () => {
    expect(canManageHr({ role: "super_admin" })).toBe(true);
    expect(canManageHr({ role: "accounts" })).toBe(false);
    expect(canManageHr({ role: "sales" })).toBe(false);
    expect(
      canManageHr({
        role: "accounts",
        extraCapabilities: ["manage_hr"],
      })
    ).toBe(true);
  });
});
