import {
  ROLE_CAPABILITIES,
  type Capability,
  type Locale,
  type RolePresets,
  type StaffJob,
  type StaffJobBaseRole,
  type UserProfile,
  type UserRole,
} from "./types";

/** All grantable capabilities (stable order for UI). */
export const ALL_CAPABILITIES: Capability[] = [
  "manage_products",
  "manage_reorder",
  "manage_users",
  "approve_dealers",
  "manage_orders",
  "manage_schemes",
  "manage_wallet",
  "manage_shipping",
  "upload_bill",
  "verify_payment",
  "upload_lr",
  "manage_accounts",
  "manage_contracts",
  "view_reports",
  "manage_hr",
  "view_financials",
];

/** Caps only a super_admin may grant to others. */
export const OWNER_ONLY_CAPABILITIES: Capability[] = [
  "manage_users",
  "view_financials",
];

export const JOB_BASE_ROLES: StaffJobBaseRole[] = [
  "sales",
  "accounts",
  "dispatch",
  "plant_manager",
  "viewer",
];

export type CapabilitySubject = Pick<
  UserProfile,
  "role" | "extraCapabilities" | "deniedCapabilities" | "jobId"
>;

export type CapabilityContext = {
  rolePresets?: RolePresets | null;
  staffJobs?: StaffJob[] | null;
};

const OWNER_ONLY = new Set<Capability>(OWNER_ONLY_CAPABILITIES);
const CAP_SET = new Set<Capability>(ALL_CAPABILITIES);

export function isStaffJobBaseRole(role: string): role is StaffJobBaseRole {
  return (JOB_BASE_ROLES as string[]).includes(role);
}

export function stripOwnerOnlyCapabilities(
  caps: Capability[] | undefined
): Capability[] {
  return (caps ?? []).filter((c) => CAP_SET.has(c) && !OWNER_ONLY.has(c));
}

function uniqueCaps(caps: Capability[]): Capability[] {
  const seen = new Set<Capability>();
  const out: Capability[] = [];
  for (const c of caps) {
    if (!CAP_SET.has(c) || seen.has(c)) continue;
    seen.add(c);
    out.push(c);
  }
  return out;
}

export function sanitizeRolePresets(raw: RolePresets | null | undefined): RolePresets {
  const out: RolePresets = {};
  if (!raw) return out;
  for (const role of JOB_BASE_ROLES) {
    const list = raw[role];
    if (!list?.length) continue;
    out[role] = uniqueCaps(stripOwnerOnlyCapabilities(list));
  }
  return out;
}

export function sanitizeStaffJob(raw: Partial<StaffJob> & { id?: string }): StaffJob | null {
  const id = String(raw.id || "").trim();
  const baseRole = raw.baseRole;
  if (!id || !baseRole || !isStaffJobBaseRole(baseRole)) return null;
  const en = String(raw.name?.en || "").trim();
  const hi = String(raw.name?.hi || "").trim() || en;
  if (!en) return null;
  const extra = uniqueCaps(stripOwnerOnlyCapabilities(raw.extraCapabilities));
  const denied = uniqueCaps(stripOwnerOnlyCapabilities(raw.deniedCapabilities));
  return {
    id,
    name: { en, hi },
    baseRole,
    extraCapabilities: extra.length ? extra : undefined,
    deniedCapabilities: denied.length ? denied : undefined,
  };
}

export function sanitizeStaffJobs(raw: StaffJob[] | null | undefined): StaffJob[] {
  const seen = new Set<string>();
  const out: StaffJob[] = [];
  for (const row of raw ?? []) {
    const job = sanitizeStaffJob(row);
    if (!job || seen.has(job.id)) continue;
    seen.add(job.id);
    out.push(job);
  }
  return out;
}

export function capabilityContextFrom(
  source:
    | CapabilityContext
    | { rolePresets?: RolePresets | null; staffJobs?: StaffJob[] | null }
    | null
    | undefined
): CapabilityContext | undefined {
  if (!source) return undefined;
  return {
    rolePresets: source.rolePresets,
    staffJobs: source.staffJobs,
  };
}

/**
 * Built-in or owner overlay defaults for a role.
 * super_admin is always the full owner set. Owner-only caps never appear
 * on overlay presets.
 */
export function rolePresetCapabilities(
  role: UserRole,
  presets?: RolePresets | null
): Capability[] {
  if (role === "super_admin") {
    return [...(ROLE_CAPABILITIES.super_admin ?? [])];
  }
  if (isStaffJobBaseRole(role)) {
    const overlay = presets?.[role];
    if (overlay) return uniqueCaps(stripOwnerOnlyCapabilities(overlay));
  }
  return [...(ROLE_CAPABILITIES[role] ?? [])];
}

function resolvedSubject(
  user: CapabilitySubject,
  ctx?: CapabilityContext | null
): {
  role: UserRole;
  extra: Capability[];
  denied: Capability[];
} {
  if (user.role === "super_admin") {
    return { role: "super_admin", extra: [], denied: [] };
  }
  if (user.jobId) {
    const job = (ctx?.staffJobs ?? []).find((j) => j.id === user.jobId);
    if (job) {
      return {
        role: job.baseRole,
        extra: job.extraCapabilities ?? [],
        denied: job.deniedCapabilities ?? [],
      };
    }
  }
  return {
    role: user.role,
    extra: user.extraCapabilities ?? [],
    denied: user.deniedCapabilities ?? [],
  };
}

/**
 * Effective caps = (role preset ∪ extra) − denied.
 * super_admin always keeps the full owner preset.
 * jobId uses the named job matrix instead of personal extra/denied.
 * Owner-only caps never stick on non-owners (even if a job/preset listed them).
 */
