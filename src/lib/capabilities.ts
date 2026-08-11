import {
  ROLE_CAPABILITIES,
  type Capability,
  type Locale,
  type UserProfile,
  type UserRole,
} from "./types";

/** All grantable capabilities (stable order for UI). */
export const ALL_CAPABILITIES: Capability[] = [
  "manage_products",
  "manage_users",
  "manage_orders",
  "manage_schemes",
  "manage_wallet",
  "manage_shipping",
  "upload_bill",
  "verify_payment",
  "upload_lr",
  "manage_tally",
  "manage_accounts",
  "manage_contracts",
  "view_reports",
  "view_financials",
];

/** Caps only a super_admin may grant to others. */
export const OWNER_ONLY_CAPABILITIES: Capability[] = [
  "manage_users",
  "view_financials",
];

export type CapabilitySubject = Pick<
  UserProfile,
  "role" | "extraCapabilities" | "deniedCapabilities"
>;

export function rolePresetCapabilities(role: UserRole): Capability[] {
  return [...(ROLE_CAPABILITIES[role] ?? [])];
}

/**
 * Effective caps = (role preset ∪ extra) − denied.
 * super_admin always keeps the full owner preset (denied ignored).
 */
export function effectiveCapabilities(user: CapabilitySubject): Capability[] {
  const preset = rolePresetCapabilities(user.role);
  if (user.role === "super_admin") {
    return preset;
  }
  const extra = user.extraCapabilities ?? [];
  const denied = new Set(user.deniedCapabilities ?? []);
  const set = new Set<Capability>([...preset, ...extra]);
  for (const d of denied) set.delete(d);
  return ALL_CAPABILITIES.filter((c) => set.has(c));
}

export function userHasCapability(
  user: CapabilitySubject | null | undefined,
  capability: Capability
): boolean {
  if (!user) return false;
  return effectiveCapabilities(user).includes(capability);
}

/** Diff checkbox state vs role preset → extra / denied arrays. */
export function capabilityOverridesFromChecked(
  role: UserRole,
  checked: Capability[]
): { extraCapabilities: Capability[]; deniedCapabilities: Capability[] } {
  if (role === "super_admin") {
    return { extraCapabilities: [], deniedCapabilities: [] };
  }
  const preset = new Set(rolePresetCapabilities(role));
  const want = new Set(checked);
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
    manage_users: { en: "Users & staff", hi: "यूज़र / स्टाफ़" },
    manage_orders: { en: "Orders", hi: "ऑर्डर" },
    manage_schemes: { en: "Schemes", hi: "स्कीम" },
    manage_wallet: { en: "Wallet", hi: "वॉलेट" },
    manage_shipping: { en: "Shipping", hi: "शिपिंग" },
    upload_bill: { en: "Upload bill", hi: "बिल अपलोड" },
    verify_payment: { en: "Verify payment", hi: "पेमेंट वेरिफाई" },
    upload_lr: { en: "Upload LR", hi: "LR अपलोड" },
    manage_tally: { en: "Tally / stock books", hi: "टैली / स्टॉक बुक्स" },
    manage_accounts: { en: "Accounts / books", hi: "अकाउंट्स / बुक्स" },
    manage_contracts: { en: "Supplier contracts", hi: "सप्लायर कॉन्ट्रैक्ट" },
    view_reports: { en: "Reports", hi: "रिपोर्ट" },
    view_financials: {
      en: "Owner financials (P/L, rates)",
      hi: "ओनर फाइनेंशियल (P/L, रेट)",
    },
  };
  return labels[cap]?.[locale] || labels[cap]?.en || cap;
}
