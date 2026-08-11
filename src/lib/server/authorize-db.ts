import type { AppDatabase } from "@/lib/store/db";
import type {
  AccessPlace,
  AppSettings,
  Capability,
  Order,
  OrderLine,
  Product,
  ShippingRule,
  UserProfile,
  UserRole,
  WalletDeposit,
} from "@/lib/types";
import { trimAccessPlaces } from "@/lib/server/access-log";
import { userHasCapability } from "@/lib/capabilities";
import { isSchemeActiveNow } from "@/lib/schemes";
import type { ServerSession } from "@/lib/server/session";
import { isStaffRole } from "@/lib/server/session";
import { calcShippingAmount } from "@/lib/shipping";
import { roundOffRupees } from "@/lib/pricing";
import { applyOrderEstimateStock } from "@/lib/inventory";
import {
  mergePasswordHashes,
  sanitizeDbForCloud,
  sanitizeDbForClient,
} from "@/lib/supabase/sanitize";
import {
  getOpsPurgeAt,
  stripPrePurgeOps,
} from "@/lib/ops-purge";
import {
  applyTombsToUsers,
  clearTombsBeatenByUsers,
  mergeTombMaps,
  syncTombFields,
  tombsFromDb,
  type TombMap,
  userBeatsTomb,
} from "@/lib/user-tombs";

const CUSTOMER_ORDER_STATUSES = new Set([
  "estimate",
  "payment_pending",
  "cancelled",
]);

const CUSTOMER_ORDER_PROOF_STATUSES = new Set([
  "estimate",
  "payment_pending",
  "cancelled",
]);

const CUSTOMER_DEPOSIT_STATUSES = new Set([
  "awaiting_proof",
  "pending_verify",
  "cancelled",
]);

const MIN_DEPOSIT = 1;
const MAX_DEPOSIT = 5_000_000;

function hasCap(
  actor: Pick<UserProfile, "role" | "extraCapabilities" | "deniedCapabilities">,
  cap: Capability
): boolean {
  return userHasCapability(actor, cap);
}

function stripPaymentSettings<T extends AppDatabase["settings"]>(
  settings: T
): T {
  if (!settings) return settings;
  return {
    ...settings,
    upiId: "",
    upiPayeeName: "",
    paymentNote: "",
    bankAccount: {
      accountName: "",
      accountNumber: "",
      ifsc: "",
      bankName: "",
      branch: "",
    },
    bankAccounts: [],
  };
}

function withPaymentSettings(
  publicSettings: AppDatabase["settings"],
  full: AppDatabase["settings"]
): AppDatabase["settings"] {
  if (!full) return publicSettings;
  return {
    ...publicSettings,
    upiId: full.upiId,
    upiPayeeName: full.upiPayeeName,
    paymentNote: full.paymentNote,
    bankAccount: full.bankAccount,
    bankAccounts: (full.bankAccounts ?? []).map((a) => ({
      ...a,
      staticQrDataUrl:
        a.staticQrDataUrl && a.staticQrDataUrl.length > 120_000
          ? undefined
          : a.staticQrDataUrl,
    })),
  };
}

/**
 * Catalog-only projection for anonymous clients (no PII / money / payment).
 */
export function publicCatalogProjection(db: AppDatabase): AppDatabase {
  const empty = {
    users: [] as AppDatabase["users"],
    orders: [] as AppDatabase["orders"],
    walletTransactions: [] as AppDatabase["walletTransactions"],
    walletDeposits: [] as AppDatabase["walletDeposits"],
    accounts: [] as AppDatabase["accounts"],
    parties: [] as AppDatabase["parties"],
    vouchers: [] as AppDatabase["vouchers"],
    ledgerEntries: [] as AppDatabase["ledgerEntries"],
    stockMovements: [] as AppDatabase["stockMovements"],
    stockBatches: [] as AppDatabase["stockBatches"],
    batchConsumptions: [] as AppDatabase["batchConsumptions"],
    billAllocations: [] as AppDatabase["billAllocations"],
    purchaseOrders: [] as AppDatabase["purchaseOrders"],
    goodsReceipts: [] as AppDatabase["goodsReceipts"],
    supplierContracts: [] as AppDatabase["supplierContracts"],
    tallyPosts: [] as AppDatabase["tallyPosts"],
    statementMatches: [] as AppDatabase["statementMatches"],
    accessPlaces: [] as AppDatabase["accessPlaces"],
  };

  return {
    ...empty,
    products: (db.products ?? []).filter((p) => p.active),
    schemes: (db.schemes ?? []).filter((s) => isSchemeActiveNow(s)),
    categories: db.categories ?? [],
    shippingRules: db.shippingRules ?? [],
    settings: stripPaymentSettings(db.settings),
  };
}

/** Dealer-scoped view: catalog + payment details + self + own commerce. */
export function dealerScopedProjection(
  db: AppDatabase,
  session: ServerSession
): AppDatabase {
  const base = publicCatalogProjection(db);
  const me = (db.users ?? []).find((u) => u.id === session.id);
  const users = me
    ? [
        {
          ...me,
          passwordHash: "",
          passwordVisible: undefined,
        },
      ]
    : [];

  return sanitizeDbForClient({
    ...base,
    settings: withPaymentSettings(base.settings, db.settings),
    users: users as AppDatabase["users"],
    orders: (db.orders ?? []).filter((o) => o.userId === session.id),
    walletDeposits: (db.walletDeposits ?? []).filter(
      (d) => d.userId === session.id
    ),
    walletTransactions: (db.walletTransactions ?? []).filter(
      (t) => t.userId === session.id
    ),
    parties: (db.parties ?? []).filter((p) => p.linkedUserId === session.id),
    vouchers: [],
    ledgerEntries: [],
    accounts: [],
    stockMovements: [],
    stockBatches: [],
    batchConsumptions: [],
    billAllocations: [],
    purchaseOrders: [],
    goodsReceipts: [],
    supplierContracts: [],
    tallyPosts: [],
    statementMatches: [],
    accessPlaces: [],
  });
}