export function effectiveCapabilities(
  user: CapabilitySubject,
  ctx?: CapabilityContext | null
): Capability[] {
  const resolved = resolvedSubject(user, ctx);
  const preset = rolePresetCapabilities(resolved.role, ctx?.rolePresets);
  if (resolved.role === "super_admin") {
    return preset;
  }
  const denied = new Set(resolved.denied);
  const set = new Set<Capability>([...preset, ...resolved.extra]);
  for (const d of denied) set.delete(d);
  return ALL_CAPABILITIES.filter((c) => set.has(c) && !OWNER_ONLY.has(c));
}

export function userHasCapability(
  user: CapabilitySubject | null | undefined,
  capability: Capability,
  ctx?: CapabilityContext | null
): boolean {
  if (!user) return false;
  return effectiveCapabilities(user, ctx).includes(capability);
}

/** Diff checkbox state vs role preset → extra / denied arrays. */
export function capabilityOverridesFromChecked(
  role: UserRole,
  checked: Capability[],
  presets?: RolePresets | null
): { extraCapabilities: Capability[]; deniedCapabilities: Capability[] } {
  if (role === "super_admin") {
    return { extraCapabilities: [], deniedCapabilities: [] };
  }
  const preset = new Set(rolePresetCapabilities(role, presets));
  const want = new Set(stripOwnerOnlyCapabilities(checked));
  const extraCapabilities = ALL_CAPABILITIES.filter(
    (c) => want.has(c) && !preset.has(c)
  );
  const deniedCapabilities = ALL_CAPABILITIES.filter(
    (c) => preset.has(c) && !want.has(c)
  );
  return { extraCapabilities, deniedCapabilities };
}

export function capabilityLabel(cap: Capability, locale: Locale): string {
  const labels: Record<Capability, { en: string; hi: string }> = {
    manage_products: { en: "Products & catalog", hi: "उत्पाद / कैटलॉग" },
    manage_reorder: {
      en: "Stock reorder / draft POs",
      hi: "स्टॉक रीऑर्डर / ड्राफ्ट PO",
    },
    manage_users: { en: "Users & staff", hi: "यूज़र / स्टाफ़" },
    approve_dealers: {
      en: "Dealers (approve, edit, revoke)",
      hi: "डीलर (अप्रूव, एडिट, रोकें)",
    },
    manage_orders: { en: "Orders", hi: "ऑर्डर" },
    manage_schemes: { en: "Schemes", hi: "स्कीम" },
    manage_wallet: { en: "Wallet", hi: "वॉलेट" },
    manage_shipping: { en: "Shipping", hi: "शिपिंग" },
    upload_bill: { en: "Upload bill", hi: "बिल अपलोड" },
    verify_payment: { en: "Verify payment", hi: "पेमेंट वेरिफाई" },
    upload_lr: { en: "Upload LR", hi: "LR अपलोड" },
    manage_accounts: { en: "Accounts / books", hi: "अकाउंट्स / बुक्स" },
    manage_hr: {
      en: "Owner HR / payroll (all staff)",
      hi: "ओनर एचआर / पेरोल (सभी स्टाफ)",
    },
    manage_contracts: { en: "Supplier contracts", hi: "सप्लायर कॉन्ट्रैक्ट" },
    view_reports: { en: "Reports", hi: "रिपोर्ट" },
    view_financials: {
      en: "Owner financials (P/L, rates)",
      hi: "ओनर फाइनेंशियल (P/L, रेट)",
    },
  };
  return labels[cap]?.[locale] || labels[cap]?.en || cap;
}

export function staffJobLabel(job: StaffJob, locale: Locale): string {
  return locale === "hi" ? job.name.hi || job.name.en : job.name.en;
}

const ROLE_LABELS: Record<UserRole, { en: string; hi: string }> = {
  customer: { en: "Dealer", hi: "डीलर" },
  super_admin: { en: "Owner", hi: "ओनर" },
  sales: { en: "Sales", hi: "सेल्स" },
  accounts: { en: "Accounts", hi: "अकाउंट्स" },
  dispatch: { en: "Dispatch", hi: "डिस्पैच" },
  plant_manager: { en: "Plant manager", hi: "प्लांट मैनेजर" },
  viewer: { en: "Viewer", hi: "व्यूअर" },
};

export function staffRoleLabel(role: UserRole, locale: Locale): string {
  return ROLE_LABELS[role]?.[locale] || ROLE_LABELS[role]?.en || role;
}

/**
 * Caps that open desks beyond sales (orders + clock-in).
 * A `sales` user with any of these is not locked to the sales desk.
 */
export const BEYOND_SALES_DESK_CAPS: Capability[] = [
  "manage_accounts",
  "view_financials",
  "manage_users",
  "manage_products",
  "manage_shipping",
  "approve_dealers",
  "manage_wallet",
  "manage_schemes",
  "manage_reorder",
  "manage_hr",
];

/** True when this staffer should only see orders + clock-in. */
export function isSalesDeskOnly(
  user: CapabilitySubject | null | undefined,
  ctx?: CapabilityContext | null
): boolean {
  if (!user || user.role !== "sales") return false;
  const caps = effectiveCapabilities(user, ctx);
  return !BEYOND_SALES_DESK_CAPS.some((c) => caps.includes(c));
}

export const SALES_DESK_HREFS = new Set([
  "/admin",
  "/admin/orders",
  "/admin/whatsapp",
  "/admin/tracking",
]);

/** Active staff matching any of the given capabilities (no push-sub filter). */
export function staffMatchingAnyCap(
  users: UserProfile[],
  caps: Capability[],
  ctx?: CapabilityContext | null
): UserProfile[] {
  if (!caps.length) return [];
  return users.filter(
    (u) =>
      u.active &&
      u.role !== "customer" &&
      caps.some((c) => userHasCapability(u, c, ctx))
  );
}
