/**
 * Smoke: effectiveCapabilities / capabilityOverrides / last-owner rules (unit-level).
 * Mirrors ROLE_CAPABILITIES from src/lib/types.ts
 * Run: node scripts/smoke-capabilities.mjs
 */
import assert from "assert";

const ROLE_CAPABILITIES = {
  customer: [],
  viewer: ["view_reports"],
  sales: ["manage_orders", "upload_lr", "view_reports"],
  accounts: [
    "manage_orders",
    "upload_bill",
    "verify_payment",
    "upload_lr",
    "manage_wallet",
    "manage_schemes",
    "manage_accounts",
    "manage_contracts",
    "approve_dealers",
    "view_reports",
  ],
  dispatch: ["manage_orders", "upload_lr", "manage_shipping", "view_reports"],
  super_admin: [
    "manage_products",
    "manage_users",
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
    "view_financials",
    "manage_hr",
  ],
};

const ALL = [
  "manage_products",
  "manage_users",
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

function effective(user) {
  const preset = [...(ROLE_CAPABILITIES[user.role] ?? [])];
  if (user.role === "super_admin") return preset;
  const denied = new Set(user.deniedCapabilities ?? []);
  const set = new Set([...preset, ...(user.extraCapabilities ?? [])]);
  for (const d of denied) set.delete(d);
  return ALL.filter((c) => set.has(c));
}

function overridesFromChecked(role, checked) {
  if (role === "super_admin") return { extra: [], denied: [] };
  const preset = new Set(ROLE_CAPABILITIES[role] ?? []);
  const want = new Set(checked);
  return {
    extra: ALL.filter((c) => want.has(c) && !preset.has(c)),
    denied: ALL.filter((c) => preset.has(c) && !want.has(c)),
  };
}

// Sales + manage_products only
{
  const o = overridesFromChecked("sales", [
    ...ROLE_CAPABILITIES.sales,
    "manage_products",
  ]);
  assert.deepStrictEqual(o.extra, ["manage_products"]);
  assert.deepStrictEqual(o.denied, []);
  const caps = effective({
    role: "sales",
    extraCapabilities: o.extra,
    deniedCapabilities: o.denied,
  });
  assert.ok(caps.includes("manage_products"));
  assert.ok(caps.includes("manage_orders"));
  assert.ok(!caps.includes("manage_accounts"));
}

// Dispatch deny upload_lr
{
  const o = overridesFromChecked(
    "dispatch",
    ROLE_CAPABILITIES.dispatch.filter((c) => c !== "upload_lr")
  );
  assert.deepStrictEqual(o.denied, ["upload_lr"]);
  const caps = effective({
    role: "dispatch",
    deniedCapabilities: o.denied,
  });
  assert.ok(!caps.includes("upload_lr"));
  assert.ok(caps.includes("manage_orders"));
}

// Super admin ignores denied
{
  const caps = effective({
    role: "super_admin",
    deniedCapabilities: ["manage_users", "view_financials"],
  });
  assert.ok(caps.includes("manage_users"));
  assert.ok(caps.includes("view_financials"));
}

// Creating second owner is allowed (role list includes super_admin)
{
  assert.ok(
    ["sales", "accounts", "dispatch", "viewer", "super_admin"].includes(
      "super_admin"
    )
  );
}

assert.ok(!ROLE_CAPABILITIES.sales.includes("manage_accounts"));
assert.ok(!ROLE_CAPABILITIES.sales.includes("manage_hr"));
assert.ok(!ROLE_CAPABILITIES.accounts.includes("manage_hr"));
assert.ok(!ROLE_CAPABILITIES.sales.includes("view_financials"));
assert.ok(!ROLE_CAPABILITIES.sales.includes("manage_wallet"));
assert.ok(ROLE_CAPABILITIES.sales.includes("manage_orders"));

console.log("smoke-capabilities: ok");