/** Staff GET projection — strip owner financials for non-owner roles. */
export function staffScopedProjection(
  db: AppDatabase,
  actor: Pick<
    UserProfile,
    "role" | "extraCapabilities" | "deniedCapabilities"
  >
): AppDatabase {
  const full = sanitizeDbForClient(db);
  const role = actor.role;
  if (role === "super_admin" || hasCap(actor, "view_financials")) {
    return full;
  }

  const out = { ...full };
  if (!hasCap(actor, "manage_accounts")) {
    out.accounts = [];
    out.vouchers = [];
    out.ledgerEntries = [];
    // Keep stock movements for order staff — emptying them caused manage_orders
    // pushes to wipe cloud estimate_reserve rows and undo stock deductions.
    if (!hasCap(actor, "manage_orders")) {
      out.stockMovements = [];
    }
    out.billAllocations = [];
    out.purchaseOrders = [];
    out.goodsReceipts = [];
    out.supplierContracts = [];
    out.statementMatches = [];
  }
  if (!hasCap(actor, "manage_tally")) {
    out.tallyPosts = [];
  }
  // Cost layers are owner-only (purchase rates / COGS)
  if (!hasCap(actor, "view_financials")) {
    out.stockBatches = [];
    out.batchConsumptions = [];
  }
  // Viewers: catalog + queues only
  if (role === "viewer") {
    out.walletTransactions = [];
    out.walletDeposits = [];
    out.accessPlaces = [];
    out.users = (out.users ?? []).map((u) =>
      u.role === "customer"
        ? {
            ...u,
            passwordHash: "",
            passwordVisible: undefined,
            walletBalance: 0,
          }
        : {
            id: u.id,
            name: u.name,
            phone: u.phone,
            role: u.role,
            locale: u.locale,
            active: u.active,
            approved: u.approved,
            passwordHash: "",
            walletBalance: 0,
            assignedSchemeIds: [],
            liftingProgressKg: 0,
            schemeProgress: {},
            createdAt: u.createdAt,
          }
    ) as AppDatabase["users"];
    out.settings = stripPaymentSettings(out.settings);
  } else if (
    !hasCap(actor, "verify_payment") &&
    !hasCap(actor, "manage_orders") &&
    !hasCap(actor, "manage_wallet")
  ) {
    out.settings = stripPaymentSettings(out.settings);
  }
  if (
    role !== "viewer" &&
    !hasCap(actor, "manage_orders") &&
    !hasCap(actor, "manage_users")
  ) {
    out.accessPlaces = [];
  }
  return out;
}

function scrubCustomerProof(
  proof: Order["paymentProof"] | WalletDeposit["proof"]
) {
  if (!proof) return undefined;
  return {
    ...proof,
    verified: false,
    verifiedAt: undefined,
    verifiedBy: undefined,
    items: (proof.items ?? []).map((it) => ({ ...it })),
  };
}

/** Allow draft slip only — never trust customer-forged finalized status. */
function scrubCustomerPackingSlip(
  slip: Order["packingSlip"]
): Order["packingSlip"] {
  if (!slip || typeof slip !== "object") return undefined;
  const pdf = slip.customerPdfUrl;
  const safePdf =
    typeof pdf === "string" &&
    (pdf.startsWith("https://") || pdf.startsWith("http://"))
      ? pdf
      : undefined;
  return {
    ...slip,
    status: "draft",
    customerPdfUrl: safePdf,
  };
}

function lookupCatalog(
  products: Product[],
  line: OrderLine
): {
  rate: number;
  unitWeightKg: number;
  productName: OrderLine["productName"];
  pricingMode: OrderLine["pricingMode"];
} | null {
  const product = products.find((p) => p.id === line.productId && p.active);
  if (!product) return null;
  const variation = line.variationId
    ? product.variations.find((v) => v.id === line.variationId)
    : product.variations[0];
  const rate = Number(variation?.rate ?? product.baseRate) || 0;
  const rawVarWt = Number(variation?.weightKg);
  const rawBaseWt = Number(product.baseWeightKg);
  const unitWeightKg =
    rawVarWt > 0 ? rawVarWt : rawBaseWt > 0 ? rawBaseWt : 0;
  return {
    rate,
    unitWeightKg,
    productName: product.name,
    pricingMode: product.pricingMode || line.pricingMode || "bundle",
  };
}

/**
 * Price an order from catalog (new orders) OR keep snapshotted line rates
 * (existing orders). Mid-cycle catalog rate changes must NOT rewrite older
 * orders — only new estimates get the new rate.
 */
function repriceCustomerOrder(
  order: Order,
  products: Product[],
  shippingRules: ShippingRule[],
  opts?: {
    freezeLineRates?: boolean;
    settings?: Pick<AppSettings, "weightShipping" | "jhalShipping"> | null;
  }
): Order {
  const freeze = !!opts?.freezeLineRates;
  const lines: OrderLine[] = [];

  for (const line of order.lines ?? []) {
    const catalog = lookupCatalog(products, line);
    const qty = Math.max(0, Number(line.quantity) || 0);
    if (!(qty > 0)) continue;

    // Locked contract rate on the order line (set at estimate / punch time)
    const hasSnapshottedRate =
      line.rate != null && Number.isFinite(Number(line.rate)) && Number(line.rate) > 0;

    if (freeze && hasSnapshottedRate) {
      // Keep original rate + recompute totals from that rate (qty may change)
      const rate = Number(line.rate);
      const pricingMode = line.pricingMode || catalog?.pricingMode || "bundle";
      const unitWt =
        catalog?.unitWeightKg && catalog.unitWeightKg > 0
          ? catalog.unitWeightKg
          : qty > 0
            ? Number(line.estimatedWeightKg || line.weightKg || 0) / qty
            : 0;
      const weightKg =
        Math.round((unitWt > 0 ? unitWt * qty : Number(line.weightKg) || 0) * 100) /
        100;
      const lineTotal =
        pricingMode === "pcs"
          ? Math.round(rate * qty * 100) / 100
          : Math.round(rate * weightKg * 100) / 100;
      lines.push({
        ...line,
        productName: catalog?.productName ?? line.productName,
        rate,
        quantity: qty,
        weightKg,
        estimatedWeightKg: weightKg,
        lineTotal,
        // Never carry actuals from a customer reprice path
        actualWeightKg: line.actualWeightKg,
      });
      continue;
    }

    if (!catalog) {
      // Product gone from catalog — keep the line as stored if it has a rate
      if (hasSnapshottedRate) lines.push(line);
      continue;
    }

    const rate = catalog.rate;
    const pricingMode = catalog.pricingMode;
    const weightKg =
      Math.round(catalog.unitWeightKg * qty * 100) / 100;
    const lineTotal =
      pricingMode === "pcs"
        ? Math.round(rate * qty * 100) / 100
        : Math.round(rate * weightKg * 100) / 100;

    lines.push({
      ...line,
      productName: catalog.productName,
      pricingMode,
      rate,
      quantity: qty,
      weightKg,
      estimatedWeightKg: weightKg,
      lineTotal,
    });
  }

  const subtotal =
    Math.round(lines.reduce((s, l) => s + l.lineTotal, 0) * 100) / 100;
  let jhalQty = 0;
  let weightForShip = 0;
  for (const l of lines) {
    const unit =
      l.unit ||
      products.find((p) => p.id === l.productId)?.unit ||
      "";
    const qty = Number(l.quantity) || 0;
    const w = Number(l.estimatedWeightKg || l.weightKg || 0) || 0;
    if (unit === "jhal") jhalQty += qty;
    else weightForShip += w;
  }
  const estimatedWeightKg = Math.round(weightForShip * 100) / 100;

  // After packing-slip finalize / final bill, never overwrite shipping with
  // a fresh catalog rule calc (that often zeros out the slip shipping).
  const slipShip = order.packingSlip?.shippingAmount;
  const billedOrFinalized =
    order.packingSlip?.status === "finalized" ||
    (order.actualBillAmount != null && order.actualBillAmount > 0);
  let shippingAmount: number;
  if (
    billedOrFinalized &&
    slipShip != null &&
    Number.isFinite(Number(slipShip))
  ) {
    shippingAmount = Math.max(0, Number(slipShip));
  } else if (
    billedOrFinalized &&
    order.shippingAmount != null &&
    Number.isFinite(Number(order.shippingAmount))
  ) {
    shippingAmount = Math.max(0, Number(order.shippingAmount));
  } else if (
    freeze &&
    order.shippingAmount != null &&
    Number.isFinite(Number(order.shippingAmount))
  ) {
    // Existing estimate — keep the shipping quoted at create time
    shippingAmount = Math.max(0, Number(order.shippingAmount));
  } else {
    shippingAmount = calcShippingAmount({
      settings: opts?.settings,
      shippingRules,
      subtotal,
      totalWeightKg: estimatedWeightKg,
      jhalQty,
    });
  }

  const walletUsed = Math.max(0, Number(order.walletUsed) || 0);
  const schemeDiscount = Math.max(0, Number(order.schemeDiscount) || 0);
  const estimatedTotal = roundOffRupees(
    Math.max(0, subtotal + shippingAmount - schemeDiscount - walletUsed)
  );
  return {
    ...order,
    lines,
    subtotal,
    shippingAmount,
    estimatedWeightKg,
    estimatedTotal,
    schemeDiscount: schemeDiscount > 0 ? schemeDiscount : order.schemeDiscount,
    schemeDiscountLabel: order.schemeDiscountLabel,
    schemeDiscountId: order.schemeDiscountId,
  };
}

function sanitizeCustomerOrder(
  incoming: Order,
  existing: Order | undefined,
  sessionId: string,
  walletBalance: number,
  products: Product[],
  shippingRules: ShippingRule[],
  settings?: Pick<AppSettings, "weightShipping" | "jhalShipping"> | null
): Order | null {
  if (incoming.userId !== sessionId) return null;

  const prevUsed = Math.max(0, Number(existing?.walletUsed) || 0);
  const requested = Math.max(0, Number(incoming.walletUsed) || 0);
  const walletUsed = Math.min(requested, Math.max(0, walletBalance) + prevUsed);

  if (!existing) {
    const status = CUSTOMER_ORDER_STATUSES.has(incoming.status)
      ? incoming.status
      : "estimate";
    const hasProof = (incoming.paymentProof?.items?.length || 0) > 0;
    const drafted: Order = {
      ...incoming,
      userId: sessionId,
      status: hasProof && status === "estimate" ? "payment_pending" : status,
      paymentProof: scrubCustomerProof(incoming.paymentProof),
      walletUsed,
      actualBillAmount: undefined,
      billFileDataUrl: undefined,
      billUploadedAt: undefined,
      lrFileDataUrl: undefined,
      lrNumber: undefined,
      lrUploadedAt: undefined,
      adminNotes: undefined,
      schemeApplied: false,
      // Never accept a customer-forged finalized slip / staff fields
      packingSlip: scrubCustomerPackingSlip(incoming.packingSlip),
      timeline: Array.isArray(incoming.timeline)
        ? incoming.timeline.slice(0, 20).map((t) => ({
            status: CUSTOMER_ORDER_PROOF_STATUSES.has(t.status)
              ? t.status
              : "estimate",
            at: t.at || new Date().toISOString(),
            note: typeof t.note === "string" ? t.note.slice(0, 200) : undefined,
          }))
        : [],
    };
    return repriceCustomerOrder(drafted, products, shippingRules, {
      freezeLineRates: false,
      settings,
    });
  }

  const adminLocked = [
    "payment_verified",
    "dispatched",
    "delivered",
  ].includes(existing.status);

  if (adminLocked) return existing;

  let status = incoming.status;
  if (!CUSTOMER_ORDER_PROOF_STATUSES.has(status) && status !== existing.status) {
    status = existing.status;
  }
  if (
    status === "payment_verified" ||
    status === "dispatched" ||
    status === "delivered"
  ) {
    status = existing.status;
  }

  const hasProof =
    (incoming.paymentProof?.items?.length || 0) > 0 ||
    (existing.paymentProof?.items?.length || 0) > 0;
  if (hasProof && (status === "estimate" || status === "confirmed")) {
    status = "payment_pending";
  }

  const drafted: Order = {
    ...existing,
    // Customer sync must not rewrite items/rates — catalog rate changes
    // apply only to NEW orders. Staff edit uses editOrderBeforeBill.
    lines: existing.lines,
    walletUsed,
    deliveryAddress: incoming.deliveryAddress ?? existing.deliveryAddress,
    customerNotes: incoming.customerNotes ?? existing.customerNotes,
    checkoutName: incoming.checkoutName ?? existing.checkoutName,
    gstOrAadhar: incoming.gstOrAadhar ?? existing.gstOrAadhar,
    phone: existing.phone,
    transport: incoming.transport ?? existing.transport,
    fullTruckRequested:
      incoming.fullTruckRequested ?? existing.fullTruckRequested,
    shippingNotes: incoming.shippingNotes ?? existing.shippingNotes,
    status,
    paymentProof: scrubCustomerProof(
      incoming.paymentProof ?? existing.paymentProof
    ),
    timeline: existing.timeline,
    updatedAt: incoming.updatedAt || new Date().toISOString(),
    actualBillAmount: existing.actualBillAmount,
    actualWeightKg: existing.actualWeightKg,
    billFileDataUrl: existing.billFileDataUrl,
    billUploadedAt: existing.billUploadedAt,
    lrFileDataUrl: existing.lrFileDataUrl,
    lrNumber: existing.lrNumber,
    lrUploadedAt: existing.lrUploadedAt,
    adminNotes: existing.adminNotes,
    schemeApplied: existing.schemeApplied,
    stockReserved: existing.stockReserved,
    packingSlip: existing.packingSlip,
  };
  return repriceCustomerOrder(drafted, products, shippingRules, {
    freezeLineRates: true,
    settings,
  });
}

function sanitizeCustomerDeposit(
  incoming: WalletDeposit,
  existing: WalletDeposit | undefined,
  sessionId: string
): WalletDeposit | null {
  if (incoming.userId !== sessionId) return null;

  if (!existing) {
    const rawAmount = Number(incoming.amount);
    const amount = Number.isFinite(rawAmount)
      ? Math.min(MAX_DEPOSIT, Math.max(MIN_DEPOSIT, Math.round(rawAmount)))
      : MIN_DEPOSIT;
    const status = CUSTOMER_DEPOSIT_STATUSES.has(incoming.status)
      ? incoming.status
      : "awaiting_proof";
    const hasProof = (incoming.proof?.items?.length || 0) > 0;
    return {
      ...incoming,
      userId: sessionId,
      amount,
      status: hasProof
        ? "pending_verify"
        : status === "cancelled"
          ? "cancelled"
          : "awaiting_proof",
      proof: scrubCustomerProof(incoming.proof),
      verifiedAt: undefined,
      verifiedBy: undefined,
      rejectedAt: undefined,
      rejectedBy: undefined,
      rejectReason: undefined,
    };
  }

  if (existing.status === "verified" || existing.status === "rejected") {
    return existing;
  }

  let status = incoming.status;
  if (!CUSTOMER_DEPOSIT_STATUSES.has(status)) status = existing.status;
  const hasProof =
    (incoming.proof?.items?.length || 0) > 0 ||
    (existing.proof?.items?.length || 0) > 0;
  if (hasProof && status !== "cancelled") status = "pending_verify";

  return {
    ...existing,
    amount: existing.amount,
    note: incoming.note ?? existing.note,
    status,
    proof: scrubCustomerProof(incoming.proof ?? existing.proof),
    updatedAt: incoming.updatedAt || new Date().toISOString(),
    verifiedAt: undefined,
    verifiedBy: undefined,
    rejectedAt: undefined,
    rejectedBy: undefined,
    rejectReason: undefined,
  };
}

/** Merge users for staff with manage_users — never escalate to super_admin. */
function mergeUsersForStaff(
  incoming: UserProfile[],
  cloud: UserProfile[],
  actorId: string,
  tombs: TombMap = {}
): UserProfile[] {
  const cloudById = new Map(cloud.map((u) => [u.id, u] as const));
  const out = new Map(
    cloud
      .filter((u) => userBeatsTomb(u, tombs) || u.role === "super_admin")
      .map((u) => [u.id, { ...u }] as const)
  );

  for (const u of incoming) {
    if (!userBeatsTomb(u, tombs) && u.role !== "super_admin") {
      out.delete(u.id);
      continue;
    }
    const existing = cloudById.get(u.id);
    if (existing?.role === "super_admin") continue;
    if (u.role === "super_admin") continue;

    if (u.id === actorId && existing) {
      out.set(u.id, {
        ...existing,
        name: u.name || existing.name,
        email: u.email,
        locale: u.locale || existing.locale,
      });
      continue;
    }

    const keptHash = existing?.passwordHash || u.passwordHash || "";
    const role =
      u.role === "customer" ||
      u.role === "sales" ||
      u.role === "accounts" ||
      u.role === "dispatch" ||
      u.role === "viewer"
        ? u.role
        : "customer";

    out.set(u.id, {
      ...u,
      role,
      passwordHash: keptHash,
      passwordVisible: undefined,
      // Only owners (full push) may change capability overrides
      extraCapabilities: existing?.extraCapabilities,
      deniedCapabilities: existing?.deniedCapabilities,
    });
  }

  // Owners always stay as in cloud
  for (const u of cloud) {
    if (u.role === "super_admin") out.set(u.id, { ...u });
  }
  // Apply tombstones (never remove last active owner here — deleteUserAccount guards that)
  for (const id of Object.keys(tombs)) {
    const u = out.get(id);
    if (u?.role === "super_admin") continue;
    if (u && userBeatsTomb(u, tombs)) continue;
    out.delete(id);
  }
  return [...out.values()];
}

function mergeWalletBalances(
  incoming: UserProfile[],
  cloud: UserProfile[]
): UserProfile[] {
  const bal = new Map(
    incoming
      .filter((u) => u.role === "customer")
      .map((u) => [u.id, Math.max(0, Number(u.walletBalance) || 0)] as const)
  );
  return cloud.map((u) => {
    if (u.role !== "customer" || !bal.has(u.id)) return u;
    return { ...u, walletBalance: bal.get(u.id)! };
  });
}

function mergeByIdUnion<T extends { id: string }>(
  cloudItems: T[] | undefined,
  incomingItems: T[] | undefined
): T[] {
  const byId = new Map((cloudItems ?? []).map((x) => [x.id, x] as const));
  for (const item of incomingItems ?? []) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

function orderHasStockReserveMovement(
  db: AppDatabase,
  orderId: string
): boolean {
  return (db.stockMovements ?? []).some(
    (m) =>
      m.orderId === orderId &&
      (m.type === "estimate_reserve" || m.type === "sale")
  );
}

/**
 * Ensure every active stockReserved order has an estimate_reserve (or sale)
 * movement and matching product qty deduction. Retries after silent failures
 * or staff wipes. Safe to call repeatedly.
 * On failure, clear stockReserved so we never claim a reserve that does not exist.
 */
function reconcileEstimateStockReserves(db: AppDatabase): void {
  if (!db.stockMovements) db.stockMovements = [];
  if (!db.products) db.products = [];
  for (const o of db.orders ?? []) {
    if (!o.stockReserved || o.status === "cancelled") continue;
    if (orderHasStockReserveMovement(db, o.id)) continue;
    try {
      applyOrderEstimateStock(db, o, o.userId || "system", "reserve");
    } catch (err) {
      console.error(
        "[authorize-db] stock reserve reconcile failed",
        o.orderNumber,
        err instanceof Error ? err.message : err
      );
      o.stockReserved = false;
    }
  }
}

export type RejectedOrder = {
  id: string;
  orderNumber: string;
  reason: string;
};

export type MergePushResult = {
  db: AppDatabase;
  rejectedOrders?: RejectedOrder[];
};

/**
 * Limited staff push — overlay only capability-allowed collections.
 * Viewers cannot write.
 */
function mergeStaffLimitedPush(
  incoming: AppDatabase,
  cloud: AppDatabase,
  actor: UserProfile,
  actorId: string
): AppDatabase {
  const role = actor.role;
  if (role === "viewer" || !isStaffRole(role)) {
    throw new Error("Read-only role cannot sync changes");
  }

  const out = JSON.parse(JSON.stringify(cloud)) as AppDatabase;
  let touched = false;

  if (hasCap(actor, "manage_products")) {
    out.products = incoming.products ?? out.products;
    out.categories = incoming.categories ?? out.categories;
    touched = true;
  }
  if (hasCap(actor, "manage_schemes")) {
    out.schemes = incoming.schemes ?? out.schemes;
    touched = true;
  }
  if (hasCap(actor, "manage_shipping")) {
    out.shippingRules = incoming.shippingRules ?? out.shippingRules;
    touched = true;
  }
  if (hasCap(actor, "manage_orders")) {
    out.orders = incoming.orders ?? out.orders;
    // Bill / verify enqueue Tally posts alongside order updates
    out.tallyPosts = incoming.tallyPosts ?? out.tallyPosts;

    // Union movements — never let an empty staff local wipe cloud reserves
    const priorMoveIds = new Set(
      (out.stockMovements ?? []).map((m) => m.id)
    );
    const incomingMoves = incoming.stockMovements ?? [];
    const hasNewStockMoves = incomingMoves.some(
      (m) =>
        !priorMoveIds.has(m.id) &&
        (m.type === "estimate_reserve" ||
          m.type === "estimate_release" ||
          m.type === "sale" ||
          m.type === "adjustment")
    );
    out.stockMovements = mergeByIdUnion(out.stockMovements, incomingMoves);

    // Only replace products when staff actually has new stock moves, or they
    // manage catalog — otherwise stale local stock undoes customer reserves.
    if (hasNewStockMoves || hasCap(actor, "manage_products")) {
      out.products = incoming.products ?? out.products;
    }

    // Punch-with-wallet / estimate wallet debit must sync dealer balances
    out.walletTransactions =
      incoming.walletTransactions ?? out.walletTransactions;
    out.users = mergeWalletBalances(incoming.users ?? [], out.users);
    touched = true;
  }
  // Always union analytics — staff browsers often lack this array
  out.accessPlaces = mergeAccessPlaceLists(
    incoming.accessPlaces,
    cloud.accessPlaces
  );
  if (hasCap(actor, "manage_wallet")) {
    out.walletTransactions =
      incoming.walletTransactions ?? out.walletTransactions;
    out.walletDeposits = incoming.walletDeposits ?? out.walletDeposits;
    out.users = mergeWalletBalances(incoming.users ?? [], out.users);
    touched = true;
  }
  if (hasCap(actor, "manage_users")) {
    let tombs = mergeTombMaps(tombsFromDb(out), tombsFromDb(incoming));
    tombs = clearTombsBeatenByUsers(tombs, [
      ...(incoming.users ?? []),
      ...(out.users ?? []),
    ]);
    const tombFields = syncTombFields(tombs);
    out.deletedUserIds = tombFields.deletedUserIds;
    out.deletedUserAt = tombFields.deletedUserAt;
    out.users = mergeUsersForStaff(
      incoming.users ?? [],
      out.users,
      actorId,
      tombs
    );
    out.parties = incoming.parties ?? out.parties;
    touched = true;
  }
  if (hasCap(actor, "manage_accounts")) {
    out.accounts = incoming.accounts ?? out.accounts;
    out.parties = incoming.parties ?? out.parties;
    out.vouchers = incoming.vouchers ?? out.vouchers;
    out.ledgerEntries = incoming.ledgerEntries ?? out.ledgerEntries;
    out.stockMovements = mergeByIdUnion(
      out.stockMovements,
      incoming.stockMovements
    );
    out.billAllocations = incoming.billAllocations ?? out.billAllocations;
    out.purchaseOrders = incoming.purchaseOrders ?? out.purchaseOrders;
    out.goodsReceipts = incoming.goodsReceipts ?? out.goodsReceipts;
    out.supplierContracts =
      incoming.supplierContracts ?? out.supplierContracts;
    touched = true;
  }
  if (hasCap(actor, "manage_tally")) {
    if (incoming.settings && out.settings) {
      out.settings = {
        ...out.settings,
        tallySyncStatus: incoming.settings.tallySyncStatus,
        tallySyncMessage: incoming.settings.tallySyncMessage,
        tallyLastSyncAt: incoming.settings.tallyLastSyncAt,
      };
    }
    out.tallyPosts = incoming.tallyPosts ?? out.tallyPosts;
    touched = true;
  }

  if (!touched) {
    throw new Error("Your role cannot sync database changes");
  }

  // Always restore password hashes from cloud for any blank client hashes
  return mergePasswordHashes(out, cloud);
}

/**
 * Resolve the live cloud actor for a session cookie (role rebind).
 */
export function resolveCloudActor(
  existing: AppDatabase,
  session: ServerSession
): { actor: UserProfile; role: UserRole } {
  const actor = (existing.users ?? []).find((u) => u.id === session.id);
  if (!actor) throw new Error("Account not found in cloud database");
  if (!actor.active) throw new Error("Account is disabled");
  return { actor, role: actor.role };
}

function opsPurgeAt(db: AppDatabase | null | undefined): string {
  return getOpsPurgeAt(db);
}

/** True when incoming client has not seen the latest ops purge. */
function isIncomingStaleVsOpsPurge(
  incoming: AppDatabase,
  cloud: AppDatabase
): boolean {
  const cloudAt = opsPurgeAt(cloud);
  if (!cloudAt) return false;
  const inAt = opsPurgeAt(incoming);
  return !inAt || inAt < cloudAt;
}

/** Prefer the newest purge marker so a clear wins over stale copies. */
function preferNewestOpsPurge(
  target: AppDatabase,
  incoming: AppDatabase,
  cloud: AppDatabase
): AppDatabase {
  const newest = [opsPurgeAt(incoming), opsPurgeAt(cloud), opsPurgeAt(target)]
    .filter(Boolean)
    .sort()
    .at(-1);
  if (!newest || !target.settings) return target;
  if (opsPurgeAt(target) === newest) return target;
  return {
    ...target,
    settings: { ...target.settings, opsPurgeAt: newest },
  };
}

/** Keep catalog edits but lock wiped ops collections to cloud truth. */
function lockOpsCollectionsToCloud(
  target: AppDatabase,
  cloud: AppDatabase
): AppDatabase {
  return {
    ...target,
    users: cloud.users ?? [],
    deletedUserIds: cloud.deletedUserIds ?? [],
    deletedUserAt: cloud.deletedUserAt ?? {},
    orders: cloud.orders ?? [],
    walletTransactions: cloud.walletTransactions ?? [],
    walletDeposits: cloud.walletDeposits ?? [],
    vouchers: cloud.vouchers ?? [],
    ledgerEntries: cloud.ledgerEntries ?? [],
    billAllocations: cloud.billAllocations ?? [],
    stockMovements: cloud.stockMovements ?? [],
    stockBatches: cloud.stockBatches ?? [],
    batchConsumptions: cloud.batchConsumptions ?? [],
    purchaseOrders: cloud.purchaseOrders ?? [],
    goodsReceipts: cloud.goodsReceipts ?? [],
    supplierContracts: cloud.supplierContracts ?? [],
    tallyPosts: cloud.tallyPosts ?? [],
    statementMatches: cloud.statementMatches ?? [],
    accessPlaces: cloud.accessPlaces ?? [],
    parties: cloud.parties ?? [],
    settings: target.settings
      ? {
          ...target.settings,
          opsPurgeAt: cloud.settings?.opsPurgeAt ?? target.settings.opsPurgeAt,
        }
      : cloud.settings,
  };
}

/** Union access events by id — never let empty local wipe server analytics. */
function mergeAccessPlaceLists(
  incoming: AccessPlace[] | undefined,
  cloud: AccessPlace[] | undefined
): AccessPlace[] {
  const byId = new Map<string, AccessPlace>();
  for (const p of cloud ?? []) {
    if (p?.id) byId.set(p.id, p);
  }
  for (const p of incoming ?? []) {
    if (p?.id) byId.set(p.id, p);
  }
  return trimAccessPlaces(
    [...byId.values()].sort((a, b) =>
      String(a.at).localeCompare(String(b.at))
    )
  );
}

/**
 * Owner full-doc push.
 * Keeps cloud-only users (created on another device) UNLESS tombstoned.
 * Tombstones are timestamped — stale clients that still hold an old user
 * row cannot clear a newer delete.
 */
function mergeOwnerPushKeepCloudUsers(
  incoming: AppDatabase,
  cloud: AppDatabase
): AppDatabase {
  let tombs = mergeTombMaps(tombsFromDb(cloud), tombsFromDb(incoming));
  tombs = clearTombsBeatenByUsers(tombs, [
    ...(incoming.users ?? []),
    ...(cloud.users ?? []),
  ]);
  const tombFields = syncTombFields(tombs);

  const byId = new Map(
    applyTombsToUsers(incoming.users ?? [], tombs).map(
      (u) => [u.id, { ...u }] as const
    )
  );
  for (const u of applyTombsToUsers(cloud.users ?? [], tombs)) {
    const local = byId.get(u.id);
    if (!local) {
      // Created on another device (e.g. admin-create-user API) — keep it
      byId.set(u.id, { ...u });
      continue;
    }
    byId.set(u.id, {
      ...local,
      passwordHash: local.passwordHash || u.passwordHash,
    });
  }

  const partyById = new Map(
    (incoming.parties ?? []).map((p) => [p.id, { ...p }] as const)
  );
  // Newer ops purge from owner = intentional wipe; do not revive cloud-only parties
  const incomingPurgeNewer =
    !!opsPurgeAt(incoming) &&
    (!opsPurgeAt(cloud) || opsPurgeAt(incoming) > opsPurgeAt(cloud));
  if (!incomingPurgeNewer) {
    for (const p of cloud.parties ?? []) {
      if (!partyById.has(p.id)) partyById.set(p.id, { ...p });
    }
  }

  return {
    ...incoming,
    users: [...byId.values()],
    deletedUserIds: tombFields.deletedUserIds,
    deletedUserAt: tombFields.deletedUserAt,
    parties: [...partyById.values()],
    accessPlaces: mergeAccessPlaceLists(
      incoming.accessPlaces,
      cloud.accessPlaces
    ),
  };
}

/** Ensure every order has a distinct orderNumber (cross-device collisions). */
function ensureUniqueOrderNumbers(db: AppDatabase): AppDatabase {
  const orders = db.orders ?? [];
  if (orders.length < 2) return db;

  let maxSeq = 0;
  for (const o of orders) {
    const m = /TT-EST-(\d+)/i.exec(o.orderNumber || "");
    if (m) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n > maxSeq) maxSeq = n;
    }
  }

  const used = new Set<string>();
  const next = orders.map((o) => {
    let num = (o.orderNumber || "").trim();
    if (!num || used.has(num)) {
      maxSeq += 1;
      const uniq = `${Date.now().toString(36)}${Math.random()
        .toString(36)
        .slice(2, 4)}`
        .toUpperCase()
        .slice(-4);
      num = `TT-EST-${String(maxSeq).padStart(5, "0")}-${uniq}`;
      const slip = o.packingSlip
        ? {
            ...o.packingSlip,
            slipNo:
              !o.packingSlip.slipNo ||
              o.packingSlip.slipNo === `PS-${o.orderNumber}`
                ? `PS-${num}`
                : o.packingSlip.slipNo,
          }
        : o.packingSlip;
      used.add(num);
      return { ...o, orderNumber: num, packingSlip: slip };
    }
    used.add(num);
    return o;
  });

  return { ...db, orders: next };
}

/**
 * Customer pushes cannot rewrite staff users, products, accounts, or others' data.
 * Staff: only super_admin gets full doc; others are capability-scoped.
 */
export function mergeAuthorizedPush(
  incomingRaw: AppDatabase,
  existing: AppDatabase | null,
  session: ServerSession | null
): MergePushResult {
  const incoming = mergePasswordHashes(
    sanitizeDbForCloud(incomingRaw),
    existing
  );

  if (!existing?.users?.length) {
    if (!session || !isStaffRole(session.role)) {
      throw new Error("Staff login required to initialize cloud database");
    }
    // Bootstrap: only true owners
    if (session.role !== "super_admin") {
      throw new Error("Owner login required to initialize cloud database");
    }
    const boot = ensureUniqueOrderNumbers(incoming);
    reconcileEstimateStockReserves(boot);
    return { db: boot };
  }

  if (!session) {
    throw new Error("Login required to sync changes");
  }

  const { actor, role } = resolveCloudActor(existing, session);

  if (role === "super_admin") {
    // Full document, but preserve users/parties only present in cloud
    let merged = mergeOwnerPushKeepCloudUsers(incoming, existing);
    if (isIncomingStaleVsOpsPurge(incoming, existing)) {
      // Stale browser after ops purge — do not resurrect deleted users/orders
      merged = lockOpsCollectionsToCloud(merged, existing);
    }
    merged = preferNewestOpsPurge(merged, incoming, existing);
    const out = stripPrePurgeOps(ensureUniqueOrderNumbers(merged));
    reconcileEstimateStockReserves(out);
    return { db: out };
  }

  if (isStaffRole(role)) {
    let merged = mergeStaffLimitedPush(incoming, existing, actor, actor.id);
    if (isIncomingStaleVsOpsPurge(incoming, existing)) {
      merged = lockOpsCollectionsToCloud(merged, existing);
    }
    merged = preferNewestOpsPurge(merged, incoming, existing);
    const out = stripPrePurgeOps(ensureUniqueOrderNumbers(merged));
    reconcileEstimateStockReserves(out);
    return { db: out };
  }

  // Customer path
  const cloud = JSON.parse(JSON.stringify(existing)) as AppDatabase;
  const staleVsPurge = isIncomingStaleVsOpsPurge(incoming, existing);
  const meIn = (incoming.users ?? []).find((u) => u.id === session.id);
  const meCloud = (cloud.users ?? []).find((u) => u.id === session.id);
  if (!meCloud) {
    throw new Error("Account not found in cloud database");
  }

  if (meIn) {
    meCloud.name = meIn.name || meCloud.name;
    meCloud.company = meIn.company;
    meCloud.address = meIn.address;
    meCloud.pincode = meIn.pincode;
    meCloud.gstOrAadhar = meIn.gstOrAadhar;
    meCloud.transport = meIn.transport;
    meCloud.locale = meIn.locale || meCloud.locale;
    meCloud.email = meIn.email;
    // Allow phone change from profile if not taken
    const nextPhone = String(meIn.phone || "").trim();
    if (nextPhone && nextPhone !== meCloud.phone) {
      const clash = (cloud.users ?? []).some(
        (u) =>
          u.id !== session.id &&
          String(u.phone || "").replace(/\D/g, "").slice(-10) ===
            nextPhone.replace(/\D/g, "").slice(-10)
      );
      if (!clash) meCloud.phone = nextPhone;
    }
    delete (meCloud as { passwordVisible?: string }).passwordVisible;
  }

  const balanceBefore = Math.max(0, Number(meCloud.walletBalance) || 0);
  const prevWalletOnOrders = (cloud.orders ?? [])
    .filter((o) => o.userId === session.id)
    .reduce((s, o) => s + Math.max(0, Number(o.walletUsed) || 0), 0);

  const products = cloud.products ?? [];
  const shippingRules = cloud.shippingRules ?? [];
  const settings = cloud.settings ?? null;

  const cloudOrdersById = new Map(
    (cloud.orders ?? [])
      .filter((o) => o.userId === session.id)
      .map((o) => [o.id, o] as const)
  );
  const sanitizedOrders: Order[] = [];
  const seenIds = new Set<string>();
  const newlyReserved: Order[] = [];
  for (const o of (incoming.orders ?? []).filter(
    (x) => x.userId === session.id
  )) {
    if (seenIds.has(o.id)) continue;
    // Reject ID collisions with someone else's order
    const foreign = (cloud.orders ?? []).find(
      (x) => x.id === o.id && x.userId !== session.id
    );
    if (foreign) continue;
    // After ops purge, refuse resurrecting deleted order ids from stale cache
    if (staleVsPurge && !cloudOrdersById.has(o.id)) continue;
    seenIds.add(o.id);
    const prev = cloudOrdersById.get(o.id);
    const next = sanitizeCustomerOrder(
      o,
      prev,
      session.id,
      balanceBefore,
      products,
      shippingRules,
      settings
    );
    if (next) {
      sanitizedOrders.push(next);
      // New or previously failed reserve → apply on cloud stock
      if (next.stockReserved && next.status !== "cancelled") {
        newlyReserved.push(next);
      }
    }
  }
  for (const [id, o] of cloudOrdersById) {
    if (!sanitizedOrders.some((x) => x.id === id)) sanitizedOrders.push(o);
  }

  let remaining = balanceBefore + prevWalletOnOrders;
  for (const o of sanitizedOrders) {
    const used = Math.max(0, Number(o.walletUsed) || 0);
    const capped = Math.min(used, remaining);
    o.walletUsed = capped;
    remaining -= capped;
  }

  const nextWalletOnOrders = sanitizedOrders.reduce(
    (s, o) => s + Math.max(0, Number(o.walletUsed) || 0),
    0
  );
  const delta = nextWalletOnOrders - prevWalletOnOrders;
  meCloud.walletBalance = Math.max(0, balanceBefore - delta);

  cloud.orders = [
    ...(cloud.orders ?? []).filter((o) => o.userId !== session.id),
    ...sanitizedOrders,
  ];

  // Apply estimate stock reserves for customer orders (cloud catalog truth).
  // On failure, drop the order so we never save an oversold estimate.
  if (!cloud.stockMovements) cloud.stockMovements = [];
  const rejectedOrders: RejectedOrder[] = [];
  const rejectedIds = new Set<string>();
  for (const o of newlyReserved) {
    if (orderHasStockReserveMovement(cloud, o.id)) continue;
    // Only reject brand-new orders (not already on cloud) — existing ones
    // are repaired/cleared by reconcileEstimateStockReserves below.
    if (cloudOrdersById.has(o.id)) continue;
    try {
      applyOrderEstimateStock(cloud, o, session.id, "reserve");
    } catch (err) {
      const reason =
        err instanceof Error ? err.message : "Insufficient stock";
      console.error(
        "[authorize-db] customer stock reserve failed",
        o.orderNumber,
        reason
      );
      rejectedOrders.push({
        id: o.id,
        orderNumber: o.orderNumber,
        reason,
      });
      rejectedIds.add(o.id);
    }
  }
  if (rejectedIds.size) {
    cloud.orders = (cloud.orders ?? []).filter((o) => !rejectedIds.has(o.id));
    // Refund wallet that was reserved against the rejected order(s)
    let refund = 0;
    for (const o of sanitizedOrders) {
      if (!rejectedIds.has(o.id)) continue;
      refund += Math.max(0, Number(o.walletUsed) || 0);
    }
    if (refund > 0) {
      meCloud.walletBalance = Math.max(
        0,
        (Number(meCloud.walletBalance) || 0) + refund
      );
    }
  }

  const cloudDepsById = new Map(
    (cloud.walletDeposits ?? [])
      .filter((d) => d.userId === session.id)
      .map((d) => [d.id, d] as const)
  );
  const sanitizedDeps: WalletDeposit[] = [];
  for (const d of (incoming.walletDeposits ?? []).filter(
    (x) => x.userId === session.id
  )) {
    if (staleVsPurge && !cloudDepsById.has(d.id)) continue;
    const next = sanitizeCustomerDeposit(
      d,
      cloudDepsById.get(d.id),
      session.id
    );
    if (next) sanitizedDeps.push(next);
  }
  for (const [id, d] of cloudDepsById) {
    if (!sanitizedDeps.some((x) => x.id === id)) sanitizedDeps.push(d);
  }
  cloud.walletDeposits = [
    ...(cloud.walletDeposits ?? []).filter((d) => d.userId !== session.id),
    ...sanitizedDeps,
  ];

  const out = stripPrePurgeOps(ensureUniqueOrderNumbers(cloud));
  reconcileEstimateStockReserves(out);
  return {
    db: out,
    rejectedOrders: rejectedOrders.length ? rejectedOrders : undefined,
  };
}
