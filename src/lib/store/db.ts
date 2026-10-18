"use client";

import {
  DEFAULT_SETTINGS,
  SEED_CATEGORIES,
  SEED_SHIPPING,
  SEED_USERS,
  hashPassword,
} from "../seed";
import {
  ACCT,
  SEED_ACCOUNTS,
  buildSeedAccounting,
  buildLedgerEntries,
  creditLimitBreach,
  nextVoucherNumber,
  partyBalance,
  refreshInvoiceOutstanding,
  summarizeLines,
  addPurchaseLayers,
  consumeFifo,
  reverseVoucherCosting,
  lineMeasure,
  createBatchFromLine,
  findProductByLabel,
  findVariationId,
  parseBillCsv,
  parsePartyCsv,
  parseStockCsv,
  rebalanceCapitalOpening,
  syncPartyControlOpenings,
  assertPeriodOpen,
  buildBooksBackupPayload,
  isCashBankAccount,
  postBalancedJournal,
  voidJournalOn,
  saleDueDate,
  assertSaleUnderCredit,
  voidBooksForCancelledOrders,
  voidBooksForOrder,
  type BillCsvRow,
  type PartyCsvRow,
  type StockCsvRow,
} from "../accounting";
import { assertPriorMonthAudited } from "../month-close-policy";
import {
  draftCompanyBankAccount,
  type NewCompanyBankInput,
} from "../bank-accounts";
import type {
  Account,
  AppSettings,
  BillAllocation,
  CartItem,
  CategoryDef,
  GoodsReceipt,
  GoodsReceiptLine,
  LedgerEntry,
  Locale,
  Order,
  OrderStatus,
  Party,
  PaymentProofItem,
  Product,
  PurchaseOrder,
  PurchaseOrderLine,
  Scheme,
  SessionUser,
  ShippingRule,
  StockMovement,
  StockBatch,
  BatchConsumption,
  StatementMatch,
  StatementMatchExtra,
  BankAccountDetails,
  BankRecon,
  BankReconExtra,
  SupplierContract,
  UserProfile,
  UserRole,
  Voucher,
  VoucherLine,
  VoucherType,
  WalletTransaction,
  WalletDeposit,
  TallyPost,
  UnitOfSale,
  AccessPlace,
  PeopleActivity,
  RolePresets,
  StaffJob,
  HrTerms,
  HrShift,
  HrSite,
  HrPunch,
  HrLeave,
  HrAdvance,
  HrPayslip,
  StockCount,
  CashCount,
  MonthlyAudit,
  Bom,
  JobCard,
  OwnerApproval,
} from "../types";
import type { WaInbox } from "../whatsapp-inbox";
import { ROLE_CAPABILITIES, type Capability } from "../types";
import {
  capabilityContextFrom,
  isSalesDeskOnly,
  sanitizeRolePresets,
  sanitizeStaffJob,
  sanitizeStaffJobs,
  userHasCapability,
} from "../capabilities";
import { dedupeProductVariations } from "../media";
import { fallbackNewProducts, toggleId } from "../home-merch";
import {
  applyContractUsage,
  reverseContractUsage,
  resolveOpenContract,
} from "../contracts";
import {
  buildOrderLine,
  calcLineTotal,
  isPackCountUnit,
  roundMoney,
  roundOffRupees,
} from "../pricing";
import { calcShippingAmount } from "@/lib/shipping";
import { shouldRetrySessionCookieCheck } from "@/lib/sync-errors";
import { buildDraftPosFromAlerts } from "@/lib/reorder-po";
import { confirmDraftPurchaseOrder, cancelDraftPurchaseOrder } from "@/lib/purchase-orders";
import { placeEstimateOnDatabase } from "@/lib/place-estimate";
import {
  cancelIssuedJobCardOn,
  completeJobCardOn,
  createJobCardOn,
  issueJobCardOn,
  orderJobMaterialsOn,
  upsertBomOn,
} from "@/lib/production";
import { stockAlertsFromDb } from "@/lib/accounting/analysis";
import { normalizeProductLocalized } from "@/lib/localized";
import {
  buildHrPunch,
  dateInIst,
  ensureHrAuditCollections,
  ensureStaffHrTerms,
  isHrMonthLocked,
  punchKindGuard,
} from "@/lib/hr";
import {
  adjustmentsFromApprovedLines,
  canEnterPhysicalCount,
  ensureCountCollections,
  startCashCountSession,
  startStockCountSession,
} from "@/lib/stock-count";
import {
  applyOwnerApproval,
  ensureOwnerApprovals,
  extractSellingRates,
  overlayLiveSellingRates,
  productRatesTargetKey,
  schemeAssignTargetKey,
  schemeDeleteTargetKey,
  schemeUpsertTargetKey,
  schemesEffectivelyEqual,
  sellingRatesEqual,
  upsertPendingApproval,
} from "@/lib/owner-approvals";
export {
  calcWeightSlabShipping,
  calcShippingAmount,
} from "@/lib/shipping";
import { normalizePhone, phonesMatch } from "../phone";
import { applyDealerFileActions } from "../dealer-file";
import { canTransitionOrderStatus } from "../order-stages";
import {
  applyTallyAvailability,
  applyTallyStock,
  cancelTallySale,
  enqueueTallySale,
  type TallyStockInput,
} from "@/lib/tally-sync";
import {
  applyGrnStock,
  applyOrderEstimateStock,
  applyVoucherStock,
  assertOrderStockAvailable,
  assertSaleVoucherStockAvailable,
  deriveSecondaryQty,
  ensureStockSecondary,
  getSizeColorStock,
  linesFromOrderProducts,
  normalizeProductStock,
  orderLineSecondaryQty,
  rebalanceOrderReservation,
  setSizeColorStock,
} from "../inventory";
import {
  dealerHasScheme,
  estimateSchemePayout,
  getAchievedTier,
  isOrderDiscountScheme,
  isPercentScheme,
  isSchemeActiveNow,
  isSchemeEnded,
  netSchemeSettlement,
  pickBestOrderDiscount,
  applyBillDiscounts,
  billDiscountReceiptLabel,
  orderDiscountMathLabel,
  orderDiscountMathQty,
  progressForScheme,
  schemeLevelLabel,
  schemeTierPercent,
  schemeTierRate,
  schemeUnitLabel,
  valueForScheme,
} from "../schemes";
import { getProofItems, proofPaidTotal, proofRemaining } from "../proofs";
import { paymentAmountDue } from "../upi";
import {
  buildPackingSlipFromOrder,
  columnBundles,
  computeBillFromSlip,
  lineActualWeightsFromSlip,
  normalizePackingSlip,
  refreshPackingSlipColumns,
  shippingWeightFromSlip,
  slipHasEntries,
  syncBundlesFromCells,
} from "../packing-slip";
import type { PackingSlip } from "../types";
import { stampUserTomb, tombsFromDb, userBeatsTomb } from "../user-tombs";

const DB_KEY = "tt_enterprises_db_v12";
const SESSION_KEY = "tt_enterprises_session_v1";
const CART_KEY = "tt_enterprises_cart_v1";

export interface AppDatabase {
  users: UserProfile[];
  /**
   * Tombstones for hard-deleted logins. Sync must never resurrect these IDs
   * from another device’s stale localStorage or owner merge “keep cloud users”.
   */
  deletedUserIds?: string[];
  /** id → ISO deletedAt; newer tomb wins over older user.createdAt copies. */
  deletedUserAt?: Record<string, string>;
  products: Product[];
  orders: Order[];
  schemes: Scheme[];
  walletTransactions: WalletTransaction[];
  walletDeposits: WalletDeposit[];
  shippingRules: ShippingRule[];
  categories: CategoryDef[];
  settings: AppSettings;
  accounts: Account[];
  parties: Party[];
  vouchers: Voucher[];
  ledgerEntries: LedgerEntry[];
  stockMovements: StockMovement[];
  stockBatches: StockBatch[];
  batchConsumptions: BatchConsumption[];
  billAllocations: BillAllocation[];
  purchaseOrders: PurchaseOrder[];
  goodsReceipts: GoodsReceipt[];
  supplierContracts: SupplierContract[];
  tallyPosts: TallyPost[];
  statementMatches: StatementMatch[];
  /** Bank reconciliation sessions (Tally BRS). */
  bankRecons?: BankRecon[];
  /** Login + page access events for admin Tracking (staff-only in projections). */
  accessPlaces: AccessPlace[];
  /** Owner overlay of built-in staff role defaults. */
  rolePresets?: RolePresets;
  /** Named staff jobs (permission templates). */
  staffJobs?: StaffJob[];
  /** Owner-visible dealer approve / revoke / file-edit trail. */
  peopleActivity?: PeopleActivity[];
  /** Unused cloud leftover — stripped from browser GET, restored on PUT. */
  waInbox?: WaInbox;
  hrTerms?: HrTerms[];
  hrShifts?: HrShift[];
  hrSites?: HrSite[];
  hrPunches?: HrPunch[];
  hrLeaves?: HrLeave[];
  hrAdvances?: HrAdvance[];
  hrPayslips?: HrPayslip[];
  stockCounts?: StockCount[];
  cashCounts?: CashCount[];
  monthlyAudits?: MonthlyAudit[];
  boms?: Bom[];
  jobCards?: JobCard[];
  /** Staff selling-rate / scheme writes waiting for owner (`view_financials`). */
  ownerApprovals?: OwnerApproval[];
}

function emptyDb(): AppDatabase {
  const seedAcct = buildSeedAccounting();
  return {
    users: structuredClone(SEED_USERS),
    deletedUserIds: [],
    deletedUserAt: {},
    products: [],
    orders: [],
    schemes: [],
    walletTransactions: [],
    walletDeposits: [],
    shippingRules: structuredClone(SEED_SHIPPING),
    categories: structuredClone(SEED_CATEGORIES),
    settings: structuredClone(DEFAULT_SETTINGS),
    accounts: structuredClone(SEED_ACCOUNTS),
    parties: [],
    vouchers: seedAcct.vouchers,
    ledgerEntries: seedAcct.ledgerEntries,
    stockMovements: [],
    stockBatches: [],
    batchConsumptions: [],
    billAllocations: [],
    statementMatches: [],
    bankRecons: [],
    purchaseOrders: [],
    goodsReceipts: [],
    supplierContracts: [],
    tallyPosts: [],
    accessPlaces: [],
    rolePresets: {},
    staffJobs: [],
    peopleActivity: [],
    waInbox: { messages: [], reads: [] },
    hrTerms: [],
    hrShifts: [],
    hrSites: [],
    hrPunches: [],
    hrLeaves: [],
    hrAdvances: [],
    hrPayslips: [],
    stockCounts: [],
    cashCounts: [],
    monthlyAudits: [],
    boms: [],
    jobCards: [],
    ownerApprovals: [],
  };
}

function canUseStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

/** Dealers stay pending unless approved is explicitly true. */
function dealerApprovedFlag(u: {
  role: string;
  approved?: unknown;
}): boolean {
  if (u.role !== "customer") return u.approved !== false;
  return u.approved === true || u.approved === "true";
}

export function loadDb(): AppDatabase {
  if (!canUseStorage()) return emptyDb();
  const raw = localStorage.getItem(DB_KEY);
  if (!raw) {
    const db = emptyDb();
    localStorage.setItem(DB_KEY, JSON.stringify(db));
    return db;
  }
  try {
    const parsed = JSON.parse(raw) as AppDatabase;
    parsed.settings = {
      ...DEFAULT_SETTINGS,
      ...parsed.settings,
      bankAccount: {
        ...DEFAULT_SETTINGS.bankAccount,
        ...(parsed.settings?.bankAccount ?? {}),
      },
      weightShipping: {
        ...DEFAULT_SETTINGS.weightShipping!,
        ...(parsed.settings?.weightShipping ?? {}),
      },
      jhalShipping: {
        ...DEFAULT_SETTINGS.jhalShipping!,
        ...(parsed.settings?.jhalShipping ?? {}),
      },
    };
    if (!parsed.categories?.length) {
      parsed.categories = structuredClone(SEED_CATEGORIES);
    }
    if (!parsed.accounts?.length) {
      parsed.accounts = structuredClone(SEED_ACCOUNTS);
    }
    if (!parsed.parties) parsed.parties = [];
    if (!parsed.vouchers) {
      const seedAcct = buildSeedAccounting();
      parsed.vouchers = seedAcct.vouchers;
      parsed.ledgerEntries = seedAcct.ledgerEntries;
    }
    if (!parsed.ledgerEntries) parsed.ledgerEntries = [];
    if (!parsed.stockMovements) parsed.stockMovements = [];
    if (!parsed.billAllocations) parsed.billAllocations = [];
    if (!parsed.purchaseOrders) parsed.purchaseOrders = [];
    if (!parsed.goodsReceipts) parsed.goodsReceipts = [];
    if (!parsed.supplierContracts) parsed.supplierContracts = [];
    if (!parsed.walletDeposits) parsed.walletDeposits = [];
    if (!parsed.tallyPosts) parsed.tallyPosts = [];
    if (!parsed.stockBatches) parsed.stockBatches = [];
    if (!parsed.batchConsumptions) parsed.batchConsumptions = [];
    if (!parsed.statementMatches) parsed.statementMatches = [];
    if (!parsed.bankRecons) parsed.bankRecons = [];
    if (!parsed.accessPlaces) parsed.accessPlaces = [];
    if (!parsed.waInbox) parsed.waInbox = { messages: [], reads: [] };
    if (!parsed.waInbox.messages) parsed.waInbox.messages = [];
    if (!parsed.waInbox.reads) parsed.waInbox.reads = [];
    ensureHrAuditCollections(parsed);
    ensureCountCollections(parsed);
    if (!parsed.boms) parsed.boms = [];
    if (!parsed.jobCards) parsed.jobCards = [];
    ensureOwnerApprovals(parsed);

    // Ensure perpetual accounting setup + FIFO migration
    const accountingMigrated = ensurePerpetualAccounting(parsed);

    for (const v of parsed.vouchers) {
      if (
        (v.type === "sale" || v.type === "purchase") &&
        v.outstanding == null &&
        !v.voided
      ) {
        refreshInvoiceOutstanding(
          v,
          parsed.vouchers,
          parsed.billAllocations
        );
      }
    }
    parsed.users = (parsed.users ?? []).map((u) => ({
      ...u,
      phone: u.phone || normalizePhone(u.email || "") || `unknown_${u.id}`,
      email: u.email,
      schemeProgress: u.schemeProgress || {},
      schemeValueProgress: u.schemeValueProgress || {},
      approved: dealerApprovedFlag(u),
    }));
    parsed.rolePresets = sanitizeRolePresets(parsed.rolePresets);
    parsed.staffJobs = sanitizeStaffJobs(parsed.staffJobs);
    // Normalize scheme tiers (ratePerUnit) from legacy creditAmount if needed
    parsed.schemes = (parsed.schemes ?? []).map((s) => {
      const levels = (s.levels || []).map((l, i) => ({
        ...l,
        ratePerUnit:
          Number(l.ratePerUnit) > 0
            ? Number(l.ratePerUnit)
            : (l.creditAmount || 0) > 0 && (l.targetAmount || 0) > 0
              ? roundMoney((l.creditAmount || 0) / l.targetAmount)
              : s.discountPerKg || 0,
        name: l.name || {
          en: `Tier ${i + 1}`,
          hi: `टियर ${i + 1}`,
        },
      }));
      return {
        ...s,
        rewardType:
          s.rewardType === "percent"
            ? "percent"
            : s.rewardType === "order_percent"
              ? "order_percent"
              : s.rewardType === "order_flat"
                ? "order_flat"
                : s.rewardType === "order_rate"
                  ? "order_rate"
                  : s.rewardType === "order_per_kg"
                    ? "order_per_kg"
                    : "per_kg_rate",
        levels:
          levels.length > 0
            ? levels
            : [
                {
                  id: `${s.id}_tier1`,
                  name: { en: "Tier 1", hi: "टियर 1" },
                  targetAmount: s.targetWeightKg || 0,
                  ratePerUnit:
                    s.discountPerKg ||
                    ((s.targetWeightKg || 0) > 0 && (s.creditAmount || 0) > 0
                      ? roundMoney((s.creditAmount || 0) / (s.targetWeightKg || 1))
                      : 0),
                  creditAmount: 0,
                },
              ],
      };
    });
    // Backfill: every dealer/customer user gets an Accounts party
    const partyCountBefore = parsed.parties.length;
    for (const u of parsed.users) {
      if (u.role === "customer") ensureCustomerParty(parsed, u);
    }
    let stockMigrated = false;
    let localizedMigrated = false;
    for (const p of parsed.products ?? []) {
      // Repair missing name/hi/en from truncated auto-translate saves
      try {
        if (normalizeProductLocalized(p)) localizedMigrated = true;
      } catch {
        /* keep going — catalog must load */
      }
      const hadMatrix = !!p.stockMatrix && Object.keys(p.stockMatrix).length > 0;
      ensureStockSecondary(p);
      if (
        !hadMatrix &&
        p.colors?.length &&
        p.variations?.length &&
        p.stockMatrix &&
        Object.keys(p.stockMatrix).length > 0
      ) {
        stockMigrated = true;
      }
    }
    // Credit any schemes that already ended (single payout per scheme).
    // Track ANY change (credit OR adjustment) so we never lose a debit.
    const settleNow = new Date().toISOString();
    let settledAny = false;
    for (const user of parsed.users) {
      if (settleEndedSchemesForUser(parsed, user, settleNow).changed) {
        settledAny = true;
      }
    }

    const cancelledBooks = voidBooksForCancelledOrders(parsed, "system");

    if (
      parsed.parties.length !== partyCountBefore ||
      stockMigrated ||
      localizedMigrated ||
      settledAny ||
      accountingMigrated ||
      cancelledBooks.changed
    ) {
      localStorage.setItem(DB_KEY, JSON.stringify(parsed));
    }
    return parsed;
  } catch {
    // Never wipe with seed — that can push an empty DB over cloud.
    try {
      localStorage.setItem(`${DB_KEY}_corrupt`, raw);
      localStorage.removeItem(DB_KEY);
    } catch {
      /* ignore storage errors during recovery */
    }
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tt-sync-error", {
          detail:
            "Local data was unreadable — restoring from cloud. Do not place orders until sync finishes.",
        })
      );
      try {
        sessionStorage.setItem("tt_db_corrupt_recovery", "1");
      } catch {
        /* ignore */
      }
    }
    return emptyDb();
  }
}

/** Returns true when the DB was mutated (caller should persist). */
export function ensurePerpetualAccounting(db: AppDatabase): boolean {
  let changed = false;
  if (!db.stockBatches) {
    db.stockBatches = [];
    changed = true;
  }
  if (!db.batchConsumptions) {
    db.batchConsumptions = [];
    changed = true;
  }

  // Ensure new accounts exist (perpetual + M7 expense heads)
  const needed = [
    { id: ACCT.inventory, code: "1300", name: { en: "Inventory", hi: "इन्वेंटरी" }, type: "asset" as const },
    { id: ACCT.wip, code: "1305", name: { en: "Work in progress", hi: "WIP" }, type: "asset" as const },
    { id: ACCT.cogs, code: "5002", name: { en: "Cost of Goods Sold", hi: "बेचे गए माल की लागत" }, type: "expense" as const },
    { id: ACCT.grni, code: "2105", name: { en: "Goods Received Not Billed", hi: "माल प्राप्त पर बिल नहीं" }, type: "liability" as const },
    { id: ACCT.freight, code: "5101", name: { en: "Freight / Cartage", hi: "भाड़ा" }, type: "expense" as const },
    { id: ACCT.rent, code: "5102", name: { en: "Rent", hi: "किराया" }, type: "expense" as const },
    { id: ACCT.salary, code: "5103", name: { en: "Salary / Wages", hi: "वेतन" }, type: "expense" as const },
    { id: ACCT.electricity, code: "5104", name: { en: "Electricity", hi: "बिजली" }, type: "expense" as const },
    { id: ACCT.packing, code: "5105", name: { en: "Packing / Material", hi: "पैकिंग" }, type: "expense" as const },
    { id: ACCT.wastage, code: "5106", name: { en: "Wastage / write-off", hi: "वेस्टेज" }, type: "expense" as const },
    { id: ACCT.miscExpense, code: "5199", name: { en: "Misc. Expense", hi: "अन्य खर्च" }, type: "expense" as const },
    {
      id: ACCT.freightCharges,
      code: "4101",
      name: { en: "Freight charges recovered", hi: "भाड़ा वसूली" },
      type: "income" as const,
    },
    {
      id: ACCT.packingCharges,
      code: "4102",
      name: { en: "Packing charges recovered", hi: "पैकिंग वसूली" },
      type: "income" as const,
    },
    {
      id: ACCT.otherCharges,
      code: "4199",
      name: { en: "Other charges recovered", hi: "अन्य वसूली" },
      type: "income" as const,
    },
    {
      id: ACCT.roundOff,
      code: "5200",
      name: { en: "Round Off", hi: "राउंड ऑफ" },
      type: "expense" as const,
    },
  ];
  for (const spec of needed) {
    if (!db.accounts.find((a) => a.id === spec.id)) {
      db.accounts.push({
        id: spec.id,
        code: spec.code,
        name: spec.name,
        type: spec.type,
        openingBalance: 0,
        active: true,
      });
      changed = true;
    }
  }

  // Migrate ledger entries: purchase → inventory
  for (const entry of db.ledgerEntries) {
    if (
      (entry.voucherType === "purchase" || entry.voucherType === "debit_note") &&
      entry.accountId === ACCT.purchase
    ) {
      entry.accountId = ACCT.inventory;
      changed = true;
    }
  }

  // One-time FIFO rebuild
  if (!db.settings.fifoMigratedAt) {
    const needsMigration =
      db.stockBatches.length === 0 &&
      (db.vouchers.some((v) => v.type === "purchase" && !v.voided) ||
        db.products.some((p) => (p.stockSecondary ?? 0) > 0));
    if (needsMigration) {
      rebuildFifoFromHistory(db);
    }
    db.settings.fifoMigratedAt = new Date().toISOString();
    changed = true;
  }

  // Keep Debtors/Creditors openings aligned with party openings
  const beforeDebtors = db.accounts.find((a) => a.id === ACCT.debtors)?.openingBalance;
  const beforeCreditors = db.accounts.find((a) => a.id === ACCT.creditors)?.openingBalance;
  syncPartyControlOpenings(db.parties, db.accounts);
  if (
    beforeDebtors !== db.accounts.find((a) => a.id === ACCT.debtors)?.openingBalance ||
    beforeCreditors !== db.accounts.find((a) => a.id === ACCT.creditors)?.openingBalance
  ) {
    changed = true;
  }

  // Repair ledger rows missing partyId when the voucher has one
  const voucherParty = new Map(
    db.vouchers.filter((v) => v.partyId).map((v) => [v.id, v.partyId!])
  );
  for (const e of db.ledgerEntries) {
    if (e.voided || e.partyId) continue;
    if (
      e.accountId !== ACCT.debtors &&
      e.accountId !== ACCT.creditors
    ) {
      continue;
    }
    const pid = voucherParty.get(e.voucherId);
    if (pid) {
      e.partyId = pid;
      changed = true;
    }
  }

  return changed;
}

function rebuildFifoFromHistory(db: AppDatabase): void {
  db.stockBatches = [];
  db.batchConsumptions = [];

  // Sort vouchers by date, createdAt
  const sorted = db.vouchers
    .filter((v) => !v.voided)
    .sort((a, b) => {
      const dateComp = a.date.localeCompare(b.date);
      if (dateComp !== 0) return dateComp;
      return a.createdAt.localeCompare(b.createdAt);
    });

  for (const v of sorted) {
    if (v.type === "purchase") {
      addPurchaseLayers(db.stockBatches, v);
    } else if (v.type === "sale") {
      const lines = v.lines
        .filter((l) => l.productId)
        .map((l) => ({
          productId: l.productId!,
          variationId: l.variationId,
          colorId: l.colorId,
          qty: lineMeasure(l),
        }));
      if (lines.length > 0) {
        try {
          consumeFifo(db.stockBatches, db.batchConsumptions, {
            voucherId: v.id,
            date: v.date,
            lines,
            allowShortfall: true,
          });
        } catch {
          // Historical sale may fail; skip
        }
      }
    } else if (v.type === "credit_note") {
      // Sales return: add layers at line rate
      for (const line of v.lines) {
        if (!line.productId) continue;
        const measure = lineMeasure(line);
        if (measure <= 0) continue;
        db.stockBatches.push(
          createBatchFromLine({
            date: v.date,
            productId: line.productId,
            variationId: line.variationId,
            colorId: line.colorId,
            qty: measure,
            rate: line.rate,
            unit: line.unit,
            source: "sale_return",
            voucherId: v.id,
          })
        );
      }
    } else if (v.type === "debit_note") {
      // Purchase return: consume layers
      const lines = v.lines
        .filter((l) => l.productId)
        .map((l) => ({
          productId: l.productId!,
          variationId: l.variationId,
          colorId: l.colorId,
          qty: lineMeasure(l),
        }));
      if (lines.length > 0) {
        try {
          consumeFifo(db.stockBatches, db.batchConsumptions, {
            voucherId: v.id,
            date: v.date,
            lines,
            allowShortfall: true,
          });
        } catch {
          // Skip on shortfall
        }
      }
    }
  }

  // Provisional opening layers for physical stock that still has no cost
  const today = new Date().toISOString().slice(0, 10);
  for (const prod of db.products) {
    if (prod.variations.length) {
      for (const variation of prod.variations) {
        const varStock = variation.stockSecondary ?? 0;
        if (varStock <= 0) continue;
        const remaining = db.stockBatches
          .filter(
            (b) =>
              b.productId === prod.id &&
              b.variationId === variation.id &&
              b.qty > 0
          )
          .reduce((sum, b) => sum + b.qty, 0);
        const shortfall = varStock - remaining;
        if (shortfall > 0.001) {
          db.stockBatches.push(
            createBatchFromLine({
              date: today,
              productId: prod.id,
              variationId: variation.id,
              qty: shortfall,
              rate: 0,
              unit: prod.unit,
              source: "opening",
              provisional: true,
            })
          );
        }
      }
    } else {
      const stock = prod.stockSecondary ?? 0;
      if (stock <= 0) continue;
      const remaining = db.stockBatches
        .filter((b) => b.productId === prod.id && !b.variationId && b.qty > 0)
        .reduce((sum, b) => sum + b.qty, 0);
      const shortfall = stock - remaining;
      if (shortfall > 0.001) {
        db.stockBatches.push(
          createBatchFromLine({
            date: today,
            productId: prod.id,
            qty: shortfall,
            rate: 0,
            unit: prod.unit,
            source: "opening",
            provisional: true,
          })
        );
      }
    }
  }
}

/**
 * Before a sale consumes FIFO, top up any shortfall with a provisional rate-0
 * layer so billing never blocks — owner later sets real cost via opening stock.
 */
function ensureCostLayersForDemand(
  batches: StockBatch[],
  lines: {
    productId: string;
    variationId?: string;
    colorId?: string;
    qty: number;
  }[],
  date: string
): void {
  for (const line of lines) {
    if (line.qty <= 0) continue;
    const available = batches
      .filter((b) => {
        if (b.productId !== line.productId || b.qty <= 0) return false;
        if (b.variationId !== line.variationId) return false;
        if (line.colorId && b.colorId !== line.colorId) return false;
        return true;
      })
      .reduce((s, b) => s + b.qty, 0);
    const shortfall = roundMoney(line.qty - available);
    if (shortfall > 0.001) {
      batches.push(
        createBatchFromLine({
          date,
          productId: line.productId,
          variationId: line.variationId,
          colorId: line.colorId,
          qty: shortfall,
          rate: 0,
          source: "opening",
          provisional: true,
        })
      );
    }
  }
}

export function saveDb(
  db: AppDatabase,
  opts?: { skipCloudPush?: boolean }
): void {
  if (!canUseStorage()) return;
  // Never persist plaintext passwords that admins briefly reveal in the UI.
  for (const u of db.users ?? []) {
    if ("passwordVisible" in u) {
      delete (u as { passwordVisible?: string }).passwordVisible;
    }
  }
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (err) {
    const quota =
      err instanceof DOMException &&
      (err.name === "QuotaExceededError" || err.code === 22);
    if (typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent("tt-sync-error", {
          detail: quota
            ? "Device storage full — change may still sync to cloud. Free space or clear old bills/photos."
            : "Could not save locally — syncing to cloud.",
        })
      );
    }
    // Still attempt cloud push so the write is not lost.
  }
  window.dispatchEvent(new Event("tt-db-updated"));
  if (opts?.skipCloudPush) return;
  // Prefer Supabase shared sync; never fall back to Firebase when Supabase is on
  // (Firebase anon full-doc write bypasses hardened /api/db).
  void import("@/lib/supabase/sync")
    .then(async (m) => {
      if (m.supabaseSyncEnabled() || (await m.detectSupabaseSync())) {
        m.schedulePushCloudDatabase(db);
        return;
      }
      if (process.env.NODE_ENV === "production") return;
      const fb = await import("@/lib/firebase/sync");
      if (fb.firebaseSyncEnabled()) fb.schedulePushCloudDatabase(db);
    })
    .catch(() => {
      /* ignore */
    });
}

/** Replace local DB from cloud snapshot (Supabase / Firebase live sync). */
export function replaceDbFromCloud(db: AppDatabase): void {
  if (!canUseStorage()) return;
  let next = db;
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const current = JSON.parse(raw) as AppDatabase;
      const incomingN = (next.products ?? []).length;
      const currentN = (current.products ?? []).length;
      // A dealer login / stale public pull must not wipe the live catalog.
      if (incomingN === 0 && currentN > 0) {
        next = {
          ...next,
          products: current.products,
          categories: next.categories?.length
            ? next.categories
            : current.categories,
        };
      }
    }
  } catch {
    /* keep incoming */
  }
  const json = JSON.stringify(next);
  // Skip identical writes — avoids full-app re-render flash on every poll
  if (localStorage.getItem(DB_KEY) === json) return;
  localStorage.setItem(DB_KEY, json);
  window.dispatchEvent(new Event("tt-db-updated"));
  // Drop stale cart lines after catalog wipe / product delete
  pruneCartAgainstDb(next);
}

export function resetDb(): AppDatabase {
  const db = emptyDb();
  saveDb(db);
  return db;
}

/**
 * Clear orders / users / wallets / vouchers for beta reset.
 * Keeps products + stock fields, catalog config, and one admin phone.
 * Flushes to cloud when sync is on.
 */
export async function purgeOpsDataAndSync(
  keepPhone: string
): Promise<{
  ok: boolean;
  error?: string;
  removedUsers?: number;
  removedOrders?: number;
  keptProducts?: number;
}> {
  const { purgeOpsDataKeepCatalog } = await import("@/lib/purge-ops");
  const current = loadDb();
  const { db: next, result } = purgeOpsDataKeepCatalog(current, keepPhone, {
    clearCatalog: false,
    keepAllOwners: true,
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  // Write without waiting for debounce
  if (!canUseStorage()) {
    return { ok: false, error: "No browser storage" };
  }
  localStorage.setItem(DB_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("tt-db-updated"));
  try {
    const m = await import("@/lib/supabase/sync");
    if (m.supabaseSyncEnabled() || (await m.detectSupabaseSync())) {
      const pushed = await m.flushPushCloudDatabase(loadDb());
      if (!pushed) {
        return {
          ok: false,
          error:
            "Local cleared but cloud push failed — stay logged in as owner and retry",
          removedUsers: result.removedUsers,
          removedOrders: result.removedOrders,
          keptProducts: result.keptProducts,
        };
      }
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Cloud sync failed",
      removedUsers: result.removedUsers,
      removedOrders: result.removedOrders,
      keptProducts: result.keptProducts,
    };
  }
  return {
    ok: true,
    removedUsers: result.removedUsers,
    removedOrders: result.removedOrders,
    keptProducts: result.keptProducts,
  };
}

/** Clear orders only (keep users + product stock). Bumps opsPurgeAt. */
export async function clearOrderHistoryAndSync(): Promise<{
  ok: boolean;
  error?: string;
  removedOrders?: number;
  keptProducts?: number;
}> {
  const { clearOrderHistoryKeepUsers } = await import("@/lib/purge-ops");
  const current = loadDb();
  const { db: next, result } = clearOrderHistoryKeepUsers(current);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  if (!canUseStorage()) {
    return { ok: false, error: "No browser storage" };
  }
  localStorage.setItem(DB_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("tt-db-updated"));
  try {
    const m = await import("@/lib/supabase/sync");
    if (m.supabaseSyncEnabled() || (await m.detectSupabaseSync())) {
      const pushed = await m.flushPushCloudDatabase(loadDb());
      if (!pushed) {
        return {
          ok: false,
          error:
            "Local cleared but cloud push failed — stay logged in as owner and retry",
          removedOrders: result.removedOrders,
          keptProducts: result.keptProducts,
        };
      }
    }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Cloud sync failed",
      removedOrders: result.removedOrders,
      keptProducts: result.keptProducts,
    };
  }
  return {
    ok: true,
    removedOrders: result.removedOrders,
    keptProducts: result.keptProducts,
  };
}

export function getSession(): SessionUser | null {
  if (!canUseStorage()) return null;
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SessionUser;
  } catch {
    return null;
  }
}

export function setSession(user: SessionUser | null): void {
  if (!canUseStorage()) return;
  if (!user) localStorage.removeItem(SESSION_KEY);
  else localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event("tt-session-updated"));
}

/** Ignore an in-flight session GET that finished after login/logout. */
let sessionSyncGen = 0;

export function bumpSessionSync(): void {
  sessionSyncGen += 1;
}

/**
 * Cookie + cloud are source of truth. Clears leftover localStorage when the
 * account was deleted so home does not stay "logged in" with an empty shop.
 */
export async function syncSessionFromServer(): Promise<SessionUser | null> {
  const gen = sessionSyncGen;
  try {
    const res = await fetch("/api/account/login", {
      credentials: "include",
      cache: "no-store",
    });
    const data = (await res.json().catch(() => ({}))) as {
      user?: SessionUser | null;
      error?: string;
    };
    if (gen !== sessionSyncGen) return getSession();
    if (res.ok && data.user) {
      const cur = getSession();
      if (
        !cur ||
        cur.id !== data.user.id ||
        cur.role !== data.user.role ||
        cur.name !== data.user.name
      ) {
        setSession(data.user);
      }
      return data.user;
    }
    if (res.status === 401) {
      if (shouldRetrySessionCookieCheck(res.status, data.error, Boolean(getSession()))) {
        await new Promise((r) => setTimeout(r, 300));
        if (gen !== sessionSyncGen) return getSession();
        const retry = await fetch("/api/account/login", {
          credentials: "include",
          cache: "no-store",
        });
        const retryData = (await retry.json().catch(() => ({}))) as {
          user?: SessionUser | null;
          error?: string;
        };
        if (gen !== sessionSyncGen) return getSession();
        if (retry.ok && retryData.user) {
          setSession(retryData.user);
          return retryData.user;
        }
        if (retry.status === 401 && (retryData.error || getSession())) {
          setSession(null);
          return null;
        }
        return getSession();
      }
      // Deleted / disabled account: always drop leftover local session.
      // Missing cookie (no error): also drop leftover local session so the
      // login form is visible — in-flight GETs after login are ignored via gen.
      if (data.error || getSession()) setSession(null);
      return null;
    }
  } catch {
    /* keep local session if the network failed */
  }
  return getSession();
}

export function getCart(): CartItem[] {
  if (!canUseStorage()) return [];
  const raw = localStorage.getItem(CART_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as CartItem[];
  } catch {
    return [];
  }
}

/** Drop cart lines whose product/variation no longer exists (e.g. after wipe). */
export function pruneCartAgainstDb(db: AppDatabase = loadDb()): CartItem[] {
  const items = getCart();
  const products = db.products ?? [];
  const next = items.filter((item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product || product.active === false) return false;
    if (item.variationId) {
      return (product.variations ?? []).some((v) => v.id === item.variationId);
    }
    return true;
  });
  if (next.length !== items.length) saveCart(next);
  return next;
}

export function saveCart(items: CartItem[]): void {
  if (!canUseStorage()) return;
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("tt-cart-updated"));
}

export function hasCapability(
  role: UserRole,
  capability: Capability
): boolean {
  return ROLE_CAPABILITIES[role]?.includes(capability) ?? false;
}

/** Prefer this when the full user profile is available (honours extra/denied/jobs). */
export {
  userHasCapability,
  effectiveCapabilities,
  isSalesDeskOnly,
  SALES_DESK_HREFS,
} from "../capabilities";

/**
 * Resolve capability from live user row when present; else fall back to
 * session cookie role (covers brief window before db hydrate).
 */
export function checkCapability(
  session: { id: string; role: UserRole } | null | undefined,
  source:
    | {
        users?: UserProfile[] | null;
        rolePresets?: RolePresets | null;
        staffJobs?: StaffJob[] | null;
      }
    | UserProfile[]
    | null
    | undefined,
  capability: Capability
): boolean {
  if (!session) return false;
  const users = Array.isArray(source) ? source : source?.users;
  const ctx = Array.isArray(source)
    ? undefined
    : capabilityContextFrom(source);
  const actor = users?.find((u) => u.id === session.id);
  if (actor) return userHasCapability(actor, capability, ctx);
  return hasCapability(session.role, capability);
}

export function isSalesDeskStaff(
  session: { id: string; role: UserRole } | null | undefined,
  source:
    | {
        users?: UserProfile[] | null;
        rolePresets?: RolePresets | null;
        staffJobs?: StaffJob[] | null;
      }
    | UserProfile[]
    | null
    | undefined
): boolean {
  if (!session || session.role !== "sales") return false;
  const users = Array.isArray(source) ? source : source?.users;
  const ctx = Array.isArray(source) ? undefined : capabilityContextFrom(source);
  const actor = users?.find((u) => u.id === session.id);
  if (actor) return isSalesDeskOnly(actor, ctx);
  return true;
}

export function checkAnyCapability(
  session: { id: string; role: UserRole } | null | undefined,
  source:
    | {
        users?: UserProfile[] | null;
        rolePresets?: RolePresets | null;
        staffJobs?: StaffJob[] | null;
      }
    | UserProfile[]
    | null
    | undefined,
  capabilities: Capability[]
): boolean {
  return capabilities.some((c) => checkCapability(session, source, c));
}

/** Owner-only financials (P/L, BS, purchase rates, owner panel) */
export function canViewFinancials(role: UserRole): boolean {
  return hasCapability(role, "view_financials");
}

function actorCan(
  actor: UserProfile | undefined | null,
  capability: Capability,
  db: AppDatabase
): boolean {
  return userHasCapability(actor, capability, capabilityContextFrom(db));
}

/** Owner (`view_financials`) writes live; missing session keeps tests writing live. */
function actorWritesLiveCatalog(db: AppDatabase): boolean {
  const session = getSession();
  if (!session) return true;
  const actor = db.users.find((u) => u.id === session.id);
  if (actor) {
    return userHasCapability(actor, "view_financials", capabilityContextFrom(db));
  }
  return hasCapability(session.role, "view_financials");
}

function sessionActorMeta(db: AppDatabase): { id: string; name: string } {
  const session = getSession();
  if (!session) return { id: "system", name: "System" };
  const actor = db.users.find((u) => u.id === session.id);
  return { id: session.id, name: actor?.name || session.name || session.id };
}

function notifyOwnerApprovalQueued(db: AppDatabase, title: string): void {
  if (typeof window === "undefined") return;
  const company = db.settings?.companyName || "TT Enterprises";
  const text = `*${company}*\nOwner approval needed\n${title}\n/admin/owner/approvals`;
  void (async () => {
    try {
      const { notifyStaffPush } = await import("@/lib/push-client");
      await notifyStaffPush({
        title: "Owner approval",
        body: title,
        url: "/en/admin/owner/approvals",
      });
    } catch {
      /* best-effort */
    }
    try {
      const { notifyStaffWhatsApp } = await import("@/lib/whatsapp");
      await notifyStaffWhatsApp({
        settings: db.settings,
        users: db.users,
        capability: "view_financials",
        capabilityContext: capabilityContextFrom(db),
        text,
      });
    } catch {
      /* best-effort */
    }
  })();
}

/** Create or update the Accounts party linked to a dealer/customer user. */
function ensureCustomerParty(db: AppDatabase, user: UserProfile): Party {
  const name = (user.company?.trim() || user.name).trim();
  let party = db.parties.find(
    (p) => p.linkedUserId === user.id && p.type === "customer"
  );
  if (party) {
    party.name = name;
    party.phone = user.phone;
    party.address = user.address;
    party.pincode = user.pincode;
    party.gstin = user.gstOrAadhar;
    party.active = user.active;
    return party;
  }
  party = {
    id: `party_${crypto.randomUUID()}`,
    name,
    phone: user.phone,
    type: "customer",
    linkedUserId: user.id,
    openingBalance: 0,
    address: user.address,
    pincode: user.pincode,
    gstin: user.gstOrAadhar,
    active: user.active,
    createdAt: new Date().toISOString(),
  };
  db.parties.push(party);
  return party;
}

export function isStaff(role: UserRole): boolean {
  return role !== "customer";
}

async function readResponseJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(
      `Server returned an empty reply (${res.status}). Try again.`
    );
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Server error (${res.status}). Try again.`);
  }
}

export function login(phone: string, password: string): SessionUser {
  const db = loadDb();
  const user = db.users.find((u) => phonesMatch(u.phone, phone));
  if (!user || user.passwordHash !== hashPassword(password)) {
    throw new Error("Invalid phone or password");
  }
  if (!user.active) {
    throw new Error("Account is disabled. Contact admin.");
  }
  if (user.role === "customer" && user.approved !== true) {
    throw new Error(
      "Awaiting admin approval. You can login after T T Enterprises approves your account."
    );
  }
  const session: SessionUser = {
    id: user.id,
    phone: user.phone,
    email: user.email,
    name: user.name,
    role: user.role,
    locale: user.locale,
  };
  setSession(session);
  return session;
}

/** Prefer server cookie session. No weak offline fallback when cloud is on. */
export async function loginAsync(
  phone: string,
  password: string
): Promise<SessionUser> {
  bumpSessionSync();
  const { isSupabaseConfigured, isSupabaseBrowserConfigured } = await import(
    "@/lib/supabase/config"
  );
  const cloudOn =
    Boolean(process.env.NEXT_PUBLIC_DB_API_KEY) ||
    isSupabaseConfigured() ||
    isSupabaseBrowserConfigured();

  try {
    const res = await fetch("/api/account/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, password }),
    });
    const data = await readResponseJson<{
      user?: SessionUser;
      error?: string;
    }>(res);
    if (res.ok && data.user) {
      // Cookie from POST must be stored before /api/db, or a public/empty
      // pull leaves a new dealer with no catalog or rate list.
      await new Promise((r) => window.setTimeout(r, 0));
      try {
        const sb = await import("@/lib/supabase/sync");
        if (sb.supabaseSyncEnabled() || (await sb.detectSupabaseSync())) {
          let remote = await sb.pullCloudDatabase(loadDb());
          if (!remote?.products?.some((p) => p.active !== false)) {
            await new Promise((r) => window.setTimeout(r, 150));
            remote = await sb.pullCloudDatabase(loadDb());
          }
          if (remote) replaceDbFromCloud(remote);
        }
      } catch {
        /* ignore — still allow login with cookie */
      }
      setSession(data.user);
      bumpSessionSync();
      return data.user;
    }
    if (res.status === 503 && !cloudOn) {
      return login(phone, password);
    }
    throw new Error(data.error || "Login failed");
  } catch (err) {
    if (err instanceof Error && err.message !== "Failed to fetch") {
      if (
        err.message.includes("Invalid") ||
        err.message.includes("Awaiting") ||
        err.message.includes("disabled") ||
        err.message.includes("Too many") ||
        err.message.includes("Login failed")
      ) {
        throw err;
      }
    }
    // Never fall back to local demo_ hashes when Supabase is the source of truth
    if (cloudOn || process.env.NODE_ENV === "production") {
      throw err instanceof Error
        ? err
        : new Error("Login unavailable — check your connection");
    }
    return login(phone, password);
  }
}

export async function registerCustomer(input: {
  name: string;
  password: string;
  phone: string;
  company?: string;
  address?: string;
  pincode?: string;
  gstOrAadhar?: string;
  transport?: string;
  locale?: Locale;
}): Promise<{ pendingApproval: true }> {
  const phone = normalizePhone(input.phone);
  if (phone.length < 10) {
    throw new Error("Enter a valid 10-digit mobile number");
  }
  const pincode = (input.pincode || "").replace(/\D/g, "").slice(0, 6);
  if (pincode.length !== 6) {
    throw new Error("Enter a valid 6-digit pincode");
  }

  const res = await fetch("/api/account/register", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name.trim(),
      password: input.password,
      phone,
      company: input.company?.trim(),
      address: input.address?.trim(),
      pincode,
      gstOrAadhar: input.gstOrAadhar?.trim(),
      transport: input.transport?.trim(),
      locale: input.locale,
    }),
  });
  const data = await readResponseJson<{
    error?: string;
    pendingApproval?: boolean;
  }>(res);
  if (!res.ok) {
    throw new Error(data.error || "Registration failed");
  }
  return { pendingApproval: true };
}

export function mergeCloudCustomerDirectory(
  rows: Array<{
    id: string;
    name: string;
    phone: string;
    company?: string;
    address?: string;
    pincode?: string;
    gstOrAadhar?: string;
    transport?: string;
    locale?: "en" | "hi";
    createdAt: string;
    approved: boolean;
    active: boolean;
    walletBalance?: number;
    liftingProgressKg?: number;
    revokedAt?: string;
    revokedBy?: string;
    revokedReason?: string;
  }>
): boolean {
  const db = loadDb();
  const tombs = tombsFromDb(db);
  let changed = false;
  const cloudIds = new Set(rows.map((r) => r.id));
  const now = Date.now();
  const kept = (db.users ?? []).filter((u) => {
    if (!userBeatsTomb(u, tombs)) {
      changed = true;
      return false;
    }
    if (u.role !== "customer") return true;
    if (cloudIds.has(u.id)) return true;
    // Cloud list is complete. Drop local leftovers unless this device just
    // created them (in-flight admin-create before the next poll).
    const created = Date.parse(u.createdAt || "");
    if (
      Number.isFinite(created) &&
      now - created < 120_000 &&
      u.passwordHash
    ) {
      return true;
    }
    changed = true;
    return false;
  });
  if (kept.length !== (db.users ?? []).length) {
    db.users = kept;
    changed = true;
  }
  if (!rows.length) {
    if (changed) saveDb(db, { skipCloudPush: true });
    return changed;
  }
  const byId = new Map((db.users ?? []).map((u) => [u.id, u] as const));
  for (const row of rows) {
    if (!userBeatsTomb({ id: row.id, createdAt: row.createdAt }, tombs)) {
      continue;
    }
    const cur = byId.get(row.id);
    const approved = row.approved === true;
    const active = row.active !== false;
    if (cur) {
      if (cur.role !== "customer") continue;
      if (
        cur.approved !== approved ||
        cur.active !== active ||
        cur.name !== row.name ||
        cur.phone !== row.phone ||
        (cur.company || "") !== (row.company || "") ||
        (cur.address || "") !== (row.address || "") ||
        (cur.pincode || "") !== (row.pincode || "") ||
        (cur.gstOrAadhar || "") !== (row.gstOrAadhar || "") ||
        (cur.transport || "") !== (row.transport || "") ||
        (cur.revokedAt || "") !== (row.revokedAt || "") ||
        (cur.revokedReason || "") !== (row.revokedReason || "")
      ) {
        cur.approved = approved;
        cur.active = active;
        cur.name = row.name;
        cur.phone = row.phone;
        cur.company = row.company;
        cur.address = row.address;
        cur.pincode = row.pincode;
        cur.gstOrAadhar = row.gstOrAadhar;
        cur.transport = row.transport;
        cur.revokedAt = row.revokedAt;
        cur.revokedBy = row.revokedBy;
        cur.revokedReason = row.revokedReason;
        changed = true;
      }
      continue;
    }
    db.users = [
      ...(db.users ?? []),
      {
        id: row.id,
        passwordHash: "",
        name: row.name,
        phone: row.phone,
        company: row.company,
        address: row.address,
        pincode: row.pincode,
        gstOrAadhar: row.gstOrAadhar,
        transport: row.transport,
        locale: row.locale === "hi" ? "hi" : "en",
        role: "customer",
        walletBalance: Number(row.walletBalance) || 0,
        assignedSchemeIds: [],
        liftingProgressKg: Number(row.liftingProgressKg) || 0,
        schemeProgress: {},
        active,
        approved,
        revokedAt: row.revokedAt,
        revokedBy: row.revokedBy,
        revokedReason: row.revokedReason,
        createdAt: row.createdAt,
      },
    ];
    byId.set(row.id, db.users[db.users.length - 1]);
    changed = true;
  }
  if (changed) saveDb(db, { skipCloudPush: true });
  return changed;
}

export function approveDealer(userId: string, byAdminId: string): void {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === byAdminId);
  if (!actor || !actorCan(actor, "approve_dealers", db)) {
    throw new Error("Only staff who can approve dealers may do this");
  }
  applyDealerFileActions(db, actor, { action: "approve", ids: [userId] });
  saveDb(db);
}

export function rejectDealer(userId: string, byAdminId: string): void {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === byAdminId);
  if (!actor || !actorCan(actor, "approve_dealers", db)) {
    throw new Error("Only staff who can approve dealers may do this");
  }
  applyDealerFileActions(db, actor, { action: "reject", ids: [userId] });
  saveDb(db);
}

/**
 * Revoke a user's access. Works for dealers and staff. Records who did it,
 * when, and why. The user cannot log in until `restoreUserAccess` is called.
 * If the user is currently logged in on other tabs, they will be dropped on
 * next `useSession` read (see AuthRedirect self-heal).
 */
export function revokeUserAccess(
  userId: string,
  byAdminId: string,
  reason?: string
): void {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === byAdminId);
  if (!actor) throw new Error("Only admins can revoke access");
  const user = db.users.find((u) => u.id === userId);
  if (!user) throw new Error("User not found");
  if (user.id === byAdminId) {
    throw new Error("You cannot revoke your own access");
  }
  if (user.role === "customer") {
    if (!actorCan(actor, "approve_dealers", db)) {
      throw new Error("Only staff who can manage dealers may do this");
    }
    applyDealerFileActions(db, actor, {
      action: "revoke",
      ids: [userId],
      reason,
    });
    saveDb(db);
    return;
  }
  if (!actorCan(actor, "manage_users", db)) {
    throw new Error("Only admins can revoke access");
  }
  if (user.role === "super_admin") {
    const otherOwner = db.users.some(
      (u) => u.id !== user.id && u.role === "super_admin" && u.active
    );
    if (!otherOwner) {
      throw new Error(
        "Cannot revoke the last owner — create another owner first"
      );
    }
  }
  user.active = false;
  user.revokedAt = new Date().toISOString();
  user.revokedBy = byAdminId;
  user.revokedReason = reason?.trim() || undefined;
  const party = db.parties.find(
    (p) => p.linkedUserId === user.id && p.type === "customer"
  );
  if (party) party.active = false;
  saveDb(db);
}

/** Re-enable a previously revoked user. */
export function restoreUserAccess(userId: string, byAdminId: string): void {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === byAdminId);
  if (!actor) throw new Error("Only admins can restore access");
  const user = db.users.find((u) => u.id === userId);
  if (!user) throw new Error("User not found");
  if (user.role === "customer") {
    if (!actorCan(actor, "approve_dealers", db)) {
      throw new Error("Only staff who can manage dealers may do this");
    }
    applyDealerFileActions(db, actor, { action: "restore", ids: [userId] });
    saveDb(db);
    return;
  }
  if (!actorCan(actor, "manage_users", db)) {
    throw new Error("Only admins can restore access");
  }
  user.active = true;
  user.revokedAt = undefined;
  user.revokedBy = undefined;
  user.revokedReason = undefined;
  saveDb(db);
}

/**
 * Delete a user permanently.
 * - Default: hard-delete if no history; otherwise revoke access (books kept).
 * - `force: true`: always remove the login profile. Orders / vouchers / wallet
 *   ledger stay as historical records; the party is unlinked (not erased).
 * Returns `"deleted"` | `"revoked"`.
 */
export function deleteUserAccount(
  userId: string,
  byAdminId: string,
  opts?: { force?: boolean }
): "deleted" | "revoked" {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === byAdminId);
  if (!actor || !actorCan(actor, "manage_users", db)) {
    throw new Error("Only admins can delete users");
  }
  const user = db.users.find((u) => u.id === userId);
  if (!user) {
    stampUserTomb(db, userId);
    saveDb(db);
    return "deleted";
  }
  if (user.id === byAdminId) throw new Error("You cannot delete your own account");
  if (user.role === "super_admin") {
    // Allow delete once another super_admin exists (checked by caller / UI).
    const otherOwner = db.users.some(
      (u) =>
        u.id !== user.id &&
        u.role === "super_admin" &&
        u.active
    );
    if (!otherOwner) {
      throw new Error(
        "Cannot delete the last owner — create another owner first"
      );
    }
  }

  const hasOrders = db.orders.some((o) => o.userId === userId);
  const hasWalletTxs = db.walletTransactions.some((t) => t.userId === userId);
  const linkedParty = db.parties.find((p) => p.linkedUserId === userId);
  const hasVouchers = linkedParty
    ? db.vouchers.some((v) => v.partyId === linkedParty.id)
    : false;
  const hasHistory = hasOrders || hasWalletTxs || hasVouchers;

  if (hasHistory && !opts?.force) {
    user.active = false;
    user.revokedAt = new Date().toISOString();
    user.revokedBy = byAdminId;
    user.revokedReason =
      user.revokedReason || "Removed by admin (history kept)";
    if (linkedParty) linkedParty.active = false;
    saveDb(db);
    return "revoked";
  }

  // Hard delete (clean or forced). Keep accounting rows; only drop the login.
  if (linkedParty) {
    linkedParty.linkedUserId = undefined;
    linkedParty.active = false;
  }
  db.users = db.users.filter((u) => u.id !== userId);
  stampUserTomb(db, userId);
  saveDb(db);
  return "deleted";
}

/** Cloud-first delete so Admin Users poll cannot put the login back. */
export async function deleteUserAccountAndSync(
  userId: string,
  byAdminId: string,
  opts?: { force?: boolean }
): Promise<"deleted" | "revoked"> {
  type DealerRow = {
    id: string;
    name: string;
    phone: string;
    company?: string;
    address?: string;
    pincode?: string;
    locale?: "en" | "hi";
    createdAt: string;
    approved: boolean;
    active: boolean;
    walletBalance?: number;
    liftingProgressKg?: number;
  };
  let cloudDealers: DealerRow[] | undefined;
  try {
    const res = await fetch("/api/account/delete-user", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    if (res.status !== 404 && res.status !== 405) {
      if (!res.ok) {
        let reason = "Delete failed";
        try {
          const data = (await res.json()) as { error?: string };
          if (data.error) reason = data.error;
        } catch {
          /* ignore */
        }
        throw new Error(reason);
      }
      try {
        const data = (await res.json()) as { dealers?: DealerRow[] };
        if (Array.isArray(data.dealers)) cloudDealers = data.dealers;
      } catch {
        /* local tomb still applied */
      }
    }
  } catch (err) {
    if (err instanceof TypeError) {
      /* offline — local tomb still hides the row */
    } else if (
      err instanceof Error &&
      (err.message === "Failed to fetch" || /network/i.test(err.message))
    ) {
      /* fall through to local */
    } else if (err instanceof Error) {
      throw err;
    }
  }
  let result: "deleted" | "revoked" = "deleted";
  try {
    result = deleteUserAccount(userId, byAdminId, opts);
  } catch (err) {
    if (err instanceof Error && err.message === "User not found") {
      const db = loadDb();
      stampUserTomb(db, userId);
      saveDb(db, { skipCloudPush: true });
      result = "deleted";
    } else {
      throw err;
    }
  }
  if (cloudDealers) {
    mergeCloudCustomerDirectory(cloudDealers);
  }
  try {
    const m = await import("@/lib/supabase/sync");
    if (m.supabaseSyncEnabled() || (await m.detectSupabaseSync())) {
      // Pull only — a full flush of stale localStorage was putting deleted
      // dealers back on cloud.
      const pulled = await m.pullCloudDatabase(loadDb());
      if (pulled) replaceDbFromCloud(pulled);
    }
  } catch {
    /* local tomb already saved */
  }
  return result;
}

/** Whether hard-delete is possible without force (no order / wallet / voucher links). */
export function userCanHardDelete(userId: string): boolean {
  const db = loadDb();
  if (db.orders.some((o) => o.userId === userId)) return false;
  if (db.walletTransactions.some((t) => t.userId === userId)) return false;
  const linkedParty = db.parties.find((p) => p.linkedUserId === userId);
  if (
    linkedParty &&
    db.vouchers.some((v) => v.partyId === linkedParty.id)
  ) {
    return false;
  }
  return true;
}

/** Counts used by the admin user-info panel. */
export function getUserHistorySummary(userId: string): {
  orders: number;
  walletTxs: number;
  vouchers: number;
  canHardDelete: boolean;
} {
  const db = loadDb();
  const linkedParty = db.parties.find((p) => p.linkedUserId === userId);
  const orders = db.orders.filter((o) => o.userId === userId).length;
  const walletTxs = db.walletTransactions.filter((t) => t.userId === userId)
    .length;
  const vouchers = linkedParty
    ? db.vouchers.filter((v) => v.partyId === linkedParty.id).length
    : 0;
  return {
    orders,
    walletTxs,
    vouchers,
    canHardDelete: orders === 0 && walletTxs === 0 && vouchers === 0,
  };
}

export function updateCustomerProfile(
  userId: string,
  patch: Partial<
    Pick<
      UserProfile,
      | "name"
      | "phone"
      | "address"
      | "pincode"
      | "gstOrAadhar"
      | "transport"
      | "company"
    >
  >
): void {
  const db = loadDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) throw new Error("User not found");
  const nextPhone =
    patch.phone !== undefined ? patch.phone.trim() : user.phone;
  if (nextPhone && nextPhone !== user.phone) {
    const clash = db.users.find(
      (u) => u.id !== user.id && phonesMatch(u.phone, nextPhone)
    );
    if (clash) throw new Error("Phone number already registered to another account");
  }
  const pincode =
    patch.pincode !== undefined
      ? patch.pincode.replace(/\D/g, "").slice(0, 6)
      : user.pincode;
  Object.assign(user, {
    name: patch.name?.trim() ?? user.name,
    phone: nextPhone,
    address: patch.address?.trim() ?? user.address,
    pincode,
    gstOrAadhar: patch.gstOrAadhar?.trim() ?? user.gstOrAadhar,
    transport: patch.transport?.trim() ?? user.transport,
    company: patch.company?.trim() ?? user.company,
  });
  if (user.role === "customer") ensureCustomerParty(db, user);
  saveDb(db);
}

export function logout(): void {
  bumpSessionSync();
  setSession(null);
  if (typeof window !== "undefined") {
    void fetch("/api/account/login", { method: "DELETE" }).catch(
      () => undefined
    );
  }
}

/**
 * Weight / rule / jhal shipping — shared with server (`@/lib/shipping`).
 */
export function calcShipping(
  db: AppDatabase,
  subtotal: number,
  totalWeightKg: number,
  jhalQty = 0
): number {
  return calcShippingAmount({
    settings: db.settings,
    shippingRules: db.shippingRules,
    subtotal,
    totalWeightKg,
    jhalQty,
  });
}

/** Jhals on order lines (product.unit === "jhal" → qty/quantity). */
export function countOrderJhals(
  lines: { productId?: string; quantity?: number; qty?: number; unit?: string }[],
  products: { id: string; unit: string }[]
): number {
  let n = 0;
  for (const l of lines) {
    const unit =
      l.unit || products.find((p) => p.id === l.productId)?.unit || "";
    if (unit !== "jhal") continue;
    n += Number(l.quantity ?? l.qty ?? 0) || 0;
  }
  return n;
}

/** Weight used for kg/pcs shipping (excludes jhal lines). */
export function shippingWeightExcludingJhal(
  lines: {
    productId?: string;
    weightKg?: number;
    unit?: string;
  }[],
  products: { id: string; unit: string }[]
): number {
  let w = 0;
  for (const l of lines) {
    const unit =
      l.unit || products.find((p) => p.id === l.productId)?.unit || "";
    if (unit === "jhal") continue;
    w += Number(l.weightKg ?? 0) || 0;
  }
  return Math.round(w * 100) / 100;
}

export function canRequestFullTruck(
  db: AppDatabase,
  subtotal: number,
  totalWeightKg: number
): boolean {
  const s = db.settings;
  return (
    totalWeightKg >= s.fullTruckMinWeightKg ||
    subtotal >= s.fullTruckMinValue
  );
}

function stampOrderBillDiscount(
  order: Order,
  db: AppDatabase,
  goodsSubtotal: number,
  at = new Date()
): void {
  const user = db.users.find((u) => u.id === order.userId);
  const billedOnly = order.lines.some(
    (l) => l.actualWeightKg != null && l.actualWeightKg > 0
  );
  const qtyOpts = billedOnly ? { billedOnly: true } : undefined;
  const best = user
    ? pickBestOrderDiscount(
        db.schemes,
        user.assignedSchemeIds,
        order.lines,
        db.products,
        at,
        qtyOpts
      )
    : null;
  const applied = applyBillDiscounts({
    goodsSubtotal,
    schemeAmount: best?.amount ?? 0,
    manualKind: order.manualDiscountKind,
    manualValue: order.manualDiscountValue,
  });
  order.schemeDiscount = applied.total > 0 ? applied.total : undefined;
  order.schemeDiscountId = best?.scheme.id;
  order.schemeDiscountLabel =
    applied.total > 0
      ? billDiscountReceiptLabel(
          best,
          applied,
          order.manualDiscountKind,
          order.manualDiscountValue,
          "en"
        )
      : undefined;
  const billedQty = best
    ? orderDiscountMathQty(best.scheme, order.lines, db.products, qtyOpts)
    : 0;
  order.schemeDiscountMath =
    applied.schemeAmount > 0
      ? orderDiscountMathLabel(best, billedQty, "en")
      : undefined;
}

export function createEstimateOrder(input: {
  userId: string;
  cart: CartItem[];
  deliveryAddress: string;
  customerNotes?: string;
  checkoutName: string;
  gstOrAadhar?: string;
  phone: string;
  transport?: string;
  walletToUse: number;
  fullTruckRequested: boolean;
  manualDiscountKind?: "percent" | "flat";
  manualDiscountValue?: number;
  locale?: "en" | "hi";
  punchedById?: string;
  punchedByName?: string;
}): Order {
  const db = loadDb();
  pruneCartAgainstDb(db);
  const order = placeEstimateOnDatabase(db, {
    ...input,
    allowManualDiscount: true,
    enforceDealerApproval: false,
    locale: input.locale === "hi" ? "hi" : "en",
  });
  saveDb(db);
  saveCart([]);
  return order;
}

function withPlacedOrder(db: AppDatabase, order: Order): AppDatabase {
  if ((db.orders ?? []).some((o) => o.id === order.id)) return db;
  return { ...db, orders: [order, ...(db.orders ?? [])] };
}

function cartSkuStock(
  db: AppDatabase,
  cart: { productId: string; variationId?: string; colorId?: string; quantity?: number }[]
) {
  return (cart ?? []).slice(0, 4).map((item) => {
    const p = db.products.find((x) => x.id === item.productId);
    const key = `${item.variationId || ""}__${item.colorId || ""}`;
    return {
      pid: item.productId,
      key,
      qty: item.quantity ?? 0,
      stock: p?.stock ?? null,
      cell: p?.stockMatrix ? p.stockMatrix[key] ?? null : null,
    };
  });
}

/** Place estimate on cloud first so admin localStorage cannot wipe it. */
export async function createEstimateOrderAndSync(
  input: Parameters<typeof createEstimateOrder>[0] & { locale?: "en" | "hi" }
): Promise<Order> {
  const stockBefore = cartSkuStock(loadDb(), input.cart);
  try {
    const res = await fetch("/api/orders/estimate", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: input.userId,
        cart: input.cart,
        deliveryAddress: input.deliveryAddress,
        customerNotes: input.customerNotes,
        checkoutName: input.checkoutName,
        gstOrAadhar: input.gstOrAadhar,
        phone: input.phone,
        transport: input.transport,
        walletToUse: input.walletToUse,
        fullTruckRequested: input.fullTruckRequested,
        locale: input.locale || "en",
        manualDiscountKind: input.manualDiscountKind,
        manualDiscountValue: input.manualDiscountValue,
        punchedById: input.punchedById,
        punchedByName: input.punchedByName,
      }),
    });
    if (res.ok) {
      const data = (await res.json()) as { order?: Order; waSent?: boolean };
      if (data.order?.id) {
        saveCart([]);
        let next = withPlacedOrder(loadDb(), data.order);
        try {
          const m = await import("@/lib/supabase/sync");
          if (m.supabaseSyncEnabled() || (await m.detectSupabaseSync())) {
            const pulled = await m.pullCloudDatabase(next);
            if (pulled) next = withPlacedOrder(pulled, data.order);
          }
        } catch {
          /* keep the order the API just created */
        }
        replaceDbFromCloud(next);
        if (data.order.stockReserved) {
          const afterPull = cartSkuStock(loadDb(), input.cart);
          const dropped = stockBefore.some((b, i) => {
            const a = afterPull[i];
            if (!a) return false;
            if (b.cell != null && a.cell != null) return a.cell < b.cell;
            if (b.stock != null && a.stock != null) return a.stock < b.stock;
            return false;
          });
          if (!dropped) {
            try {
              const db = loadDb();
              applyOrderEstimateStock(db, data.order, input.userId, "reserve");
              replaceDbFromCloud(db);
            } catch {
              /* cloud still holds the reserve; next pull will match */
            }
          }
        }
        return data.order;
      }
    }
    if (res.status === 404 || res.status === 405) {
      /* old deploy without this route — fall through */
    } else {
      let reason = "Could not place order";
      try {
        const errBody = (await res.json()) as { error?: string };
        if (errBody.error) reason = errBody.error;
      } catch {
        /* ignore */
      }
      if (res.status === 401 || res.status === 403) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("tt-session-expired", { detail: reason })
          );
        }
      }
      throw new Error(reason);
    }
  } catch (err) {
    if (err instanceof TypeError) {
      /* network — fall through to local + push */
    } else if (
      err instanceof Error &&
      (err.message === "Failed to fetch" || /network/i.test(err.message))
    ) {
      /* fall through */
    } else {
      throw err;
    }
  }

  const order = createEstimateOrder(input);
  let pushed = false;
  try {
    const m = await import("@/lib/supabase/sync");
    if (m.supabaseSyncEnabled() || (await m.detectSupabaseSync())) {
      pushed = await m.flushPushCloudDatabase(loadDb());
    }
  } catch {
    /* local order still exists */
  }
  if (!pushed) {
    try {
      const wa = await import("@/lib/whatsapp");
      const db = loadDb();
        await wa.notifyStaffNewOrder({
        order,
        settings: db.settings,
        users: db.users,
        locale: input.locale || "en",
      });
      await pingStaffCreditLimitWhatsApp(order, input.locale || "en");
      if (input.punchedById) {
        try {
          await fetch("/api/whatsapp/notify-order", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderId: order.id,
              status: "estimate",
              locale: input.locale || "en",
            }),
          });
        } catch {
          /* dealer WhatsApp is best-effort on offline punch */
        }
      }
    } catch {
      /* notify is best-effort */
    }
  }
  return order;
}

/**
 * Admin-side "punch order" — creates an order on behalf of a dealer.
 * Optionally bills it immediately for walk-in / phone orders.
 *
 * The order is attributed to the dealer's `userId`; the timeline records the
 * admin who punched it. Wallet is only applied when explicitly requested.
 */
export function adminPunchOrder(input: {
  adminId: string;
  dealerId: string;
  cart: CartItem[];
  deliveryAddress?: string;
  customerNotes?: string;
  checkoutName?: string;
  gstOrAadhar?: string;
  phone?: string;
  transport?: string;
  walletToUse?: number;
  fullTruckRequested?: boolean;
  manualDiscountKind?: "percent" | "flat";
  manualDiscountValue?: number;
  /** If provided, the order is billed in the same step. */
  billNow?: {
    actualBillAmount: number;
    lineActualWeights: number[];
    billFileDataUrl?: string;
  };
}): Order {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === input.adminId);
  if (!actor || !actorCan(actor, "manage_orders", db)) {
    throw new Error("Only staff can punch orders on behalf of a dealer");
  }
  const dealer = db.users.find((u) => u.id === input.dealerId);
  if (!dealer) throw new Error("Dealer not found");
  if (dealer.role !== "customer") {
    throw new Error("Orders can only be punched for dealer accounts");
  }
  if (!dealer.active) {
    throw new Error("Dealer's access is revoked — restore access before punching");
  }
  if (dealer.approved !== true) {
    throw new Error("Dealer is not yet approved — approve before punching orders");
  }

  const order = createEstimateOrder({
    userId: dealer.id,
    cart: input.cart,
    deliveryAddress: input.deliveryAddress?.trim() || dealer.address || "",
    customerNotes: input.customerNotes,
    checkoutName: (input.checkoutName?.trim() || dealer.name || "").trim(),
    gstOrAadhar: input.gstOrAadhar?.trim() || dealer.gstOrAadhar,
    phone: (input.phone?.trim() || dealer.phone || "").trim(),
    transport: input.transport?.trim() || dealer.transport,
    walletToUse: Math.max(0, input.walletToUse || 0),
    fullTruckRequested: !!input.fullTruckRequested,
    manualDiscountKind: input.manualDiscountKind,
    manualDiscountValue: input.manualDiscountValue,
    punchedById: actor.id,
    punchedByName: actor.name,
  });

  const punchDb = loadDb();
  const punchOrder = punchDb.orders.find((o) => o.id === order.id);
  if (punchOrder && !punchOrder.punchedBy) {
    punchOrder.source = "staff";
    punchOrder.punchedBy = actor.id;
    punchOrder.timeline.push({
      status: punchOrder.status,
      at: new Date().toISOString(),
      note: `Punched in by ${actor.name} (admin)`,
    });
    saveDb(punchDb);
  }

  if (input.billNow) {
    const billed = uploadBill(
      order.id,
      input.billNow.actualBillAmount,
      input.billNow.billFileDataUrl,
      input.billNow.lineActualWeights,
      input.adminId
    );
    return billed;
  }
  return loadDb().orders.find((o) => o.id === order.id) || order;
}

/** Punch order via the same cloud path as dealer checkout, then optional bill. */
export async function adminPunchOrderAndSync(
  input: Parameters<typeof adminPunchOrder>[0] & { locale?: "en" | "hi" }
): Promise<Order> {
  const db0 = loadDb();
  const actor = db0.users.find((u) => u.id === input.adminId);
  const dealer = db0.users.find((u) => u.id === input.dealerId);
  const estimateInput = {
    userId: input.dealerId,
    cart: input.cart,
    deliveryAddress:
      input.deliveryAddress?.trim() || dealer?.address || "",
    customerNotes: input.customerNotes,
    checkoutName: (input.checkoutName?.trim() || dealer?.name || "").trim(),
    gstOrAadhar: input.gstOrAadhar?.trim() || dealer?.gstOrAadhar,
    phone: (input.phone?.trim() || dealer?.phone || "").trim(),
    transport: input.transport?.trim() || dealer?.transport,
    walletToUse: Math.max(0, input.walletToUse || 0),
    fullTruckRequested: !!input.fullTruckRequested,
    manualDiscountKind: input.manualDiscountKind,
    manualDiscountValue: input.manualDiscountValue,
    locale: input.locale,
    punchedById: actor?.id,
    punchedByName: actor?.name,
  };

  let order: Order;
  try {
    order = await createEstimateOrderAndSync(estimateInput);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (
      msg &&
      !/failed to fetch|network|cloud unavailable/i.test(msg)
    ) {
      throw err;
    }
    order = adminPunchOrder(input);
  }

  if (input.billNow) {
    const billed = uploadBill(
      order.id,
      input.billNow.actualBillAmount,
      input.billNow.billFileDataUrl,
      input.billNow.lineActualWeights,
      input.adminId
    );
    try {
      const m = await import("@/lib/supabase/sync");
      if (m.supabaseSyncEnabled() || (await m.detectSupabaseSync())) {
        await m.flushPushCloudDatabase(loadDb());
      }
    } catch {
      /* billed locally */
    }
    return billed;
  }
  return loadDb().orders.find((o) => o.id === order.id) || order;
}

async function pingStaffCreditLimitWhatsApp(
  order: Order,
  locale: "en" | "hi",
  skipUserIds?: string[]
): Promise<void> {
  const wa = await import("@/lib/whatsapp");
  const db = loadDb();
  const party = db.parties.find(
    (p) => p.linkedUserId === order.userId && p.type === "customer"
  );
  if (!party?.creditLimit) return;
  const recv = partyBalance(party, db.ledgerEntries);
  const billed =
    order.actualBillAmount != null && order.status !== "estimate";
  const add = billed ? 0 : order.estimatedTotal || 0;
  const check = creditLimitBreach(party, recv, add);
  if (check.ok) return;
  await wa.notifyStaffCreditLimit({
    settings: db.settings,
    users: db.users,
    locale,
    partyName: party.name,
    creditLimit: party.creditLimit,
    receivable: billed ? recv : recv + add,
    overBy: check.overBy,
    orderNumber: order.orderNumber,
    skipUserIds,
  });
}

type SettleResult = { credited: number; changed: boolean };

/**
 * Single wallet credit after scheme end:
 * full lift × highest unlocked tier rate (not band-by-band).
 * Idempotent — adjusts wallet up or down if progress changes after settle.
 */
function settleSchemePayoutForUser(
  db: AppDatabase,
  user: UserProfile,
  scheme: Scheme,
  now: string
): SettleResult {
  if (isOrderDiscountScheme(scheme)) return { credited: 0, changed: false };
  if (!isSchemeEnded(scheme, new Date(now))) return { credited: 0, changed: false };
  if (!dealerHasScheme(scheme, user.assignedSchemeIds)) return { credited: 0, changed: false };
  if (!user.schemeProgress) user.schemeProgress = {};

  const progress = user.schemeProgress[scheme.id] ?? 0;
  const salesValue = user.schemeValueProgress?.[scheme.id] ?? 0;
  const expected = estimateSchemePayout(scheme, progress, salesValue);
  const paid = netSchemeSettlement(db.walletTransactions, user.id, scheme.id);
  const delta = roundMoney(expected - paid);
  if (Math.abs(delta) < 0.01) return { credited: 0, changed: false };

  const tier = getAchievedTier(scheme, progress);
  const unit = schemeUnitLabel(scheme, "en");
  const tierName = tier ? schemeLevelLabel(tier, "en") : "—";
  const reason =
    isPercentScheme(scheme) && tier
      ? `Congratulations! ${scheme.name.en} ended · ${tierName} @ ${schemeTierPercent(scheme, tier)}% of ₹${salesValue.toFixed(0)} sales`
      : `Congratulations! ${scheme.name.en} ended · ${tierName} @ ₹${tier ? schemeTierRate(scheme, tier) : 0}/${unit} × ${progress.toFixed(0)} ${unit}`;

  if (delta > 0) {
    user.walletBalance = roundMoney((user.walletBalance || 0) + delta);
    db.walletTransactions.push({
      id: `wt_${crypto.randomUUID()}`,
      userId: user.id,
      type: "credit",
      amount: delta,
      reason,
      schemeId: scheme.id,
      schemeSettlement: true,
      schemeLevelId: tier?.id,
      createdAt: now,
      createdBy: "system",
    });
    return { credited: delta, changed: true };
  }

  const debit = Math.abs(delta);
  user.walletBalance = roundMoney(
    Math.max(0, (user.walletBalance || 0) - debit)
  );
  db.walletTransactions.push({
    id: `wt_${crypto.randomUUID()}`,
    userId: user.id,
    type: "debit",
    amount: debit,
    reason: `Scheme payout adjusted · ${scheme.name.en}`,
    schemeId: scheme.id,
    schemeSettlement: true,
    schemeLevelId: tier?.id,
    createdAt: now,
    createdBy: "system",
  });
  return { credited: 0, changed: true };
}

/** Settle all ended schemes for one user (mutates db, doesn't save). */
function settleEndedSchemesForUser(
  db: AppDatabase,
  user: UserProfile,
  now: string
): SettleResult {
  let credited = 0;
  let changed = false;
  for (const scheme of db.schemes) {
    const r = settleSchemePayoutForUser(db, user, scheme, now);
    credited = roundMoney(credited + r.credited);
    if (r.changed) changed = true;
  }
  return { credited, changed };
}

/** Re-run settlement for ended schemes (idempotent). Persists any change. */
export function settleAllEndedSchemePayouts(): number {
  const database = loadDb();
  const now = new Date().toISOString();
  let credited = 0;
  let changed = false;
  for (const user of database.users) {
    const r = settleEndedSchemesForUser(database, user, now);
    credited = roundMoney(credited + r.credited);
    if (r.changed) changed = true;
  }
  if (changed) saveDb(database);
  return credited;
}

/**
 * Add order progress toward active schemes (actual billed weight only).
 * No wallet credit during the scheme — payout settles once after end date.
 */
function applySchemeProgress(
  db: AppDatabase,
  user: UserProfile,
  lines: Order["lines"],
  now: string
): number {
  if (!user.schemeProgress) user.schemeProgress = {};
  if (!user.schemeValueProgress) user.schemeValueProgress = {};
  const at = new Date(now);

  for (const scheme of db.schemes) {
    if (isOrderDiscountScheme(scheme)) continue;
    if (!isSchemeActiveNow(scheme, at)) continue;
    if (!dealerHasScheme(scheme, user.assignedSchemeIds)) continue;

    const scoped = progressForScheme(scheme, lines, db.products);
    if (scoped <= 0) continue;

    user.schemeProgress[scheme.id] = roundMoney(
      (user.schemeProgress[scheme.id] ?? 0) + scoped
    );
    const value = valueForScheme(scheme, lines, db.products);
    if (value > 0) {
      user.schemeValueProgress[scheme.id] = roundMoney(
        (user.schemeValueProgress[scheme.id] ?? 0) + value
      );
    }
  }

  // In case any scheme already ended, settle single payout
  return settleEndedSchemesForUser(db, user, now).credited;
}

/** Undo scheme progress when order cancelled / weight adjusted; re-settle if ended. */
function reverseSchemeProgressForOrder(
  db: AppDatabase,
  user: UserProfile,
  order: Order,
  now: string
): void {
  if (!user.schemeProgress) user.schemeProgress = {};
  if (!user.schemeValueProgress) user.schemeValueProgress = {};

  for (const scheme of db.schemes) {
    if (isOrderDiscountScheme(scheme)) continue;
    if (!dealerHasScheme(scheme, user.assignedSchemeIds)) continue;
    const scoped = progressForScheme(scheme, order.lines, db.products);
    if (scoped <= 0) continue;

    user.schemeProgress[scheme.id] = roundMoney(
      Math.max(0, (user.schemeProgress[scheme.id] ?? 0) - scoped)
    );
    const value = valueForScheme(scheme, order.lines, db.products);
    if (value > 0) {
      user.schemeValueProgress[scheme.id] = roundMoney(
        Math.max(0, (user.schemeValueProgress[scheme.id] ?? 0) - value)
      );
    }
  }

  settleEndedSchemesForUser(db, user, now);
}

function orderLinesActualKg(order: Order): number {
  return roundMoney(
    order.lines.reduce((s, l) => s + (l.actualWeightKg || 0), 0)
  );
}

/**
 * Admin sets actual billed weight per line item.
 * This is when scheme progress + lifting are applied (never on estimate).
 */
export function setOrderLineActualWeights(
  orderId: string,
  lineWeights: number[],
  // Reserved for future audit trail (currently system-attributed on scheme txs)
  byUserId = "system"
): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (order.status === "cancelled") {
    throw new Error("Cannot set weight on cancelled order");
  }
  if (order.packingSlip?.status === "finalized") {
    throw new Error(
      "Packing slip is finalized — reopen the packing slip to change final kg / bill"
    );
  }
  if (lineWeights.length !== order.lines.length) {
    throw new Error("Weight required for every line item");
  }
  for (const w of lineWeights) {
    if (!(Number(w) > 0)) {
      throw new Error("Each line actual weight must be greater than 0");
    }
  }

  const user = db.users.find((u) => u.id === order.userId);
  const now = new Date().toISOString();
  const prevActualTotal = orderLinesActualKg(order);
  const hadSchemeApplied = !!order.schemeApplied || prevActualTotal > 0;

  // What stock each line is holding right now, before the weights below
  // overwrite it. Reads line.weightKg (not estimatedWeightKg) so a second
  // weighing rebalances against the first, not the original estimate.
  const reservedSecondary = order.stockReserved
    ? order.lines.map((line) => orderLineSecondaryQty(db, line))
    : [];

  // Preserve estimate weights on lines once
  for (const line of order.lines) {
    if (line.estimatedWeightKg == null) {
      line.estimatedWeightKg = line.weightKg;
    }
  }
  if (order.estimatedWeightKg == null) {
    order.estimatedWeightKg = roundMoney(
      order.lines.reduce(
        (s, l) => s + (l.estimatedWeightKg || l.weightKg || 0),
        0
      )
    );
  }

  // Undo previous actual contribution before rewriting weights
  if (user && hadSchemeApplied) {
    reverseSchemeProgressForOrder(db, user, order, now);
    user.liftingProgressKg = roundMoney(
      Math.max(0, (user.liftingProgressKg || 0) - prevActualTotal)
    );
    order.schemeApplied = false;
  }

  order.lines.forEach((line, i) => {
    const actual = roundMoney(Number(lineWeights[i]));
    line.actualWeightKg = actual;
    line.weightKg = actual;
    line.lineTotal = calcLineTotal({
      pricingMode: line.pricingMode,
      rate: line.rate,
      quantity: line.quantity,
      weightKg: actual,
    });
  });
  if (order.stockReserved) {
    rebalanceOrderReservation(db, order, reservedSecondary, byUserId);
  }
  const totalActual = orderLinesActualKg(order);
  order.actualWeightKg = totalActual;
  order.subtotal = roundMoney(
    order.lines.reduce((s, l) => s + (l.lineTotal || 0), 0)
  );
  if (user) {
    stampOrderBillDiscount(order, db, order.subtotal, new Date(now));
  }
  order.updatedAt = now;

  let schemeSettled = 0;
  if (user) {
    if (!user.schemeProgress) user.schemeProgress = {};
    if (!user.assignedSchemeIds) user.assignedSchemeIds = [];
    user.liftingProgressKg = roundMoney(
      (user.liftingProgressKg || 0) + totalActual
    );
    schemeSettled = applySchemeProgress(db, user, order.lines, now);
    order.schemeApplied = true;
  }

  const est = order.estimatedWeightKg ?? 0;
  order.timeline.push({
    status: "actual_weight",
    at: now,
    note: `Actual line weights set: ${totalActual} kg (estimate ${est} kg) · added to scheme progress (payout after scheme ends)`,
  });
  if (schemeSettled > 0) {
    order.timeline.push({
      status: "scheme_credit",
      at: now,
      note: `Ended scheme payout credited to wallet: ₹${schemeSettled}`,
    });
  }

  saveDb(db);
  return order;
}

export function updateOrderStatus(
  orderId: string,
  status: OrderStatus,
  note?: string
): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (!canTransitionOrderStatus(order.status, status)) {
    if (status === "dispatched" || status === "delivered") {
      throw new Error("Verify payment before dispatch or delivery");
    }
    throw new Error(
      `Cannot move order from ${order.status.replaceAll("_", " ")} to ${status.replaceAll("_", " ")}`
    );
  }
  order.status = status;
  order.updatedAt = new Date().toISOString();
  order.timeline.push({ status, at: order.updatedAt, note });
  if (status === "confirmed") {
    enqueueTallySale(db, order);
    applyTallyAvailability(db);
  }
  saveDb(db);
  return order;
}

/**
 * Statuses where cancel is still allowed.
 * Bill upload already posts a sale voucher, so cancel must void that bill.
 * Once payment is verified or the order dispatched, cancellation must go
 * through accounting (void voucher + refund flow) and is not a one-click op.
 */
export function canCancelOrderStatus(status: OrderStatus): boolean {
  return (
    status === "estimate" ||
    status === "confirmed" ||
    status === "payment_pending"
  );
}

export function cancelOrder(
  orderId: string,
  byUserId: string,
  note?: string
): Order {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === byUserId);
  if (!actor || !actorCan(actor, "manage_orders", db)) {
    throw new Error("Only admin can cancel orders");
  }
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (order.status === "cancelled") throw new Error("Already cancelled");
  if (!canCancelOrderStatus(order.status)) {
    throw new Error("Order cannot be cancelled after dispatch");
  }

  const now = new Date().toISOString();
  const user = db.users.find((u) => u.id === order.userId);

  if (user && order.walletUsed > 0) {
    user.walletBalance = roundMoney(user.walletBalance + order.walletUsed);
    db.walletTransactions.push({
      id: `wt_${crypto.randomUUID()}`,
      userId: user.id,
      type: "credit",
      amount: order.walletUsed,
      reason: `Refund on cancelled order ${order.orderNumber}`,
      orderId: order.id,
      createdAt: now,
      createdBy: byUserId,
    });
  }

  // Remove scheme + lifting only if actual weight was already applied
  const actualKg = orderLinesActualKg(order);
  const hadScheme =
    !!order.schemeApplied ||
    actualKg > 0 ||
    order.lines.some((l) => l.actualWeightKg != null);

  if (user && hadScheme) {
    reverseSchemeProgressForOrder(db, user, order, now);
    user.liftingProgressKg = roundMoney(
      Math.max(0, (user.liftingProgressKg || 0) - actualKg)
    );
    order.schemeApplied = false;
  }

  // Restore stock only if it was reserved at estimate and not already released
  if (order.stockReserved) {
    applyOrderEstimateStock(db, order, byUserId, "release");
    order.stockReserved = false;
  }

  order.status = "cancelled";
  order.updatedAt = now;
  order.timeline.push({
    status: "cancelled",
    at: now,
    note:
      (note || "Order cancelled · stock restored") +
      (hadScheme
        ? ` · scheme weight removed (${actualKg} kg)`
        : " · no scheme weight (bill/actual not set)"),
  });
  cancelTallySale(db, order.id, now);
  applyTallyAvailability(db, now);
  saveDb(db);

  const linked = loadDb().vouchers.filter(
    (v) => v.linkedOrderId === orderId && !v.voided
  );
  const rank = (v: (typeof linked)[number]) =>
    v.type === "sale" || v.type === "purchase" ? 1 : 0;
  linked.sort((a, b) => rank(a) - rank(b));
  const voidedNumbers: string[] = [];
  for (const v of linked) {
    try {
      voidVoucher(v.id, byUserId);
      voidedNumbers.push(v.number);
    } catch {
      /* period lock / already voided — ledger-only fallback below */
    }
  }
  const fresh = loadDb();
  const leftover = voidBooksForOrder(fresh, orderId, byUserId);
  if (leftover.changed) {
    for (const n of leftover.voidedNumbers) {
      if (!voidedNumbers.includes(n)) voidedNumbers.push(n);
    }
  }
  const o = fresh.orders.find((row) => row.id === orderId) ?? order;
  if (voidedNumbers.length) {
    o.timeline.push({
      status: "cancelled",
      at: new Date().toISOString(),
      note: `Books: voided ${voidedNumbers.join(", ")} · removed from party overdue`,
    });
  }
  saveDb(fresh);
  return o;
}

/** Create packing slip for legacy orders that lack one. */
export function ensurePackingSlip(orderId: string): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (order.status === "cancelled") {
    throw new Error("Cannot create packing slip on cancelled order");
  }
  if (order.packingSlip) {
    const before = JSON.stringify(order.packingSlip);
    order.packingSlip = normalizePackingSlip(order, order.packingSlip);
    if (JSON.stringify(order.packingSlip) !== before) {
      saveDb(db);
    }
    return order;
  }
  order.packingSlip = buildPackingSlipFromOrder(order);
  order.updatedAt = new Date().toISOString();
  order.timeline.push({
    status: "packing_slip",
    at: order.updatedAt,
    note: `Packing slip ${order.packingSlip.slipNo} created (draft)`,
  });
  saveDb(db);
  return order;
}

/** Save draft edits (header + grid). */
export function savePackingSlipDraft(
  orderId: string,
  slip: PackingSlip,
  extras?: {
    manualDiscountKind?: "percent" | "flat";
    manualDiscountValue?: number;
  }
): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (order.status === "cancelled") {
    throw new Error("Order cancelled");
  }
  if (order.packingSlip?.status === "finalized") {
    throw new Error("Packing slip is finalized — reopen to edit");
  }
  const synced = syncBundlesFromCells(slip);
  order.packingSlip = normalizePackingSlip(order, {
    ...synced,
    status: "draft",
    slipNo: synced.slipNo || `PS-${order.orderNumber}`,
  });
  // Keep order.shipping in sync with slip draft (so order page never shows 0)
  if (
    order.packingSlip.shippingAmount != null &&
    Number.isFinite(order.packingSlip.shippingAmount)
  ) {
    order.shippingAmount = roundMoney(
      Math.max(0, order.packingSlip.shippingAmount)
    );
  }
  if (order.packingSlip.transport?.trim()) {
    order.transport = order.packingSlip.transport.trim();
  }
  if (order.packingSlip.partyName?.trim()) {
    order.checkoutName = order.packingSlip.partyName.trim();
  }
  if (extras) {
    if (extras.manualDiscountKind === "percent" || extras.manualDiscountKind === "flat") {
      order.manualDiscountKind = extras.manualDiscountKind;
      order.manualDiscountValue =
        (extras.manualDiscountValue || 0) > 0
          ? extras.manualDiscountValue
          : undefined;
    } else {
      order.manualDiscountKind = undefined;
      order.manualDiscountValue = undefined;
    }
  }
  order.updatedAt = new Date().toISOString();
  saveDb(db);
  return order;
}

/** Rebuild columns from current order lines (draft only). */
export function refreshPackingSlipFromOrder(orderId: string): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (order.packingSlip?.status === "finalized") {
    throw new Error("Cannot refresh a finalized packing slip");
  }
  order.packingSlip = refreshPackingSlipColumns(order, order.packingSlip);
  order.updatedAt = new Date().toISOString();
  saveDb(db);
  return order;
}

/** True when staff may still change items/qty/party before final bill. */
export function canEditOrderBeforeBill(order: Order): boolean {
  if (order.status === "cancelled") return false;
  if (
    order.status === "payment_verified" ||
    order.status === "dispatched" ||
    order.status === "delivered"
  ) {
    return false;
  }
  if (order.actualBillAmount != null) return false;
  if (order.packingSlip?.status === "finalized") return false;
  return true;
}

export type OrderEditLineInput = {
  productId: string;
  variationId?: string;
  colorId?: string;
  quantity: number;
  /** Optional rate override; omit to use catalog rate */
  rate?: number;
};

/**
 * Staff edits estimate/order lines + party fields before final bill.
 * Rebalances reserved stock and refreshes draft packing slip columns.
 */
export function editOrderBeforeBill(
  orderId: string,
  staffId: string,
  patch: {
    lines?: OrderEditLineInput[];
    checkoutName?: string;
    phone?: string;
    deliveryAddress?: string;
    gstOrAadhar?: string;
    transport?: string;
    customerNotes?: string;
    walletToUse?: number;
  }
): Order {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === staffId);
  if (!actor || !actorCan(actor, "manage_orders", db)) {
    throw new Error("Only staff can edit orders");
  }
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (!canEditOrderBeforeBill(order)) {
    throw new Error(
      "Cannot edit after final bill / packing slip finalize — reopen slip or cancel first"
    );
  }
  const user = db.users.find((u) => u.id === order.userId);
  if (!user) throw new Error("Dealer not found");

  const now = new Date().toISOString();

  // Release previous reservation before rebuilding lines
  if (order.stockReserved) {
    applyOrderEstimateStock(db, order, staffId, "release");
    order.stockReserved = false;
  }

  let lines = order.lines;
  if (patch.lines) {
    if (!patch.lines.length) {
      throw new Error("Order must have at least one item");
    }
    lines = patch.lines.map((item) => {
      const qty = Math.max(0, Math.round(Number(item.quantity) || 0));
      if (!(qty > 0)) throw new Error("Each line quantity must be > 0");
      const product = db.products.find((p) => p.id === item.productId);
      if (!product) throw new Error("Product missing");
      const variation = product.variations.find(
        (v) => v.id === item.variationId
      );
      const color = product.colors.find((c) => c.id === item.colorId);
      const built = buildOrderLine({
        product,
        variation,
        colorId: color?.id,
        colorName: color?.name,
        quantity: qty,
      });
      // Prefer explicit edit rate, else keep this order's previous snapshotted
      // rate for the same SKU (catalog rate changes must not rewrite mid-order).
      const prev = order.lines.find(
        (l) =>
          l.productId === item.productId &&
          l.variationId === item.variationId &&
          (l.colorId || "") === (item.colorId || "")
      );
      const rateToUse =
        item.rate != null && Number.isFinite(item.rate) && item.rate >= 0
          ? roundMoney(item.rate)
          : prev && prev.rate > 0
            ? prev.rate
            : built.rate;
      built.rate = rateToUse;
      built.lineTotal = calcLineTotal({
        pricingMode: built.pricingMode,
        rate: built.rate,
        quantity: built.quantity,
        weightKg: built.weightKg,
      });
      return built;
    });
  }

  assertOrderStockAvailable(db, lines);

  const subtotal = roundMoney(lines.reduce((s, l) => s + l.lineTotal, 0));
  const totalWeightKg = shippingWeightExcludingJhal(lines, db.products);
  const jhalQty = countOrderJhals(lines, db.products);
  const shippingAmount = calcShipping(db, subtotal, totalWeightKg, jhalQty);

  // Wallet: keep requested amount if set, else keep previous (capped)
  const wantWallet =
    patch.walletToUse != null
      ? Math.max(0, Number(patch.walletToUse) || 0)
      : order.walletUsed || 0;
  // Refund previous wallet use first so balance is correct for re-apply
  if (order.walletUsed > 0) {
    user.walletBalance = roundMoney(
      (user.walletBalance || 0) + order.walletUsed
    );
    db.walletTransactions.push({
      id: `wt_${crypto.randomUUID()}`,
      userId: user.id,
      type: "credit",
      amount: order.walletUsed,
      reason: `Refunded on edit ${order.orderNumber}`,
      orderId: order.id,
      createdAt: now,
      createdBy: staffId,
    });
  }
  const bestDiscount = pickBestOrderDiscount(
    db.schemes,
    user.assignedSchemeIds,
    lines,
    db.products,
    new Date(now)
  );
  const applied = applyBillDiscounts({
    goodsSubtotal: subtotal,
    schemeAmount: bestDiscount?.amount ?? 0,
    manualKind: order.manualDiscountKind,
    manualValue: order.manualDiscountValue,
  });
  const schemeDiscount = applied.total;
  const maxWallet = Math.min(
    user.walletBalance || 0,
    Math.max(0, subtotal + shippingAmount - schemeDiscount)
  );
  const walletUsed = roundMoney(Math.min(wantWallet, maxWallet));
  if (walletUsed > 0) {
    user.walletBalance = roundMoney(user.walletBalance - walletUsed);
    db.walletTransactions.push({
      id: `wt_${crypto.randomUUID()}`,
      userId: user.id,
      type: "debit",
      amount: walletUsed,
      reason: `Used on edited estimate ${order.orderNumber}`,
      orderId: order.id,
      createdAt: now,
      createdBy: staffId,
    });
  }

  order.lines = lines;
  order.subtotal = subtotal;
  order.shippingAmount = shippingAmount;
  order.walletUsed = walletUsed;
  order.schemeDiscount = schemeDiscount > 0 ? schemeDiscount : undefined;
  order.schemeDiscountId = bestDiscount?.scheme.id;
  order.schemeDiscountLabel =
    schemeDiscount > 0
      ? billDiscountReceiptLabel(
          bestDiscount,
          applied,
          order.manualDiscountKind,
          order.manualDiscountValue,
          "en"
        )
      : undefined;
  order.schemeDiscountMath =
    applied.schemeAmount > 0
      ? orderDiscountMathLabel(
          bestDiscount,
          bestDiscount
            ? orderDiscountMathQty(bestDiscount.scheme, lines, db.products)
            : 0,
          "en"
        )
      : undefined;
  order.estimatedTotal = roundOffRupees(
    subtotal + shippingAmount - schemeDiscount - walletUsed
  );
  order.estimatedWeightKg = totalWeightKg;
  order.actualWeightKg = undefined;
  order.schemeApplied = false;
  for (const line of order.lines) {
    line.actualWeightKg = undefined;
  }

  if (patch.checkoutName != null) {
    order.checkoutName = patch.checkoutName.trim();
    order.userName = order.checkoutName || order.userName;
  }
  if (patch.phone != null) order.phone = patch.phone.trim();
  if (patch.deliveryAddress != null) {
    order.deliveryAddress = patch.deliveryAddress.trim();
  }
  if (patch.gstOrAadhar != null) {
    order.gstOrAadhar = patch.gstOrAadhar.trim();
  }
  if (patch.transport != null) order.transport = patch.transport.trim();
  if (patch.customerNotes != null) {
    order.customerNotes = patch.customerNotes.trim();
  }

  applyOrderEstimateStock(db, order, staffId, "reserve");
  order.stockReserved = true;

  if (order.packingSlip && order.packingSlip.status !== "finalized") {
    order.packingSlip = refreshPackingSlipColumns(order, order.packingSlip);
  } else if (!order.packingSlip) {
    order.packingSlip = buildPackingSlipFromOrder(order);
  }

  order.updatedAt = now;
  order.timeline.push({
    status: order.status,
    at: now,
    note: `Order edited by ${actor.name} before bill · ${lines.length} lines · ${totalWeightKg} kg est · ₹${order.estimatedTotal}`,
  });
  saveDb(db);
  return order;
}

/**
 * Finalize packing slip → actual line weights + bill amount + mark slip done.
 * PDF URL can be attached afterwards via attachPackingSlipPdf.
 */
export function finalizePackingSlip(
  orderId: string,
  staffId: string,
  opts?: {
    preparedBy?: string;
    checkedBy?: string;
    manualDiscountKind?: "percent" | "flat";
    manualDiscountValue?: number;
    allowOverCredit?: boolean;
  }
): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (order.status === "cancelled") {
    throw new Error("Cannot finalize on cancelled order");
  }
  if (
    order.status === "payment_verified" ||
    order.status === "dispatched" ||
    order.status === "delivered"
  ) {
    throw new Error("Order already past billing — cannot finalize packing slip");
  }

  let slip = order.packingSlip;
  if (!slip) {
    slip = buildPackingSlipFromOrder(order);
    order.packingSlip = slip;
  }
  if (slip.status === "finalized") {
    throw new Error("Packing slip already finalized");
  }
  if (opts?.allowOverCredit) {
    order.allowOverCredit = true;
  }
  const hasPktPcsQty = order.lines.some((line) => {
    const unit =
      line.unit ||
      db.products.find((p) => p.id === line.productId)?.unit ||
      "";
    return (
      (isPackCountUnit(unit) || line.pricingMode === "pcs") &&
      (Number(line.quantity) || 0) > 0
    );
  });
  if (!slipHasEntries(slip) && !hasPktPcsQty) {
    throw new Error("Enter weighments (kg) or bundles before finalizing");
  }

  const weights = lineActualWeightsFromSlip(slip, order.lines.length);
  const slipBundles = columnBundles(slip);
  for (let i = 0; i < order.lines.length; i++) {
    const line = order.lines[i];
    const unit =
      line.unit ||
      db.products.find((p) => p.id === line.productId)?.unit ||
      "";
    if (unit === "jhal") {
      // Bill = rate × kg; shipping still uses jhal count
      if (!(weights[i] > 0)) {
        throw new Error("Every jhal column needs total kg greater than 0");
      }
      const b = slipBundles[i] || line.quantity || 0;
      if (!(b > 0)) {
        throw new Error("Every jhal line needs quantity / bundles greater than 0");
      }
    } else if (isPackCountUnit(unit) || line.pricingMode === "pcs") {
      // Bill = qty × rate per pc / packet
      const b = slipBundles[i] || line.quantity || 0;
      if (!(b > 0)) {
        throw new Error("Every pkt/pc/sqft column needs quantity / bundles greater than 0");
      }
      // Store admin pack weight for schemes/shipping reference (bill uses pcs mode)
      if (!(weights[i] > 0)) {
        weights[i] =
          Number(line.estimatedWeightKg) ||
          Number(line.weightKg) ||
          b;
      }
    } else if (!(weights[i] > 0)) {
      throw new Error("Every size/SKU column needs total kg greater than 0");
    }
  }

  if (opts?.preparedBy?.trim()) slip.preparedBy = opts.preparedBy.trim();
  if (opts?.checkedBy?.trim()) slip.checkedBy = opts.checkedBy.trim();

  // Resolve shipping onto the slip + order BEFORE bill (never leave as 0 when
  // weighments exist — recalculate auto shipping from actual kg/subtotal).
  const weightsPreview = computeBillFromSlip(order, slip, {
    shippingAmount: 0,
  });
  const jhalQty = countOrderJhals(order.lines, db.products);
  const shipWeight = shippingWeightFromSlip(order, slip, db.products);
  let ship = roundMoney(Math.max(0, Number(slip.shippingAmount) || 0));
  if (!slip.shippingManual) {
    ship = calcShipping(db, weightsPreview.subtotal, shipWeight, jhalQty);
  } else if (!(ship > 0) && (shipWeight > 0 || jhalQty > 0)) {
    // Manual flag but empty amount — fall back to auto
    ship = calcShipping(db, weightsPreview.subtotal, shipWeight, jhalQty);
    slip.shippingManual = false;
  }
  slip.shippingAmount = ship;
  order.shippingAmount = ship;
  const creditPreview = computeBillFromSlip(order, slip, {
    shippingAmount: ship,
  });
  const creditBill = roundOffRupees(
    Math.max(0, creditPreview.subtotal + ship)
  );
  if (creditBill > 0) {
    enforceOrderCredit(db, order, creditBill);
  }
  if (opts?.manualDiscountKind === "percent" || opts?.manualDiscountKind === "flat") {
    order.manualDiscountKind = opts.manualDiscountKind;
    order.manualDiscountValue =
      (opts.manualDiscountValue || 0) > 0 ? opts.manualDiscountValue : undefined;
  } else if (opts && "manualDiscountKind" in opts) {
    order.manualDiscountKind = undefined;
    order.manualDiscountValue = undefined;
  }

  // Persist slip draft fields first
  order.packingSlip = slip;
  saveDb(db);

  // Apply weights (schemes etc.)
  setOrderLineActualWeights(orderId, weights, staffId);

  const afterWeights = loadDb();
  const billed = afterWeights.orders.find((o) => o.id === orderId)!;
  // Keep the shipping we just locked (setOrderLineActualWeights reloads DB)
  if (billed.packingSlip) {
    billed.packingSlip.shippingAmount = ship;
    billed.packingSlip.shippingManual = slip.shippingManual;
  }
  billed.shippingAmount = ship;
  const preview = computeBillFromSlip(billed, billed.packingSlip!, {
    shippingAmount: ship,
  });
  // Align line totals / pcs qty with slip bill (not ordered qty)
  const bundles = columnBundles(billed.packingSlip!);
  billed.lines.forEach((line, i) => {
    if (preview.lineAmounts[i] != null) {
      line.lineTotal = preview.lineAmounts[i];
    }
    if (line.pricingMode === "pcs" && (bundles[i] || 0) > 0) {
      line.quantity = bundles[i];
    }
  });
  billed.subtotal = preview.subtotal;
  if (opts?.manualDiscountKind === "percent" || opts?.manualDiscountKind === "flat") {
    billed.manualDiscountKind = opts.manualDiscountKind;
    billed.manualDiscountValue =
      (opts.manualDiscountValue || 0) > 0 ? opts.manualDiscountValue : undefined;
  } else if (opts && "manualDiscountKind" in opts) {
    billed.manualDiscountKind = undefined;
    billed.manualDiscountValue = undefined;
  }
  stampOrderBillDiscount(
    billed,
    afterWeights,
    billed.subtotal
  );
  if (!(preview.billAmount > 0) && !(preview.subtotal > 0)) {
    throw new Error("Computed bill amount is zero");
  }
  saveDb(afterWeights);

  // Gross bill before wallet (after scheme discount) — whole-rupee round
  const schemeDisc = billed.schemeDiscount || 0;
  const grossBill = roundOffRupees(
    Math.max(0, preview.subtotal + ship - schemeDisc)
  );
  uploadBill(orderId, grossBill, undefined, undefined, staffId, {
    allowOverCredit: opts?.allowOverCredit,
  });

  const after = loadDb();
  const finalOrder = after.orders.find((o) => o.id === orderId)!;
  const staff = after.users.find((u) => u.id === staffId);
  const now = new Date().toISOString();
  if (!finalOrder.packingSlip) {
    throw new Error("Packing slip missing after bill");
  }
  finalOrder.packingSlip.status = "finalized";
  finalOrder.packingSlip.finalizedAt = now;
  finalOrder.packingSlip.finalizedBy =
    staff?.name || opts?.preparedBy || staffId;
  if (opts?.preparedBy?.trim()) {
    finalOrder.packingSlip.preparedBy = opts.preparedBy.trim();
  }
  if (opts?.checkedBy?.trim()) {
    finalOrder.packingSlip.checkedBy = opts.checkedBy.trim();
  }
  finalOrder.timeline.push({
    status: "packing_slip_finalized",
    at: now,
    note: `Packing slip finalized · ${preview.totalKg} kg · ${preview.totalBundles} bundles · bill ₹${finalOrder.actualBillAmount}`,
  });
  finalOrder.updatedAt = now;
  saveDb(after);
  return loadDb().orders.find((o) => o.id === orderId)!;
}

/** Attach generated customer PDF (data URL or hosted URL) after finalize. */
export function attachPackingSlipPdf(
  orderId: string,
  pdfUrl: string
): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order?.packingSlip) throw new Error("No packing slip");
  order.packingSlip.customerPdfUrl = pdfUrl;
  if (!order.billFileDataUrl) {
    order.billFileDataUrl = pdfUrl;
  }
  order.updatedAt = new Date().toISOString();
  saveDb(db);
  return order;
}

/** If order.shipping is 0/stale but packing slip has shipping, copy it over. */
export function repairOrderShippingFromSlip(orderId: string): Order | null {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order?.packingSlip) return null;
  const slipShip = order.packingSlip.shippingAmount;
  if (slipShip == null || !Number.isFinite(Number(slipShip))) return null;
  const ship = roundMoney(Math.max(0, Number(slipShip)));
  if (roundMoney(order.shippingAmount || 0) === ship) return null;
  // Prefer slip whenever it has a positive shipping, or slip is finalized
  if (!(ship > 0) && order.packingSlip.status !== "finalized") return null;
  order.shippingAmount = ship;
  order.updatedAt = new Date().toISOString();
  saveDb(db);
  return order;
}

/** Re-open finalized slip for edits before payment is verified. */
export function reopenPackingSlip(orderId: string, staffId: string): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order?.packingSlip) throw new Error("No packing slip");
  if (order.packingSlip.status !== "finalized") {
    return order;
  }
  if (
    order.status === "payment_verified" ||
    order.status === "dispatched" ||
    order.status === "delivered"
  ) {
    throw new Error("Cannot reopen after payment is verified");
  }
  order.packingSlip.status = "draft";
  order.packingSlip.finalizedAt = undefined;
  order.packingSlip.finalizedBy = undefined;
  order.updatedAt = new Date().toISOString();
  order.timeline.push({
    status: "packing_slip",
    at: order.updatedAt,
    note: `Packing slip reopened for edits by ${staffId}`,
  });
  saveDb(db);
  return order;
}

function customerPartyForOrder(
  db: AppDatabase,
  order: Order
): Party | undefined {
  const party = db.parties.find(
    (p) => p.linkedUserId === order.userId && p.type === "customer"
  );
  if (party) return party;
  const phone = (order.phone || "").trim();
  if (!phone) return undefined;
  return db.parties.find(
    (p) => p.type === "customer" && p.active && p.phone === phone
  );
}

function enforceOrderCredit(
  db: AppDatabase,
  order: Order,
  saleTotal: number,
  allowOverCredit?: boolean
): void {
  const party = customerPartyForOrder(db, order);
  const check = assertSaleUnderCredit({
    party,
    ledgerEntries: db.ledgerEntries,
    saleTotal,
    allowOverCredit: allowOverCredit || order.allowOverCredit,
  });
  if (check.ok) {
    order.creditBlockedOverBy = undefined;
    return;
  }
  order.creditBlockedOverBy = check.overBy;
  order.updatedAt = new Date().toISOString();
  saveDb(db);
  throw new Error(check.message);
}

export function uploadBill(
  orderId: string,
  actualAmount: number,
  billFileDataUrl?: string,
  lineActualWeights?: number[],
  byUserId = "system",
  opts?: { allowOverCredit?: boolean }
): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (order.status === "cancelled") {
    throw new Error("Cannot bill a cancelled order");
  }
  if (order.packingSlip?.status === "finalized") {
    throw new Error(
      "Packing slip is finalized — reopen the packing slip to change final kg / bill"
    );
  }
  if (!(actualAmount > 0)) {
    throw new Error("Enter a valid bill amount");
  }
  if (opts?.allowOverCredit) {
    order.allowOverCredit = true;
  }
  enforceOrderCredit(db, order, roundOffRupees(actualAmount));
  order.actualBillAmount = roundOffRupees(actualAmount);
  if (billFileDataUrl) order.billFileDataUrl = billFileDataUrl;
  order.billUploadedAt = new Date().toISOString();
  // Preserve verified state if bill is re-uploaded post-verification
  if (order.status !== "payment_verified" && order.status !== "dispatched") {
    order.status = "payment_pending";
  }
  order.updatedAt = order.billUploadedAt;
  order.timeline.push({
    status: order.status,
    at: order.billUploadedAt,
    note: `Final bill uploaded: ₹${order.actualBillAmount}`,
  });
  saveDb(db);

  if (lineActualWeights && lineActualWeights.length) {
    setOrderLineActualWeights(orderId, lineActualWeights, byUserId);
    // Recompute gross bill from actuals + scheme discount (caller may have
    // used estimate-time discount).
    const fresh = loadDb();
    const o = fresh.orders.find((x) => x.id === orderId);
    if (o) {
      const disc = o.schemeDiscount || 0;
      const ship = o.shippingAmount || 0;
      const sub = o.subtotal || 0;
      o.actualBillAmount = roundOffRupees(Math.max(0, sub + ship - disc));
      saveDb(fresh);
    }
  }

  // Queue a Tally sale. Local sale vouchers are not the books anymore.
  try {
    enqueueTallySaleFromOrder(orderId);
  } catch (err) {
    const note = err instanceof Error ? err.message : "Tally sale queue failed";
    console.warn("[uploadBill] tally sale failed:", note);
    const fresh = loadDb();
    const o = fresh.orders.find((x) => x.id === orderId);
    if (o) {
      o.timeline.push({
        status: o.status,
        at: new Date().toISOString(),
        note: `Tally: sale not queued — ${note}`,
      });
      saveDb(fresh);
    }
  }
  return loadDb().orders.find((o) => o.id === orderId)!;
}

export function uploadPaymentProof(
  orderId: string,
  proof: { note?: string; imageDataUrl?: string }
): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  order.paymentProof = {
    note: proof.note,
    imageDataUrl: proof.imageDataUrl,
    uploadedAt: new Date().toISOString(),
    verified: false,
  };
  order.updatedAt = order.paymentProof.uploadedAt;
  order.timeline.push({
    status: "payment_proof",
    at: order.updatedAt,
    note: "Customer uploaded payment proof",
  });
  saveDb(db);
  return order;
}

/**
 * Append one or more proof files to an order. Used for both first uploads and
 * subsequent uploads for part-payments. Preserves any existing legacy singular
 * `imageDataUrl` by migrating it into the first item slot.
 */
export function addPaymentProofFiles(
  orderId: string,
  items: PaymentProofItem[],
  byUserId?: string
): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (order.status === "cancelled") {
    throw new Error("Cannot add proof on a cancelled order");
  }
  if (!items.length) throw new Error("Add at least one file");

  const now = new Date().toISOString();
  const existing = order.paymentProof;
  const legacyMigrated: PaymentProofItem[] =
    existing && existing.imageDataUrl && !(existing.items?.length)
      ? [
          {
            id: "legacy",
            url: existing.imageDataUrl,
            type: /pdf/i.test(existing.imageDataUrl) ? "pdf" : "image",
            note: existing.note,
            uploadedAt: existing.uploadedAt,
          },
        ]
      : [];

  // Never let proof amounts exceed remaining balance due
  const due = paymentAmountDue(order);
  const remainingBefore = proofRemaining(existing, due);
  let budget = remainingBefore;
  const cappedIncoming = items.map((it) => {
    let amt =
      typeof it.amount === "number" && Number.isFinite(it.amount)
        ? Math.max(0, it.amount)
        : 0;
    if (budget <= 0) {
      amt = 0;
    } else if (amt > budget) {
      amt = Math.round(budget * 100) / 100;
    }
    budget = Math.max(0, Math.round((budget - amt) * 100) / 100);
    return {
      ...it,
      amount: amt > 0 ? amt : undefined,
      uploadedAt: it.uploadedAt || now,
      uploadedBy: it.uploadedBy || byUserId,
    };
  });
  if (remainingBefore > 0 && cappedIncoming.every((it) => !(it.amount && it.amount > 0))) {
    throw new Error(
      `Amount cannot exceed remaining balance (₹${remainingBefore.toFixed(2)})`
    );
  }

  const merged = [...legacyMigrated, ...(existing?.items ?? []), ...cappedIncoming];

  order.paymentProof = {
    items: merged,
    // Keep the singular legacy fields for older clients that haven't migrated
    // by mirroring the most recent item into them.
    imageDataUrl: merged[merged.length - 1]?.url,
    note: merged[merged.length - 1]?.note,
    uploadedAt: existing?.uploadedAt || now,
    verified: existing?.verified ?? false,
    verifiedAt: existing?.verifiedAt,
    verifiedBy: existing?.verifiedBy,
  };
  order.updatedAt = now;
  order.timeline.push({
    status: "payment_proof",
    at: now,
    note:
      items.length === 1
        ? "Customer uploaded payment proof"
        : `Customer uploaded ${items.length} payment proof files`,
  });
  saveDb(db);

  // When payment already verified, make sure the Tally sale is queued
  if (order.paymentProof?.verified) {
    try {
      enqueueTallySaleFromOrder(orderId);
    } catch {
      /* sale may already be queued */
    }
    try {
      syncOrderPaymentReceipts(orderId, byUserId || "system");
    } catch (err) {
      console.warn(
        "[addPaymentProofFiles] receipt sync failed:",
        err instanceof Error ? err.message : err
      );
    }
  }

  return loadDb().orders.find((o) => o.id === orderId)!;
}

/**
 * Remove a single proof item. Allowed for the owner while unverified, or for
 * staff with `manage_orders` at any time.
 */
export function removePaymentProofItem(
  orderId: string,
  itemId: string,
  byUserId: string
): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  const proof = order.paymentProof;
  if (!proof) throw new Error("No payment proof to remove");

  const actor = db.users.find((u) => u.id === byUserId);
  const isStaff = !!actor && actorCan(actor, "manage_orders", db);
  const isOwner = order.userId === byUserId;
  if (!isStaff) {
    if (!isOwner) throw new Error("Not allowed");
    if (proof.verified) {
      throw new Error("Cannot remove proof once verified");
    }
  }
  if (proof.verified) {
    throw new Error(
      "Cannot remove a verified payment proof — void the receipt in Accounts first"
    );
  }

  const items = (proof.items ?? []).filter((it) => it.id !== itemId);
  const now = new Date().toISOString();
  if (!items.length) {
    // Clear proof entirely when no items remain.
    order.paymentProof = undefined;
  } else {
    order.paymentProof = {
      ...proof,
      items,
      imageDataUrl: items[items.length - 1]?.url,
      note: items[items.length - 1]?.note,
    };
  }
  order.updatedAt = now;
  order.timeline.push({
    status: "payment_proof",
    at: now,
    note: `${isStaff ? "Admin" : "Customer"} removed a payment proof file`,
  });
  saveDb(db);
  return order;
}

export function verifyPayment(
  orderId: string,
  adminId: string,
  opts?: { force?: boolean }
): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order || !order.paymentProof) throw new Error("No payment proof");
  const actor = db.users.find((u) => u.id === adminId);
  if (!actor || !actorCan(actor, "verify_payment", db)) {
    throw new Error("Not allowed to verify payment");
  }
  const due = paymentAmountDue(order);
  const remaining = Math.max(
    0,
    Math.round((due - proofPaidTotal(order.paymentProof)) * 100) / 100
  );
  if (remaining > 0.05 && !opts?.force) {
    throw new Error(
      `₹${remaining.toFixed(2)} still outstanding — upload more proof or force-verify`
    );
  }
  order.paymentProof.verified = true;
  order.paymentProof.verifiedAt = new Date().toISOString();
  order.paymentProof.verifiedBy = adminId;
  order.status = "payment_verified";
  order.updatedAt = order.paymentProof.verifiedAt;
  order.timeline.push({
    status: "payment_verified",
    at: order.updatedAt,
    note: opts?.force
      ? `Payment force-verified by admin (₹${remaining.toFixed(2)} outstanding)`
      : "Payment verified by admin",
  });
  saveDb(db);

  // Queue the Tally sale. Receipts stay local and no-op if there is no voucher.
  try {
    enqueueTallySaleFromOrder(orderId);
  } catch (err) {
    console.warn(
      "[verifyPayment] tally sale failed:",
      err instanceof Error ? err.message : err
    );
  }
  try {
    syncOrderPaymentReceipts(orderId, adminId);
  } catch (err) {
    console.warn(
      "[verifyPayment] receipt sync failed:",
      err instanceof Error ? err.message : err
    );
  }
  return loadDb().orders.find((o) => o.id === orderId)!;
}

/** Mark order dispatched (separate from LR upload). Payment must be verified. */
export function markOrderDispatched(
  orderId: string,
  note?: string
): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (order.status === "dispatched") return order;
  if (order.status !== "payment_verified") {
    throw new Error("Verify payment before dispatch");
  }
  return updateOrderStatus(
    orderId,
    "dispatched",
    note || "Marked dispatched · LR pending"
  );
}

/** Upload / update LR and mark the order delivered. */
export function uploadLr(
  orderId: string,
  lr: { lrNumber?: string; lrFileDataUrl?: string }
): Order {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (
    order.status !== "payment_verified" &&
    order.status !== "dispatched" &&
    order.status !== "delivered"
  ) {
    throw new Error("Verify payment before uploading LR");
  }
  if (!lr.lrNumber?.trim() && !lr.lrFileDataUrl) {
    throw new Error("Enter LR number or upload LR file");
  }
  order.lrNumber = lr.lrNumber?.trim() || order.lrNumber;
  order.lrFileDataUrl = lr.lrFileDataUrl || order.lrFileDataUrl;
  order.lrUploadedAt = new Date().toISOString();
  order.updatedAt = order.lrUploadedAt;
  order.timeline.push({
    status: "lr_uploaded",
    at: order.updatedAt,
    note: order.lrNumber
      ? `LR uploaded: ${order.lrNumber}`
      : "LR file uploaded",
  });
  if (order.status !== "delivered") {
    if (!canTransitionOrderStatus(order.status, "delivered")) {
      throw new Error("Cannot mark delivered from current status");
    }
    order.status = "delivered";
    order.timeline.push({
      status: "delivered",
      at: order.updatedAt,
      note: "LR uploaded · marked delivered",
    });
  }
  saveDb(db);
  return order;
}

export function orderHasLr(order: {
  lrNumber?: string;
  lrFileDataUrl?: string;
}): boolean {
  return Boolean(order.lrNumber?.trim() || order.lrFileDataUrl);
}

export function upsertProduct(product: Product): void {
  const db = loadDb();
  // Collapse accidental duplicate sizes (e.g. bulk-add twice) before save.
  const deduped = dedupeProductVariations(product);
  normalizeProductLocalized(deduped);
  const normalized = normalizeProductStock(deduped);
  normalized.updatedAt = new Date().toISOString();
  const liveWrite = actorWritesLiveCatalog(db);
  const idx = db.products.findIndex((p) => p.id === normalized.id);
  const existing = idx >= 0 ? db.products[idx] : undefined;

  if (!liveWrite) {
    const proposed = extractSellingRates(normalized);
    const liveSnapshot = existing
      ? extractSellingRates(existing)
      : extractSellingRates(zeroedCopy(normalized));
    overlayLiveSellingRates(normalized, existing);
    if (!sellingRatesEqual(liveSnapshot, proposed)) {
      const actor = sessionActorMeta(db);
      db.ownerApprovals = upsertPendingApproval(db.ownerApprovals, {
        kind: "product_rates",
        targetKey: productRatesTargetKey(normalized.id),
        productId: normalized.id,
        title: `Rate · ${normalized.code || normalized.name?.en || normalized.id}`,
        snapshot: { before: liveSnapshot, proposed },
        requestedBy: actor.id,
        requestedByName: actor.name,
      });
      notifyOwnerApprovalQueued(
        db,
        `Rate · ${normalized.code || normalized.name?.en || normalized.id}`
      );
    }
    // Keep in-memory callers (quick-create) on live rates so they cannot sell unapproved ₹.
    overlayLiveSellingRates(product, normalized);
  }

  if (idx >= 0) db.products[idx] = normalized;
  else {
    normalized.createdAt = normalized.updatedAt;
    db.products.unshift(normalized);
  }
  saveDb(db);
}

function zeroedCopy(product: Product): Product {
  return {
    ...product,
    baseRate: 0,
    ratePerSqft: 0,
    variations: (product.variations ?? []).map((v) => ({
      ...v,
      rate: 0,
      ratePerSqft: 0,
    })),
  };
}

export function markTallyError(message: string): void {
  const db = loadDb();
  db.settings.tallySyncStatus = "error";
  db.settings.tallySyncMessage = message;
  saveDb(db);
}

export function applyTallyStockSync(items: TallyStockInput[]): {
  applied: number;
  unknown: { reason: string }[];
} {
  const db = loadDb();
  const result = applyTallyStock(db, items);
  saveDb(db);
  return result;
}

/** One pending Tally sale for this order. Safe to call again. */
export function enqueueTallySaleFromOrder(orderId: string): void {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) return;
  enqueueTallySale(db, order);
  applyTallyAvailability(db);
  saveDb(db);
}

export function deleteProduct(productId: string): void {
  const db = loadDb();
  db.products = db.products.filter((p) => p.id !== productId);
  if (db.settings.homeNewProductIds?.length) {
    db.settings.homeNewProductIds = db.settings.homeNewProductIds.filter(
      (id) => id !== productId
    );
  }
  if (db.settings.homePromoProductIds?.length) {
    db.settings.homePromoProductIds = db.settings.homePromoProductIds.filter(
      (id) => id !== productId
    );
  }
  saveDb(db);
}

export function upsertUser(user: UserProfile): void {
  const db = loadDb();
  const existing = db.users.find((u) => u.id === user.id);
  if (
    existing?.role === "super_admin" &&
    user.role !== "super_admin" &&
    existing.active
  ) {
    const otherOwner = db.users.some(
      (u) =>
        u.id !== user.id && u.role === "super_admin" && u.active
    );
    if (!otherOwner) {
      throw new Error(
        "Cannot demote the last owner — create another owner first"
      );
    }
  }
  // Owners always keep full preset — strip override fields
  const nextUser: UserProfile =
    user.role === "super_admin"
      ? {
          ...user,
          extraCapabilities: undefined,
          deniedCapabilities: undefined,
          jobId: undefined,
        }
      : user;
  const hadTomb =
    !!db.deletedUserAt?.[nextUser.id] ||
    !!(db.deletedUserIds ?? []).includes(nextUser.id);
  // Re-create must beat tomb timestamps on other devices
  const next = hadTomb
    ? { ...nextUser, createdAt: new Date().toISOString() }
    : nextUser;
  const idx = db.users.findIndex((u) => u.id === next.id);
  if (idx >= 0) db.users[idx] = next;
  else db.users.push(next);
  if (db.deletedUserIds?.length) {
    db.deletedUserIds = db.deletedUserIds.filter((id) => id !== next.id);
  }
  if (db.deletedUserAt?.[next.id]) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- omit by key
    const { [next.id]: _, ...rest } = db.deletedUserAt;
    db.deletedUserAt = rest;
  }
  if (next.role === "customer") ensureCustomerParty(db, next);
  saveDb(db);
}

function assertOwner(db: AppDatabase, actorId: string): UserProfile {
  const actor = db.users.find((u) => u.id === actorId);
  if (!actor || actor.role !== "super_admin" || !actor.active) {
    throw new Error("Only a super admin can edit jobs and role defaults");
  }
  return actor;
}

export function saveRolePresets(presets: RolePresets, actorId: string): void {
  const db = loadDb();
  assertOwner(db, actorId);
  db.rolePresets = sanitizeRolePresets(presets);
  saveDb(db);
}

export function upsertStaffJob(job: StaffJob, actorId: string): void {
  const db = loadDb();
  assertOwner(db, actorId);
  const next = sanitizeStaffJob(job);
  if (!next) throw new Error("Enter a job name and pick a base role");
  const list = sanitizeStaffJobs(db.staffJobs);
  const idx = list.findIndex((j) => j.id === next.id);
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  db.staffJobs = list;
  saveDb(db);
}

export function deleteStaffJob(jobId: string, actorId: string): void {
  const db = loadDb();
  assertOwner(db, actorId);
  db.staffJobs = sanitizeStaffJobs(db.staffJobs).filter((j) => j.id !== jobId);
  db.users = db.users.map((u) =>
    u.jobId === jobId ? { ...u, jobId: undefined } : u
  );
  saveDb(db);
}

export function assignStaffJob(
  userId: string,
  jobId: string | null,
  actorId: string
): void {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === actorId);
  if (!actor || !actorCan(actor, "manage_users", db)) {
    throw new Error("You do not have permission to manage users");
  }
  if (actor.role !== "super_admin") {
    throw new Error("Only a super admin can assign jobs");
  }
  const user = db.users.find((u) => u.id === userId);
  if (!user || user.role === "customer") {
    throw new Error("Pick a staff login");
  }
  if (user.role === "super_admin") {
    throw new Error("Owners keep the full permission set");
  }
  if (!jobId) {
    upsertUser({
      ...user,
      jobId: undefined,
      extraCapabilities: undefined,
      deniedCapabilities: undefined,
    });
    return;
  }
  const job = sanitizeStaffJobs(db.staffJobs).find((j) => j.id === jobId);
  if (!job) throw new Error("Job not found");
  upsertUser({
    ...user,
    role: job.baseRole,
    jobId: job.id,
    extraCapabilities: undefined,
    deniedCapabilities: undefined,
  });
}

export function updateDealerFile(input: {
  userId: string;
  actorId: string;
  name: string;
  phone: string;
  company?: string;
  address?: string;
  pincode?: string;
  gstOrAadhar?: string;
  transport?: string;
  creditLimit?: number | null;
}): void {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === input.actorId);
  if (!actor || !actorCan(actor, "approve_dealers", db)) {
    throw new Error("You do not have permission to edit dealers");
  }
  applyDealerFileActions(db, actor, {
    action: "update",
    ids: [input.userId],
    patch: {
      name: input.name,
      phone: input.phone,
      company: input.company,
      address: input.address,
      pincode: input.pincode,
      gstOrAadhar: input.gstOrAadhar,
      transport: input.transport,
      creditLimit: input.creditLimit,
    },
  });
  saveDb(db);
}

function assertMinPassword(password: string): string {
  const pw = String(password ?? "").trim();
  if (pw.length < 6) {
    throw new Error("Password must be at least 6 characters");
  }
  return pw;
}

export function createStaffUser(input: {
  name: string;
  phone: string;
  password: string;
  role: UserRole;
  email?: string;
  extraCapabilities?: Capability[];
  deniedCapabilities?: Capability[];
}): UserProfile {
  const db = loadDb();
  const phone = normalizePhone(input.phone);
  if (phone.length < 10) {
    throw new Error("Enter a valid 10-digit mobile number");
  }
  if (db.users.some((u) => phonesMatch(u.phone, phone))) {
    throw new Error("This phone number already exists");
  }
  const pw = assertMinPassword(input.password);
  const caps =
    input.role === "super_admin"
      ? {}
      : {
          extraCapabilities: input.extraCapabilities?.length
            ? input.extraCapabilities
            : undefined,
          deniedCapabilities: input.deniedCapabilities?.length
            ? input.deniedCapabilities
            : undefined,
        };
  const user: UserProfile = {
    id: `user_${crypto.randomUUID()}`,
    email: input.email?.trim().toLowerCase() || undefined,
    passwordHash: hashPassword(pw),
    // Admin created the account — keep the plaintext so it can be shared back.
    passwordVisible: pw,
    name: input.name.trim(),
    phone,
    role: input.role,
    ...caps,
    locale: "en",
    walletBalance: 0,
    assignedSchemeIds: [],
    liftingProgressKg: 0,
    schemeProgress: {},
    active: true,
    approved: true,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  ensureStaffHrTerms(db, db.users);
  saveDb(db);
  return user;
}

/**
 * Create staff in shared cloud DB (preferred). Falls back to local-only
 * only when the cloud API is unavailable (503).
 */
export async function createStaffUserAsync(input: {
  name: string;
  phone: string;
  password: string;
  role: UserRole;
  email?: string;
  extraCapabilities?: Capability[];
  deniedCapabilities?: Capability[];
}): Promise<UserProfile> {
  const res = await fetch("/api/account/admin-create-user", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: "staff", ...input }),
  });
  const data = await readResponseJson<{
    user?: UserProfile;
    error?: string;
    message?: string;
  }>(res);
  if (res.status === 503) {
    // Offline / no cloud — local create + best-effort push
    const local = createStaffUser(input);
    try {
      const sb = await import("@/lib/supabase/sync");
      if (sb.supabaseSyncEnabled() || (await sb.detectSupabaseSync())) {
        const ok = await sb.pushCloudDatabase(loadDb());
        if (!ok) {
          throw new Error(
            "User saved on this device only — cloud sync failed. Check login and try again so other devices can see them."
          );
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("cloud sync")) throw err;
    }
    return local;
  }
  if (!res.ok || !data.user) {
    throw new Error(data.error || "Failed to create staff user");
  }
  try {
    const sb = await import("@/lib/supabase/sync");
    if (sb.supabaseSyncEnabled() || (await sb.detectSupabaseSync())) {
      const remote = await sb.pullCloudDatabase(loadDb());
      if (remote) {
        // Keep passwordVisible locally so admin can share credentials
        const idx = remote.users.findIndex((u) => u.id === data.user!.id);
        if (idx >= 0 && data.user.passwordVisible) {
          remote.users[idx] = {
            ...remote.users[idx],
            passwordVisible: data.user.passwordVisible,
          };
        }
        replaceDbFromCloud(remote);
      }
    } else {
      upsertUser({ ...data.user, passwordHash: data.user.passwordHash || "" });
    }
  } catch {
    upsertUser({ ...data.user, passwordHash: data.user.passwordHash || "" });
  }
  return data.user;
}

export async function createDealerUserAsync(input: {
  name: string;
  phone: string;
  password: string;
  company?: string;
  address?: string;
  pincode?: string;
  gstOrAadhar?: string;
  transport?: string;
  byAdminId: string;
}): Promise<UserProfile> {
  const res = await fetch("/api/account/admin-create-user", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "dealer",
      name: input.name,
      phone: input.phone,
      password: input.password,
      company: input.company,
      address: input.address,
      pincode: input.pincode,
      gstOrAadhar: input.gstOrAadhar,
      transport: input.transport,
    }),
  });
  const data = await readResponseJson<{
    user?: UserProfile;
    error?: string;
  }>(res);
  if (res.status === 503) {
    const local = createDealerUser(input);
    try {
      const sb = await import("@/lib/supabase/sync");
      if (sb.supabaseSyncEnabled() || (await sb.detectSupabaseSync())) {
        const ok = await sb.pushCloudDatabase(loadDb());
        if (!ok) {
          throw new Error(
            "Dealer saved on this device only — cloud sync failed. Other devices will not see them until sync works."
          );
        }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes("cloud sync")) throw err;
    }
    return local;
  }
  if (!res.ok || !data.user) {
    throw new Error(data.error || "Failed to create dealer");
  }
  try {
    const sb = await import("@/lib/supabase/sync");
    if (sb.supabaseSyncEnabled() || (await sb.detectSupabaseSync())) {
      const remote = await sb.pullCloudDatabase(loadDb());
      if (remote) {
        const idx = remote.users.findIndex((u) => u.id === data.user!.id);
        if (idx >= 0 && data.user.passwordVisible) {
          remote.users[idx] = {
            ...remote.users[idx],
            passwordVisible: data.user.passwordVisible,
          };
        }
        replaceDbFromCloud(remote);
      }
    } else {
      upsertUser({ ...data.user, passwordHash: "" });
    }
  } catch {
    upsertUser({ ...data.user, passwordHash: "" });
  }
  return data.user;
}

/**
 * Admin-side dealer creation. Auto-approved and active — no signup wait.
 * Stores plaintext `passwordVisible` so the admin can share the login
 * back with the dealer (only visible inside the admin UI).
 */
export function createDealerUser(input: {
  name: string;
  phone: string;
  password: string;
  company?: string;
  address?: string;
  pincode?: string;
  gstOrAadhar?: string;
  transport?: string;
  byAdminId: string;
}): UserProfile {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === input.byAdminId);
  if (!actor || !actorCan(actor, "manage_users", db)) {
    throw new Error("Only admins can create dealer accounts");
  }
  const phone = normalizePhone(input.phone);
  if (phone.length < 10) {
    throw new Error("Enter a valid 10-digit mobile number");
  }
  const pincode = (input.pincode || "").replace(/\D/g, "").slice(0, 6);
  if (pincode && pincode.length !== 6) {
    throw new Error("Enter a valid 6-digit pincode");
  }
  if (db.users.some((u) => phonesMatch(u.phone, phone))) {
    throw new Error("This phone number is already registered");
  }
  const pw = assertMinPassword(input.password);
  const user: UserProfile = {
    id: `user_${crypto.randomUUID()}`,
    passwordHash: hashPassword(pw),
    passwordVisible: pw,
    name: input.name.trim(),
    phone,
    company: input.company?.trim(),
    address: input.address?.trim(),
    pincode: pincode || undefined,
    gstOrAadhar: input.gstOrAadhar?.trim(),
    transport: input.transport?.trim(),
    role: "customer",
    locale: "en",
    walletBalance: 0,
    assignedSchemeIds: [],
    liftingProgressKg: 0,
    schemeProgress: {},
    active: true,
    approved: true,
    createdAt: new Date().toISOString(),
  };
  db.users.push(user);
  ensureCustomerParty(db, user);
  saveDb(db);
  return user;
}

/**
 * Reset a user's password. Records the plaintext so admin can share it back.
 * If the user later changes their own password, clear `passwordVisible` first.
 */
export function setUserPassword(
  userId: string,
  newPassword: string,
  byAdminId: string
): void {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === byAdminId);
  if (!actor || !actorCan(actor, "manage_users", db)) {
    throw new Error("Only admins can reset passwords");
  }
  const user = db.users.find((u) => u.id === userId);
  if (!user) throw new Error("User not found");
  const pw = assertMinPassword(newPassword);
  user.passwordHash = hashPassword(pw);
  user.passwordVisible = pw;
  delete user.passwordResetRequestedAt;
  saveDb(db);
}

async function refreshCloudAfterAccountWrite(overlay?: {
  userId: string;
  passwordVisible?: string;
}): Promise<void> {
  try {
    const sb = await import("@/lib/supabase/sync");
    if (sb.supabaseSyncEnabled() || (await sb.detectSupabaseSync())) {
      const remote = await sb.pullCloudDatabase(loadDb());
      if (!remote) return;
      if (overlay?.passwordVisible) {
        const idx = remote.users.findIndex((u) => u.id === overlay.userId);
        if (idx >= 0) {
          remote.users[idx] = {
            ...remote.users[idx],
            passwordVisible: overlay.passwordVisible,
            passwordResetRequestedAt: undefined,
          };
        }
      }
      replaceDbFromCloud(remote);
    }
  } catch {
    /* ignore */
  }
}

export async function changeOwnPasswordAsync(
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const pw = assertMinPassword(newPassword);
  const res = await fetch("/api/account/change-password", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ currentPassword, newPassword: pw }),
  });
  const data = await readResponseJson<{ error?: string }>(res);
  if (res.status === 503) {
    const session = getSession();
    if (!session) throw new Error("Login required");
    const db = loadDb();
    const user = db.users.find((u) => u.id === session.id);
    if (!user) throw new Error("User not found");
    if (user.passwordHash.startsWith("scrypt$")) {
      throw new Error("Cloud required to change this password. Try again.");
    }
    if (user.passwordHash !== hashPassword(currentPassword)) {
      throw new Error("Current password is incorrect");
    }
    user.passwordHash = hashPassword(pw);
    delete user.passwordVisible;
    delete user.passwordResetRequestedAt;
    saveDb(db);
    return;
  }
  if (!res.ok) {
    throw new Error(data.error || "Could not change password");
  }
  await refreshCloudAfterAccountWrite();
}

export async function requestPasswordResetAsync(
  phone: string,
  locale?: "en" | "hi"
): Promise<void> {
  const res = await fetch("/api/account/forgot-password", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone, locale }),
  });
  const data = await readResponseJson<{ error?: string }>(res);
  if (res.status === 503) {
    const db = loadDb();
    const user = db.users.find((u) => phonesMatch(u.phone, phone));
    if (user) {
      user.passwordResetRequestedAt = new Date().toISOString();
      saveDb(db);
    }
    return;
  }
  if (!res.ok) {
    throw new Error(data.error || "Could not send request");
  }
}

export async function setUserPasswordAsync(
  userId: string,
  newPassword: string,
  byAdminId: string
): Promise<string> {
  const pw = assertMinPassword(newPassword);
  const res = await fetch("/api/account/reset-password", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId, newPassword: pw }),
  });
  const data = await readResponseJson<{
    error?: string;
    user?: { passwordVisible?: string };
  }>(res);
  if (res.status === 503) {
    setUserPassword(userId, pw, byAdminId);
    return pw;
  }
  if (!res.ok) {
    throw new Error(data.error || "Reset failed");
  }
  const visible = data.user?.passwordVisible || pw;
  await refreshCloudAfterAccountWrite({
    userId,
    passwordVisible: visible,
  });
  return visible;
}

export function upsertScheme(scheme: Scheme): void {
  const db = loadDb();
  const liveWrite = actorWritesLiveCatalog(db);
  if (!liveWrite) {
    const existing = db.schemes.find((s) => s.id === scheme.id);
    if (schemesEffectivelyEqual(existing, scheme)) return;
    const actor = sessionActorMeta(db);
    const title = `Scheme · ${scheme.name?.en || scheme.id}`;
    db.ownerApprovals = upsertPendingApproval(db.ownerApprovals, {
      kind: "scheme_upsert",
      targetKey: schemeUpsertTargetKey(scheme.id),
      schemeId: scheme.id,
      title,
      snapshot: { before: existing ? structuredClone(existing) : undefined, proposed: scheme },
      requestedBy: actor.id,
      requestedByName: actor.name,
    });
    notifyOwnerApprovalQueued(db, title);
    saveDb(db);
    return;
  }
  const idx = db.schemes.findIndex((s) => s.id === scheme.id);
  if (idx >= 0) db.schemes[idx] = scheme;
  else db.schemes.unshift(scheme);
  saveDb(db);
}

/** Permanently remove a scheme and detach it from dealers. */
export function deleteScheme(schemeId: string): void {
  const db = loadDb();
  const existing = db.schemes.find((s) => s.id === schemeId);
  if (!existing) {
    throw new Error("Scheme not found");
  }
  if (!actorWritesLiveCatalog(db)) {
    const actor = sessionActorMeta(db);
    const title = `Delete scheme · ${existing.name?.en || schemeId}`;
    db.ownerApprovals = upsertPendingApproval(db.ownerApprovals, {
      kind: "scheme_delete",
      targetKey: schemeDeleteTargetKey(schemeId),
      schemeId,
      title,
      snapshot: { before: structuredClone(existing), proposed: { schemeId } },
      requestedBy: actor.id,
      requestedByName: actor.name,
    });
    notifyOwnerApprovalQueued(db, title);
    saveDb(db);
    return;
  }
  db.schemes = db.schemes.filter((s) => s.id !== schemeId);
  for (const user of db.users) {
    user.assignedSchemeIds = (user.assignedSchemeIds ?? []).filter(
      (id) => id !== schemeId
    );
    if (user.schemeProgress && schemeId in user.schemeProgress) {
      const next = { ...user.schemeProgress };
      delete next[schemeId];
      user.schemeProgress = next;
    }
    if (user.schemeValueProgress && schemeId in user.schemeValueProgress) {
      const next = { ...user.schemeValueProgress };
      delete next[schemeId];
      user.schemeValueProgress = next;
    }
  }
  saveDb(db);
}

export function assignSchemeToUser(userId: string, schemeId: string): void {
  const db = loadDb();
  const user = db.users.find((u) => u.id === userId);
  if (!user) throw new Error("User not found");
  if (user.assignedSchemeIds.includes(schemeId)) return;
  if (!actorWritesLiveCatalog(db)) {
    const actor = sessionActorMeta(db);
    const scheme = db.schemes.find((s) => s.id === schemeId);
    const title = `Assign · ${scheme?.name?.en || schemeId} → ${user.name || userId}`;
    db.ownerApprovals = upsertPendingApproval(db.ownerApprovals, {
      kind: "scheme_assign",
      targetKey: schemeAssignTargetKey(userId, schemeId),
      schemeId,
      dealerId: userId,
      title,
      snapshot: {
        before: { dealerId: userId, schemeId, assigned: false },
        proposed: { dealerId: userId, schemeId, assigned: true },
      },
      requestedBy: actor.id,
      requestedByName: actor.name,
    });
    notifyOwnerApprovalQueued(db, title);
    saveDb(db);
    return;
  }
  user.assignedSchemeIds.push(schemeId);
  saveDb(db);
}

export function decideOwnerApproval(
  approvalId: string,
  status: "approved" | "rejected",
  note?: string
): void {
  const db = loadDb();
  if (!actorWritesLiveCatalog(db)) {
    throw new Error("Only the owner can approve or reject");
  }
  const row = (db.ownerApprovals ?? []).find((r) => r.id === approvalId);
  if (!row || row.status !== "pending") {
    throw new Error("Approval not found");
  }
  if (status === "approved") applyOwnerApproval(db, row);
  const actor = sessionActorMeta(db);
  const now = new Date().toISOString();
  row.status = status;
  row.note = note?.trim() || row.note;
  row.decidedBy = actor.id;
  row.decidedAt = now;
  row.updatedAt = now;
  saveDb(db);
}

export function creditWallet(input: {
  userId: string;
  amount: number;
  reason: string;
  adminId: string;
  schemeId?: string;
  depositId?: string;
}): void {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === input.adminId);
  if (!actor || !actorCan(actor, "manage_wallet", db)) {
    throw new Error("Only admin can adjust wallet balance");
  }
  const user = db.users.find((u) => u.id === input.userId);
  if (!user) throw new Error("User not found");
  const amount = roundMoney(input.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw new Error("Enter a non-zero wallet amount");
  }
  const nextBalance = Math.max(0, roundMoney((user.walletBalance || 0) + amount));
  user.walletBalance = nextBalance;
  db.walletTransactions.push({
    id: `wt_${crypto.randomUUID()}`,
    userId: user.id,
    type: amount >= 0 ? "credit" : "debit",
    amount: Math.abs(amount),
    reason: input.reason?.trim() || (amount >= 0 ? "Wallet credit" : "Wallet debit"),
    schemeId: input.schemeId,
    depositId: input.depositId,
    createdAt: new Date().toISOString(),
    createdBy: input.adminId,
  });
  saveDb(db);
}

function nextDepositNumber(db: AppDatabase): string {
  const highest = (db.walletDeposits ?? []).reduce((max, d) => {
    const m = /WD-(\d+)/.exec(d.depositNumber || "");
    if (!m) return max;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > max ? n : max;
  }, 1000);
  return `WD-${highest + 1}`;
}

/** Dealer starts an advance wallet top-up — QR is shown for this amount. */
export function createWalletDeposit(input: {
  userId: string;
  amount: number;
  note?: string;
}): WalletDeposit {
  const db = loadDb();
  const user = db.users.find((u) => u.id === input.userId);
  if (!user) throw new Error("User not found");
  if (!user.active || user.approved !== true) {
    throw new Error("Account not active");
  }
  if (user.role !== "customer") {
    throw new Error("Only dealers can deposit to wallet");
  }
  const amount = roundMoney(input.amount);
  if (!Number.isFinite(amount) || amount < 1) {
    throw new Error("Enter at least ₹1 to deposit");
  }
  if (amount > 5000000) {
    throw new Error("Amount too large — contact admin");
  }
  if (!db.walletDeposits) db.walletDeposits = [];
  const open = db.walletDeposits.find(
    (d) =>
      d.userId === user.id &&
      (d.status === "awaiting_proof" || d.status === "pending_verify")
  );
  if (open) {
    throw new Error(
      "You already have an open deposit — finish or cancel it first"
    );
  }
  const now = new Date().toISOString();
  const deposit: WalletDeposit = {
    id: `wd_${crypto.randomUUID()}`,
    depositNumber: nextDepositNumber(db),
    userId: user.id,
    userName: user.name,
    userPhone: user.phone,
    amount,
    note: input.note?.trim() || undefined,
    status: "awaiting_proof",
    createdAt: now,
    updatedAt: now,
  };
  db.walletDeposits.unshift(deposit);
  saveDb(db);
  return deposit;
}

export function uploadWalletDepositProof(
  depositId: string,
  items: PaymentProofItem[],
  byUserId: string
): WalletDeposit {
  const db = loadDb();
  if (!db.walletDeposits) db.walletDeposits = [];
  const deposit = db.walletDeposits.find((d) => d.id === depositId);
  if (!deposit) throw new Error("Deposit not found");
  if (deposit.userId !== byUserId) throw new Error("Not allowed");
  if (deposit.status !== "awaiting_proof" && deposit.status !== "pending_verify") {
    throw new Error("Cannot upload proof on this deposit");
  }
  if (!items.length) throw new Error("Add at least one proof file");
  const now = new Date().toISOString();
  const existing = getProofItemsMerged(deposit.proof);
  const merged = [
    ...existing,
    ...items.map((it) => ({
      ...it,
      uploadedAt: it.uploadedAt || now,
      uploadedBy: it.uploadedBy || byUserId,
    })),
  ];
  deposit.proof = {
    items: merged,
    imageDataUrl: merged[merged.length - 1]?.url,
    note: merged[merged.length - 1]?.note,
    uploadedAt: deposit.proof?.uploadedAt || now,
    verified: false,
  };
  deposit.status = "pending_verify";
  deposit.updatedAt = now;
  saveDb(db);
  return deposit;
}

function getProofItemsMerged(
  proof: WalletDeposit["proof"]
): PaymentProofItem[] {
  if (!proof) return [];
  if (proof.items?.length) return [...proof.items];
  if (proof.imageDataUrl) {
    return [
      {
        id: "legacy",
        url: proof.imageDataUrl,
        type: /pdf/i.test(proof.imageDataUrl) ? "pdf" : "image",
        note: proof.note,
        uploadedAt: proof.uploadedAt,
      },
    ];
  }
  return [];
}

export function cancelWalletDeposit(
  depositId: string,
  byUserId: string
): WalletDeposit {
  const db = loadDb();
  const deposit = (db.walletDeposits ?? []).find((d) => d.id === depositId);
  if (!deposit) throw new Error("Deposit not found");
  const actor = db.users.find((u) => u.id === byUserId);
  const isStaff = !!actor && actorCan(actor, "manage_wallet", db);
  if (!isStaff && deposit.userId !== byUserId) throw new Error("Not allowed");
  if (deposit.status === "verified") {
    throw new Error("Verified deposits cannot be cancelled");
  }
  deposit.status = "cancelled";
  deposit.updatedAt = new Date().toISOString();
  saveDb(db);
  return deposit;
}

export function verifyWalletDeposit(
  depositId: string,
  adminId: string
): WalletDeposit {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === adminId);
  if (!actor || !actorCan(actor, "manage_wallet", db)) {
    throw new Error("Only admin can verify deposits");
  }
  const deposit = (db.walletDeposits ?? []).find((d) => d.id === depositId);
  if (!deposit) throw new Error("Deposit not found");
  if (deposit.status === "verified") return deposit;
  if (deposit.status !== "pending_verify" && deposit.status !== "awaiting_proof") {
    throw new Error("Deposit is not awaiting verification");
  }
  const items = getProofItemsMerged(deposit.proof);
  if (!items.length) {
    throw new Error("No payment proof uploaded yet");
  }
  const now = new Date().toISOString();
  deposit.status = "verified";
  deposit.verifiedAt = now;
  deposit.verifiedBy = adminId;
  deposit.updatedAt = now;
  if (deposit.proof) {
    deposit.proof.verified = true;
    deposit.proof.verifiedAt = now;
    deposit.proof.verifiedBy = adminId;
  }
  saveDb(db);

  // Credit wallet (separate save) — amount is always positive credit
  creditWallet({
    userId: deposit.userId,
    amount: deposit.amount,
    reason: `Advance deposit ${deposit.depositNumber}`,
    adminId,
    depositId: deposit.id,
  });
  return loadDb().walletDeposits.find((d) => d.id === depositId)!;
}

export function rejectWalletDeposit(
  depositId: string,
  adminId: string,
  reason?: string
): WalletDeposit {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === adminId);
  if (!actor || !actorCan(actor, "manage_wallet", db)) {
    throw new Error("Only admin can reject deposits");
  }
  const deposit = (db.walletDeposits ?? []).find((d) => d.id === depositId);
  if (!deposit) throw new Error("Deposit not found");
  if (deposit.status === "verified") {
    throw new Error("Verified deposits cannot be rejected");
  }
  const now = new Date().toISOString();
  deposit.status = "rejected";
  deposit.rejectedAt = now;
  deposit.rejectedBy = adminId;
  deposit.rejectReason = reason?.trim() || undefined;
  deposit.updatedAt = now;
  saveDb(db);
  return deposit;
}

export function pendingWalletDeposits(): WalletDeposit[] {
  const db = loadDb();
  return (db.walletDeposits ?? []).filter(
    (d) => d.status === "pending_verify" || d.status === "awaiting_proof"
  );
}

export function saveShippingRules(rules: ShippingRule[]): void {
  const db = loadDb();
  db.shippingRules = rules;
  saveDb(db);
}

export function saveSettings(settings: AppSettings): void {
  const db = loadDb();
  db.settings = settings;
  saveDb(db);
}

export function saveHomeMerchLists(input: {
  homeNewProductIds?: string[];
  homePromoProductIds?: string[];
}): void {
  const db = loadDb();
  if (input.homeNewProductIds !== undefined) {
    db.settings.homeNewProductIds = input.homeNewProductIds;
  }
  if (input.homePromoProductIds !== undefined) {
    db.settings.homePromoProductIds = input.homePromoProductIds;
  }
  saveDb(db);
}

/** Add/remove a product from home New / Promo lists. */
export function setProductHomePlacement(
  productId: string,
  flags: { homeNew: boolean; homePromo: boolean }
): void {
  const db = loadDb();
  let news = [...(db.settings.homeNewProductIds ?? [])];
  if (flags.homeNew) {
    if (!news.length) {
      news = fallbackNewProducts(db.products).map((p) => p.id);
    }
    news = toggleId(news, productId, true);
  } else {
    news = news.filter((id) => id !== productId);
  }
  db.settings.homeNewProductIds = news;
  db.settings.homePromoProductIds = toggleId(
    db.settings.homePromoProductIds ?? [],
    productId,
    flags.homePromo
  );
  saveDb(db);
}

/** Owner: set / clear period lock (inclusive YYYY-MM-DD). */
export function setPeriodLock(lockedThroughDate: string | null): void {
  const db = loadDb();
  if (lockedThroughDate) {
    db.settings.lockedThroughDate = lockedThroughDate.slice(0, 10);
  } else {
    delete db.settings.lockedThroughDate;
  }
  saveDb(db);
}

/** Owner: financial year start month (1–12). */
export function setFinancialYearStartMonth(month: number): void {
  const db = loadDb();
  db.settings.financialYearStartMonth = Math.min(12, Math.max(1, month || 4));
  saveDb(db);
}

/** Download accounting books as JSON and stamp booksBackupAt. */
export function downloadBooksBackup(): string {
  const db = loadDb();
  const payload = buildBooksBackupPayload(db);
  const json = JSON.stringify(payload, null, 2);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = `tt-books-backup-${stamp}.json`;
  if (typeof window !== "undefined") {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  db.settings.booksBackupAt = new Date().toISOString();
  saveDb(db);
  return name;
}

export function saveCategories(categories: CategoryDef[]): void {
  const db = loadDb();
  db.categories = categories;
  saveDb(db);
}

export function upsertCategory(category: CategoryDef): void {
  const db = loadDb();
  const i = db.categories.findIndex((c) => c.id === category.id);
  if (i >= 0) db.categories[i] = category;
  else db.categories.push(category);
  saveDb(db);
}

export function deleteCategory(categoryId: string): void {
  const db = loadDb();
  const inUse = db.products.some((p) => p.category === categoryId);
  if (inUse) throw new Error("Category is used by products");
  db.categories = db.categories.filter((c) => c.id !== categoryId);
  saveDb(db);
}

/* --- Accounting / ERP --- */

export function upsertAccount(account: Account): void {
  const db = loadDb();
  const i = db.accounts.findIndex((a) => a.id === account.id);
  if (i >= 0) db.accounts[i] = account;
  else db.accounts.push(account);
  saveDb(db);
}

/** Add another company bank: ledger in Cash/Bank book plus a dealer payment row. */
export function addCompanyBankAccount(input: NewCompanyBankInput): {
  account: Account;
  payable: BankAccountDetails;
} {
  const label =
    input.label.trim() ||
    input.bankName?.trim() ||
    input.accountName?.trim() ||
    "";
  if (!label) {
    throw new Error("Enter a bank name or nickname");
  }
  const db = loadDb();
  const drafted = draftCompanyBankAccount({
    ledgerId: `acct_bank_${crypto.randomUUID()}`,
    payableId: `bank_${crypto.randomUUID()}`,
    accounts: db.accounts,
    settings: db.settings,
    input: { ...input, label },
  });
  db.accounts.push(drafted.account);
  db.settings = { ...db.settings, bankAccounts: drafted.bankAccounts };
  saveDb(db);
  return { account: drafted.account, payable: drafted.payable };
}

export function upsertParty(party: Party): void {
  const db = loadDb();
  const i = db.parties.findIndex((p) => p.id === party.id);
  if (i >= 0) db.parties[i] = party;
  else db.parties.push(party);
  saveDb(db);
}

/** Set party opening balance and keep debtors/creditors + capital in sync. */
export function setPartyOpeningBalance(
  partyId: string,
  openingBalance: number
): Party {
  const db = loadDb();
  assertPeriodOpen(new Date().toISOString().slice(0, 10), db.settings);
  const party = db.parties.find((p) => p.id === partyId);
  if (!party) throw new Error("Party not found");
  party.openingBalance = roundMoney(Math.max(0, openingBalance));
  syncPartyControlOpenings(db.parties, db.accounts);
  rebalanceCapitalOpening(
    db.accounts,
    db.ledgerEntries,
    new Date().toISOString().slice(0, 10)
  );
  saveDb(db);
  return party;
}

function setPhysicalStock(
  product: Product,
  opts: {
    variationId?: string;
    colorId?: string;
    bundles: number;
    secondary: number;
  }
): void {
  ensureStockSecondary(product);
  const bundles = Math.max(0, opts.bundles);
  const secondary = Math.max(0, opts.secondary);
  if (opts.variationId && product.colors.length && opts.colorId) {
    setSizeColorStock(product, opts.variationId, opts.colorId, bundles);
  } else if (opts.variationId) {
    const v = product.variations.find((x) => x.id === opts.variationId);
    if (!v) throw new Error("Variation not found");
    v.stock = bundles;
    v.stockSecondary = secondary;
    product.stock = product.variations.reduce((s, x) => s + (x.stock || 0), 0);
    product.stockSecondary = product.variations.reduce(
      (s, x) => s + (x.stockSecondary ?? 0),
      0
    );
  } else {
    product.stock = bundles;
    product.stockSecondary = secondary;
  }
  product.updatedAt = new Date().toISOString();
}

export type OpeningStockLineInput = {
  productId: string;
  variationId?: string;
  colorId?: string;
  /** Bundles / packs */
  qty: number;
  /** kg or pcs — defaults from bundles × unit weight */
  secondaryQty?: number;
  /** Cost per secondary unit */
  rate: number;
};

/**
 * Opening stock with cost: FIFO layers + Dr Inventory / Cr Capital journal.
 * Sets physical stock to the entered qty for each line.
 */
export function importOpeningStock(input: {
  date: string;
  lines: OpeningStockLineInput[];
  createdBy: string;
  narration?: string;
  /** When true (default), set on-hand qty to these values */
  setPhysical?: boolean;
}): { voucher: Voucher; batchCount: number; totalValue: number } {
  const db = loadDb();
  const date = input.date.slice(0, 10);
  assertPeriodOpen(date, db.settings);
  const setPhysical = input.setPhysical !== false;
  db.stockBatches = db.stockBatches || [];

  const prepared: {
    product: Product;
    variationId?: string;
    colorId?: string;
    bundles: number;
    secondary: number;
    rate: number;
    label: string;
  }[] = [];

  for (const line of input.lines) {
    const product = db.products.find((p) => p.id === line.productId);
    if (!product) throw new Error("Product not found");
    ensureStockSecondary(product);
    const bundles = Math.max(0, line.qty);
    const secondary = deriveSecondaryQty(
      product,
      bundles,
      line.variationId,
      line.secondaryQty
    );
    if (secondary <= 0) continue;
    const rate = roundMoney(line.rate);
    if (rate < 0) throw new Error("Rate cannot be negative");
    const vLabel = line.variationId
      ? product.variations.find((v) => v.id === line.variationId)?.label.en
      : "";
    prepared.push({
      product,
      variationId: line.variationId,
      colorId: line.colorId,
      bundles,
      secondary,
      rate,
      label: vLabel
        ? `${product.name.en} · ${vLabel}`
        : product.name.en,
    });
  }
  if (!prepared.length) throw new Error("Add at least one stock line");

  const totalValue = roundMoney(
    prepared.reduce((s, l) => s + l.secondary * l.rate, 0)
  );

  // Remove leftover provisional opening layers for these SKUs (rate-0)
  for (const line of prepared) {
    db.stockBatches = db.stockBatches.filter((b) => {
      if (!b.provisional || b.source !== "opening" || b.rate > 0) return true;
      if (b.productId !== line.product.id) return true;
      if (b.variationId !== line.variationId) return true;
      if (line.colorId && b.colorId !== line.colorId) return true;
      return false;
    });
  }
  saveDb(db);

  let voucher: Voucher | null = null;
  if (totalValue > 0.001) {
    voucher = createVoucher({
      type: "journal",
      date,
      narration: input.narration?.trim() || `Opening stock ${date}`,
      createdBy: input.createdBy,
      skipInventory: true,
      lines: [
        {
          id: `vl_${crypto.randomUUID()}`,
          itemLabel: "Opening stock — Inventory",
          accountId: ACCT.inventory,
          qty: 1,
          rate: totalValue,
          amount: totalValue,
          taxPercent: 0,
        },
        {
          id: `vl_${crypto.randomUUID()}`,
          itemLabel: "Opening stock — Capital",
          accountId: ACCT.capital,
          qty: 1,
          rate: totalValue,
          amount: totalValue,
          taxPercent: -1,
        },
      ],
    });
  }

  const db2 = loadDb();
  db2.stockBatches = db2.stockBatches || [];
  let batchCount = 0;
  for (const line of prepared) {
    const product = db2.products.find((p) => p.id === line.product.id);
    if (!product) continue;
    if (setPhysical) {
      setPhysicalStock(product, {
        variationId: line.variationId,
        colorId: line.colorId,
        bundles: line.bundles,
        secondary: line.secondary,
      });
    }
    db2.stockBatches.push(
      createBatchFromLine({
        date,
        productId: line.product.id,
        variationId: line.variationId,
        colorId: line.colorId,
        qty: line.secondary,
        rate: line.rate,
        unit: product.unit,
        source: "opening",
        voucherId: voucher?.id,
        provisional: false,
      })
    );
    batchCount++;
    db2.stockMovements.unshift({
      id: `sm_${crypto.randomUUID()}`,
      date,
      type: "adjustment",
      productId: line.product.id,
      variationId: line.variationId,
      colorId: line.colorId,
      qty: line.bundles,
      secondaryQty: line.secondary,
      unit: product.unit,
      direction: "in",
      note: `Opening stock @ ${line.rate}`,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
    });
  }
  rebalanceCapitalOpening(db2.accounts, db2.ledgerEntries, date);
  saveDb(db2);

  const stub: Voucher = {
    id: voucher?.id || "",
    number: voucher?.number || "—",
    type: "journal",
    date,
    lines: voucher?.lines || [],
    subtotal: voucher?.subtotal || 0,
    taxAmount: voucher?.taxAmount || 0,
    total: totalValue,
    voided: false,
    createdAt: voucher?.createdAt || new Date().toISOString(),
    createdBy: input.createdBy,
  };
  return { voucher: stub, batchCount, totalValue };
}

/** Brought-forward unpaid bill — ages in receivables/payables, posts to Capital. */
export function importOutstandingBill(input: {
  partyId: string;
  type: "sale" | "purchase";
  date: string;
  dueDate?: string;
  amount: number;
  number?: string;
  narration?: string;
  createdBy: string;
}): Voucher {
  const amount = roundMoney(input.amount);
  if (amount <= 0) throw new Error("Amount must be greater than zero");
  const db = loadDb();
  const party = db.parties.find((p) => p.id === input.partyId);
  if (!party) throw new Error("Party not found");
  if (input.type === "sale" && party.type !== "customer") {
    throw new Error("Sale opening bill needs a customer");
  }
  if (input.type === "purchase" && party.type !== "supplier") {
    throw new Error("Purchase opening bill needs a supplier");
  }
  const v = createVoucher({
    type: input.type,
    date: input.date,
    dueDate: input.dueDate || input.date,
    partyId: input.partyId,
    isOpening: true,
    skipInventory: true,
    allowOverCredit: true,
    narration:
      input.narration?.trim() ||
      `Opening bill${input.number ? ` ${input.number}` : ""}`,
    createdBy: input.createdBy,
    lines: [
      {
        id: `vl_${crypto.randomUUID()}`,
        itemLabel: input.number?.trim() || "Opening balance bill",
        qty: 1,
        rate: amount,
        amount,
        taxPercent: 0,
      },
    ],
  });
  if (input.number?.trim()) {
    const db2 = loadDb();
    const row = db2.vouchers.find((x) => x.id === v.id);
    if (row) {
      row.number = input.number.trim();
      for (const e of db2.ledgerEntries) {
        if (e.voucherId === v.id) e.voucherNumber = row.number;
      }
      saveDb(db2);
      return row;
    }
  }
  return v;
}

export function importPartiesFromCsv(
  text: string,
  createdBy: string
): { created: number; updated: number } {
  void createdBy;
  const rows = parsePartyCsv(text);
  if (!rows.length) throw new Error("No party rows found in CSV");
  const db = loadDb();
  let created = 0;
  let updated = 0;
  for (const row of rows) {
    const phone = row.phone || "0000000000";
    const existing = db.parties.find(
      (p) =>
        p.name.toLowerCase() === row.name.toLowerCase() ||
        (row.phone && phonesMatch(p.phone, row.phone))
    );
    if (existing) {
      existing.openingBalance = roundMoney(Math.max(0, row.opening));
      if (row.gstin) existing.gstin = row.gstin;
      if (row.phone) existing.phone = phone;
      existing.type = row.type;
      existing.active = true;
      updated++;
    } else {
      db.parties.push({
        id: `party_${crypto.randomUUID()}`,
        name: row.name,
        phone,
        type: row.type,
        openingBalance: roundMoney(Math.max(0, row.opening)),
        gstin: row.gstin,
        active: true,
        createdAt: new Date().toISOString(),
      });
      created++;
    }
  }
  syncPartyControlOpenings(db.parties, db.accounts);
  rebalanceCapitalOpening(
    db.accounts,
    db.ledgerEntries,
    new Date().toISOString().slice(0, 10)
  );
  saveDb(db);
  return { created, updated };
}

export function importOpeningStockFromCsv(
  text: string,
  date: string,
  createdBy: string
): { batchCount: number; totalValue: number; unmatched: string[] } {
  const rows = parseStockCsv(text);
  if (!rows.length) throw new Error("No stock rows found in CSV");
  const db = loadDb();
  const unmatched: string[] = [];
  const lines: OpeningStockLineInput[] = [];
  for (const row of rows) {
    const product = findProductByLabel(db.products, row.product);
    if (!product) {
      unmatched.push(row.product);
      continue;
    }
    lines.push({
      productId: product.id,
      variationId: findVariationId(product, row.variation),
      qty: row.qty || 0,
      secondaryQty: row.secondaryQty,
      rate: row.rate,
    });
  }
  if (!lines.length) {
    throw new Error(
      unmatched.length
        ? `No matching products. Unmatched: ${unmatched.slice(0, 5).join(", ")}`
        : "No stock rows"
    );
  }
  const result = importOpeningStock({ date, lines, createdBy });
  return {
    batchCount: result.batchCount,
    totalValue: result.totalValue,
    unmatched,
  };
}

export function importOutstandingBillsFromCsv(
  text: string,
  createdBy: string
): { posted: number; unmatched: string[] } {
  const rows = parseBillCsv(text);
  if (!rows.length) throw new Error("No bill rows found in CSV");
  const unmatched: string[] = [];
  let posted = 0;
  for (const row of rows as BillCsvRow[]) {
    const db = loadDb();
    const party = db.parties.find(
      (p) =>
        p.name.toLowerCase() === row.party.toLowerCase() &&
        p.type === row.type
    ) || db.parties.find(
      (p) => p.name.toLowerCase() === row.party.toLowerCase()
    );
    if (!party) {
      unmatched.push(row.party);
      continue;
    }
    importOutstandingBill({
      partyId: party.id,
      type: row.type === "supplier" ? "purchase" : "sale",
      date: row.date,
      dueDate: row.dueDate,
      amount: row.amount,
      number: row.number || undefined,
      narration: row.note,
      createdBy,
    });
    posted++;
  }
  if (!posted && unmatched.length) {
    throw new Error(
      `No matching parties. Unmatched: ${unmatched.slice(0, 5).join(", ")}`
    );
  }
  return { posted, unmatched };
}

// Re-export CSV row types for UI
export type { PartyCsvRow, StockCsvRow, BillCsvRow };

export function saveStatementMatch(input: {
  id?: string;
  partyId: string;
  from: string;
  to: string;
  theirClosingBalance: number;
  matchedEntryIds: string[];
  theirExtraRows: StatementMatchExtra[];
  status?: StatementMatch["status"];
  createdBy: string;
}): StatementMatch {
  const db = loadDb();
  if (!db.statementMatches) db.statementMatches = [];
  const now = new Date().toISOString();
  const existing = input.id
    ? db.statementMatches.find((m) => m.id === input.id)
    : undefined;
  if (existing) {
    existing.from = input.from.slice(0, 10);
    existing.to = input.to.slice(0, 10);
    existing.theirClosingBalance = roundMoney(input.theirClosingBalance);
    existing.matchedEntryIds = [...input.matchedEntryIds];
    existing.theirExtraRows = structuredClone(input.theirExtraRows);
    existing.status = input.status || existing.status;
    existing.updatedAt = now;
    saveDb(db);
    return existing;
  }
  const row: StatementMatch = {
    id: `stm_${crypto.randomUUID()}`,
    partyId: input.partyId,
    from: input.from.slice(0, 10),
    to: input.to.slice(0, 10),
    theirClosingBalance: roundMoney(input.theirClosingBalance),
    matchedEntryIds: [...input.matchedEntryIds],
    theirExtraRows: structuredClone(input.theirExtraRows),
    status: input.status || "open",
    createdAt: now,
    updatedAt: now,
    createdBy: input.createdBy,
  };
  db.statementMatches.unshift(row);
  saveDb(db);
  return row;
}

export function saveBankRecon(input: {
  id?: string;
  accountId: string;
  asOf: string;
  statementBalance: number;
  clearedEntryIds: string[];
  extras: BankReconExtra[];
  status?: BankRecon["status"];
  updatedBy: string;
}): BankRecon {
  const db = loadDb();
  if (!db.bankRecons) db.bankRecons = [];
  const now = new Date().toISOString();
  const asOf = input.asOf.slice(0, 10);
  const existing = input.id
    ? db.bankRecons.find((m) => m.id === input.id)
    : db.bankRecons.find(
        (m) => m.accountId === input.accountId && m.asOf === asOf
      );
  if (existing) {
    existing.statementBalance = roundMoney(input.statementBalance);
    existing.clearedEntryIds = [...input.clearedEntryIds];
    existing.extras = structuredClone(input.extras);
    existing.status = input.status || existing.status;
    existing.updatedAt = now;
    existing.updatedBy = input.updatedBy;
    saveDb(db);
    return existing;
  }
  const row: BankRecon = {
    id: `brs_${crypto.randomUUID()}`,
    accountId: input.accountId,
    asOf,
    statementBalance: roundMoney(input.statementBalance),
    clearedEntryIds: [...input.clearedEntryIds],
    extras: structuredClone(input.extras),
    status: input.status || "open",
    updatedAt: now,
    updatedBy: input.updatedBy,
  };
  db.bankRecons.unshift(row);
  saveDb(db);
  return row;
}

export function createVoucher(input: {
  type: VoucherType;
  date: string;
  partyId?: string;
  narration?: string;
  lines: VoucherLine[];
  cashAccountId?: string;
  linkedOrderId?: string;
  linkedInvoiceId?: string;
  linkedPurchaseId?: string;
  linkedPoId?: string;
  linkedGrnId?: string;
  linkedPaymentProofItemId?: string;
  dueDate?: string;
  packingSlipDataUrl?: string;
  packingSlipName?: string;
  createdBy: string;
  /** Skip inventory (e.g. summary-only line without products) */
  skipInventory?: boolean;
  /** Brought-forward bill — Capital, no stock/FIFO/P&L */
  isOpening?: boolean;
  /** Bill-wise allocations for receipt/payment */
  allocations?: { invoiceVoucherId: string; amount: number }[];
  /** Allow sale even if over credit limit */
  allowOverCredit?: boolean;
  /** GRNI this purchase bill clears */
  grniAmount?: number;
}): Voucher {
  const db = loadDb();
  assertPeriodOpen(input.date, db.settings);
  assertPriorMonthAudited(input.date, db);
  if (input.linkedOrderId && input.type === "sale") {
    const exists = db.vouchers.some(
      (v) =>
        v.linkedOrderId === input.linkedOrderId &&
        v.type === "sale" &&
        !v.voided
    );
    if (exists) throw new Error("A sales voucher already exists for this order");
  }
  // Walk-in purchase: force open-contract rates when available
  let lines = input.lines;
  if (
    input.type === "purchase" &&
    input.partyId &&
    !input.linkedGrnId
  ) {
    lines = input.lines.map((l) => {
      if (!l.productId) return l;
      const contract = resolveOpenContract(
        db.supplierContracts,
        db.products,
        input.partyId!,
        l.productId,
        input.date.slice(0, 10),
        { variationId: l.variationId }
      );
      if (!contract) return l;
      const secondaryQty = l.secondaryQty ?? l.qty;
      const rate = contract.rate;
      return {
        ...l,
        rate,
        amount: roundMoney(secondaryQty * rate),
      };
    });
  }

  const totals = summarizeLines(lines);
  // Receipt / payment / expense: store rounded amount on the line so both
  // sides of the entry match the nearest-rupee total with no Round Off row.
  if (
    (input.type === "receipt" || input.type === "payment") &&
    Math.abs(totals.roundOff) >= 0.005 &&
    lines.length === 1
  ) {
    const rounded = totals.total;
    lines = [
      {
        ...lines[0],
        qty: 1,
        secondaryQty: 1,
        rate: rounded,
        amount: rounded,
        taxPercent: 0,
      },
    ];
  }
  const finalTotalsRaw = summarizeLines(lines);
  // Journals stay exact as entered — do not force nearest-rupee.
  const finalTotals =
    input.type === "journal"
      ? {
          ...finalTotalsRaw,
          total: finalTotalsRaw.exactTotal,
          roundOff: 0,
        }
      : finalTotalsRaw;
  if (finalTotals.total <= 0 && input.type !== "journal") {
    throw new Error("Voucher total must be greater than zero");
  }

  if (
    input.type === "sale" &&
    input.partyId &&
    !input.allowOverCredit &&
    !input.isOpening
  ) {
    const party = db.parties.find((p) => p.id === input.partyId);
    if (party?.creditLimit) {
      const recv = partyBalance(party, db.ledgerEntries);
      const check = creditLimitBreach(party, recv, finalTotals.total);
      if (!check.ok) {
        throw new Error(
          `Credit limit exceeded by ₹${check.overBy}. Enable override to continue.`
        );
      }
    }
  }

  if (input.type === "credit_note") {
    if (!input.linkedInvoiceId) {
      throw new Error("Credit note must link to a sales invoice");
    }
    const inv = db.vouchers.find((v) => v.id === input.linkedInvoiceId);
    if (!inv || inv.type !== "sale" || inv.voided) {
      throw new Error("Invalid sales invoice for credit note");
    }
    const open = refreshInvoiceOutstanding(
      inv,
      db.vouchers,
      db.billAllocations
    );
    if (finalTotals.total > open + 0.02) {
      throw new Error(
        `Credit note ₹${finalTotals.total} exceeds invoice outstanding ₹${open}`
      );
    }
  }
  if (input.type === "debit_note") {
    if (!input.linkedPurchaseId) {
      throw new Error("Debit note must link to a purchase bill");
    }
    const inv = db.vouchers.find((v) => v.id === input.linkedPurchaseId);
    if (!inv || inv.type !== "purchase" || inv.voided) {
      throw new Error("Invalid purchase bill for debit note");
    }
    const open = refreshInvoiceOutstanding(
      inv,
      db.vouchers,
      db.billAllocations
    );
    if (finalTotals.total > open + 0.02) {
      throw new Error(
        `Debit note ₹${finalTotals.total} exceeds bill outstanding ₹${open}`
      );
    }
  }

  const skipInventory =
    !!input.skipInventory ||
    !!input.isOpening ||
    (input.type === "purchase" && !!input.linkedGrnId);

  const voucher: Voucher = {
    id: `vch_${crypto.randomUUID()}`,
    number: input.isOpening
      ? `OPN-${nextVoucherNumber(db.vouchers, input.type).replace(/^[A-Z]+-/, "")}`
      : nextVoucherNumber(db.vouchers, input.type),
    type: input.type,
    date: input.date.slice(0, 10),
    partyId: input.partyId,
    narration: input.narration?.trim(),
    lines,
    subtotal: finalTotals.subtotal,
    taxAmount: finalTotals.taxAmount,
    roundOff: finalTotals.roundOff,
    total: finalTotals.total,
    cashAccountId: input.cashAccountId,
    linkedOrderId: input.linkedOrderId,
    linkedInvoiceId: input.linkedInvoiceId,
    linkedPurchaseId: input.linkedPurchaseId,
    linkedPoId: input.linkedPoId,
    linkedGrnId: input.linkedGrnId,
    grniAmount: input.grniAmount,
    linkedPaymentProofItemId: input.linkedPaymentProofItemId,
    dueDate: input.dueDate?.slice(0, 10) || input.date.slice(0, 10),
    outstanding:
      input.type === "sale" || input.type === "purchase"
        ? finalTotals.total
        : undefined,
    packingSlipDataUrl: input.packingSlipDataUrl,
    packingSlipName: input.packingSlipName,
    inventorySkipped: skipInventory,
    isOpening: input.isOpening || undefined,
    voided: false,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
  };

  // FIFO costing BEFORE ledger entries
  db.stockBatches = db.stockBatches || [];
  db.batchConsumptions = db.batchConsumptions || [];

  if (input.isOpening) {
    // Opening bills: no FIFO, no stock — ledger posts to Capital
  } else if (input.type === "purchase") {
    if (input.linkedGrnId) {
      // Stock layers already created as provisional on GRN — price them now
      priceProvisionalLayersForGrn(
        db.stockBatches,
        input.linkedGrnId,
        voucher
      );
    } else {
      addPurchaseLayers(db.stockBatches, voucher);
    }
  } else if (input.type === "sale") {
    // Free-form sales must have physical stock; order-linked may already be reserved
    const freeFormSale = !input.linkedOrderId && !skipInventory;
    if (freeFormSale) {
      assertSaleVoucherStockAvailable(db, lines);
    }
    const saleLines = voucher.lines
      .filter((l) => l.productId)
      .map((l) => ({
        productId: l.productId!,
        variationId: l.variationId,
        colorId: l.colorId,
        qty: lineMeasure(l),
      }));
    if (saleLines.length > 0) {
      ensureCostLayersForDemand(db.stockBatches, saleLines, voucher.date);
      const fifoResult = consumeFifo(db.stockBatches, db.batchConsumptions, {
        voucherId: voucher.id,
        date: voucher.date,
        lines: saleLines,
        allowShortfall: !freeFormSale,
      });
      voucher.cogsAmount = fifoResult.totalCost;
    }
  } else if (input.type === "credit_note") {
    // Sales return: add layers at line rate
    for (const line of voucher.lines) {
      if (!line.productId) continue;
      const measure = lineMeasure(line);
      if (measure <= 0) continue;
      db.stockBatches.push(
        createBatchFromLine({
          date: voucher.date,
          productId: line.productId,
          variationId: line.variationId,
          colorId: line.colorId,
          qty: measure,
          rate: line.rate,
          unit: line.unit,
          source: "sale_return",
          voucherId: voucher.id,
        })
      );
    }
    // Calculate cost for reversal (use line rate × qty as approximation)
    voucher.cogsAmount = roundMoney(
      voucher.lines.reduce((sum, l) => {
        const measure = lineMeasure(l);
        return sum + (l.productId ? measure * l.rate : 0);
      }, 0)
    );
  } else if (input.type === "debit_note") {
    // Purchase return: consume layers
    const debitLines = voucher.lines
      .filter((l) => l.productId)
      .map((l) => ({
        productId: l.productId!,
        variationId: l.variationId,
        colorId: l.colorId,
        qty: lineMeasure(l),
      }));
    if (debitLines.length > 0) {
      consumeFifo(db.stockBatches, db.batchConsumptions, {
        voucherId: voucher.id,
        date: voucher.date,
        lines: debitLines,
        allowShortfall: false,
      });
    }
  }

  const entries = buildLedgerEntries(voucher);
  db.vouchers.unshift(voucher);
  db.ledgerEntries.push(...entries);
  if (!skipInventory) {
    applyVoucherStock(db, voucher, input.createdBy, false);
  }

  // Walk-in purchase (no GRN / PO link): consume supplier contract qty/₹
  if (
    input.type === "purchase" &&
    !input.linkedGrnId &&
    !input.linkedPoId &&
    input.partyId
  ) {
    for (const line of lines) {
      if (!line.productId) continue;
      const contract = resolveOpenContract(
        db.supplierContracts,
        db.products,
        input.partyId,
        line.productId,
        voucher.date,
        { variationId: line.variationId }
      );
      if (contract) {
        const qty = line.secondaryQty ?? line.qty;
        applyContractUsage(contract, qty, line.rate || contract.rate);
        line.contractId = contract.id;
      }
    }
  }

  if (
    (input.type === "receipt" || input.type === "payment") &&
    input.allocations?.length
  ) {
    const allocSum = roundMoney(
      input.allocations.reduce((s, a) => s + a.amount, 0)
    );
    if (allocSum > finalTotals.total + 0.02) {
      throw new Error("Allocations exceed receipt/payment amount");
    }
    for (const a of input.allocations) {
      if (a.amount <= 0) continue;
      const inv = db.vouchers.find((v) => v.id === a.invoiceVoucherId);
      if (!inv || inv.voided) throw new Error("Invalid invoice for allocation");
      const open = refreshInvoiceOutstanding(
        inv,
        db.vouchers,
        db.billAllocations
      );
      if (a.amount > open + 0.02) {
        throw new Error(
          `Allocation for ${inv.number} exceeds outstanding ₹${open}`
        );
      }
      db.billAllocations.push({
        id: `ba_${crypto.randomUUID()}`,
        receiptOrPaymentVoucherId: voucher.id,
        invoiceVoucherId: a.invoiceVoucherId,
        amount: roundMoney(a.amount),
        date: voucher.date,
      });
      refreshInvoiceOutstanding(inv, db.vouchers, db.billAllocations);
    }
  }

  if (input.type === "credit_note" && input.linkedInvoiceId) {
    const inv = db.vouchers.find((v) => v.id === input.linkedInvoiceId);
    if (inv) refreshInvoiceOutstanding(inv, db.vouchers, db.billAllocations);
  }
  if (input.type === "debit_note" && input.linkedPurchaseId) {
    const inv = db.vouchers.find((v) => v.id === input.linkedPurchaseId);
    if (inv) refreshInvoiceOutstanding(inv, db.vouchers, db.billAllocations);
  }

  if (input.linkedPoId && input.type === "purchase") {
    syncPoStatus(db, input.linkedPoId);
  }

  saveDb(db);
  return voucher;
}

/**
 * Apply leftover (on-account) of an existing receipt to other open sale bills.
 * Does not create a new voucher. Leftover not listed stays on-account.
 */
export function applyReceiptAllocations(
  receiptId: string,
  allocations: { invoiceVoucherId: string; amount: number }[],
  _byUserId: string
): void {
  const db = loadDb();
  const receipt = db.vouchers.find((v) => v.id === receiptId);
  if (!receipt || receipt.voided) throw new Error("Receipt not found");
  if (receipt.type !== "receipt") throw new Error("Not a receipt");
  if (!receipt.partyId) throw new Error("Receipt has no party");

  const merged = new Map<string, number>();
  for (const a of allocations) {
    const amt = roundMoney(a.amount);
    if (amt <= 0.009) continue;
    merged.set(
      a.invoiceVoucherId,
      roundMoney((merged.get(a.invoiceVoucherId) || 0) + amt)
    );
  }
  if (!merged.size) throw new Error("Nothing to apply");

  const existing = db.billAllocations.filter(
    (a) => a.receiptOrPaymentVoucherId === receiptId
  );
  const existingSum = roundMoney(existing.reduce((s, a) => s + a.amount, 0));
  const addSum = roundMoney(
    [...merged.values()].reduce((s, a) => s + a, 0)
  );
  if (existingSum + addSum > receipt.total + 0.02) {
    throw new Error("Allocations exceed receipt amount");
  }

  const today = new Date().toISOString().slice(0, 10);
  const touched = new Set<string>();

  for (const [invoiceVoucherId, amount] of merged) {
    const inv = db.vouchers.find((v) => v.id === invoiceVoucherId);
    if (!inv || inv.voided) throw new Error("Invalid invoice for allocation");
    if (inv.type !== "sale") throw new Error("Can only apply to sale invoices");
    if (inv.partyId !== receipt.partyId) {
      throw new Error("Invoice is for a different party");
    }
    const open = refreshInvoiceOutstanding(
      inv,
      db.vouchers,
      db.billAllocations
    );
    if (amount > open + 0.02) {
      throw new Error(
        `Allocation for ${inv.number} exceeds outstanding ₹${open}`
      );
    }
    const row = existing.find((x) => x.invoiceVoucherId === invoiceVoucherId);
    if (row) {
      row.amount = roundMoney(row.amount + amount);
    } else {
      db.billAllocations.push({
        id: `ba_${crypto.randomUUID()}`,
        receiptOrPaymentVoucherId: receiptId,
        invoiceVoucherId,
        amount,
        date: receipt.date || today,
      });
    }
    touched.add(inv.id);
  }

  for (const id of touched) {
    const inv = db.vouchers.find((v) => v.id === id);
    if (inv) refreshInvoiceOutstanding(inv, db.vouchers, db.billAllocations);
  }
  saveDb(db);
}

export function voidVoucher(voucherId: string, voidedBy = "system"): void {
  const db = loadDb();
  const v = db.vouchers.find((x) => x.id === voucherId);
  if (!v) throw new Error("Voucher not found");
  if (v.voided) throw new Error("Already voided");
  assertPeriodOpen(v.date, db.settings);
  v.voided = true;
  v.voidedAt = new Date().toISOString();
  v.voidedBy = voidedBy;

  // Reverse FIFO costing
  reverseVoucherCosting(db.stockBatches, db.batchConsumptions, voucherId);

  for (const e of db.ledgerEntries) {
    if (e.voucherId === voucherId) e.voided = true;
  }
  // Remove allocations tied to this receipt/payment
  db.billAllocations = db.billAllocations.filter(
    (a) => a.receiptOrPaymentVoucherId !== voucherId
  );
  // Only reverse inventory if this voucher originally moved stock
  if (!v.inventorySkipped) {
    applyVoucherStock(db, v, "system", true);
  }

  // Walk-in purchase void: put contract qty/₹ back
  if (
    v.type === "purchase" &&
    !v.linkedGrnId &&
    !v.linkedPoId &&
    v.partyId
  ) {
    for (const line of v.lines) {
      if (!line.productId) continue;
      const target = line.contractId
        ? db.supplierContracts.find((c) => c.id === line.contractId)
        : undefined;
      if (!target) continue;
      reverseContractUsage(
        target,
        line.secondaryQty ?? line.qty,
        line.rate || target.rate
      );
    }
  }

  if (v.linkedInvoiceId) {
    const inv = db.vouchers.find((x) => x.id === v.linkedInvoiceId);
    if (inv) refreshInvoiceOutstanding(inv, db.vouchers, db.billAllocations);
  }
  if (v.linkedPurchaseId) {
    const inv = db.vouchers.find((x) => x.id === v.linkedPurchaseId);
    if (inv) refreshInvoiceOutstanding(inv, db.vouchers, db.billAllocations);
  }
  if (v.type === "sale" || v.type === "purchase") {
    v.outstanding = 0;
  }
  if (v.type === "purchase" && v.linkedGrnId) {
    reaccrueGrniAfterVoidedBill(db, v, voidedBy);
  }
  // Refresh invoices that had allocations from this voucher
  for (const inv of db.vouchers) {
    if (inv.type === "sale" || inv.type === "purchase") {
      refreshInvoiceOutstanding(inv, db.vouchers, db.billAllocations);
    }
  }
  saveDb(db);
}

export function attachPackingSlip(
  voucherId: string,
  file: { dataUrl: string; name?: string }
): Voucher {
  const db = loadDb();
  const v = db.vouchers.find((x) => x.id === voucherId);
  if (!v) throw new Error("Voucher not found");
  const ok =
    v.type === "sale" ||
    v.type === "purchase" ||
    v.type === "payment" ||
    v.type === "journal";
  if (!ok) {
    throw new Error("Attachment not allowed for this voucher type");
  }
  v.packingSlipDataUrl = file.dataUrl;
  v.packingSlipName = file.name || "bill-photo";
  saveDb(db);
  return v;
}

/** Cash/bank expense — Dr expense head / Cr cash or bank. */
export function recordExpense(input: {
  accountId: string;
  amount: number;
  date: string;
  cashAccountId: string;
  narration?: string;
  packingSlipDataUrl?: string;
  packingSlipName?: string;
  createdBy: string;
}): Voucher {
  const amount = roundMoney(input.amount);
  if (amount <= 0) throw new Error("Amount must be greater than zero");
  const db = loadDb();
  const head = db.accounts.find((a) => a.id === input.accountId && a.active);
  if (!head || head.type !== "expense") {
    throw new Error("Pick a valid expense head");
  }
  if (!isCashBankAccount(
    db.accounts.find((a) => a.id === input.cashAccountId) || {
      id: input.cashAccountId,
      type: "asset",
      name: { en: "" },
    }
  )) {
    throw new Error("Pay from Cash or a Bank account");
  }
  return createVoucher({
    type: "payment",
    date: input.date,
    cashAccountId: input.cashAccountId,
    narration: input.narration?.trim() || head.name.en,
    packingSlipDataUrl: input.packingSlipDataUrl,
    packingSlipName: input.packingSlipName,
    createdBy: input.createdBy,
    skipInventory: true,
    lines: [
      {
        id: `vl_${crypto.randomUUID()}`,
        itemLabel: head.name.en,
        accountId: head.id,
        qty: 1,
        rate: amount,
        amount,
        taxPercent: 0,
      },
    ],
  });
}

export type StockAdjustInput = {
  productId: string;
  variationId?: string;
  colorId?: string;
  /** Bundles */
  qty: number;
  /** kg or pcs — auto from bundles × unit weight if omitted */
  secondaryQty?: number;
  direction: "in" | "out";
  note?: string;
  createdBy: string;
};

function applyStockAdjust(db: AppDatabase, input: StockAdjustInput): void {
  const product = db.products.find((p) => p.id === input.productId);
  if (!product) throw new Error("Product not found");
  ensureStockSecondary(product);
  const bundles = input.qty;
  const secondary = deriveSecondaryQty(
    product,
    bundles,
    input.variationId,
    input.secondaryQty
  );
  const bDelta = input.direction === "in" ? bundles : -bundles;

  if (input.variationId && product.colors.length && input.colorId) {
    const cur = getSizeColorStock(product, input.variationId, input.colorId);
    setSizeColorStock(
      product,
      input.variationId,
      input.colorId,
      cur + bDelta
    );
  } else if (input.variationId) {
    const v = product.variations.find((x) => x.id === input.variationId);
    if (!v) throw new Error("Variation not found");
    v.stock = Math.max(0, (v.stock || 0) + bDelta);
    v.stockSecondary = deriveSecondaryQty(product, v.stock, v.id);
    product.stock = product.variations.reduce((s, x) => s + (x.stock || 0), 0);
    product.stockSecondary = product.variations.reduce(
      (s, x) => s + (x.stockSecondary ?? 0),
      0
    );
  } else {
    product.stock = Math.max(0, (product.stock || 0) + bDelta);
    product.stockSecondary = Math.max(
      0,
      (product.stockSecondary ?? 0) +
        (input.direction === "in" ? secondary : -secondary)
    );
  }
  product.updatedAt = new Date().toISOString();
  const movementId = `sm_${crypto.randomUUID()}`;
  db.stockMovements.unshift({
    id: movementId,
    date: new Date().toISOString().slice(0, 10),
    type: "adjustment",
    productId: input.productId,
    variationId: input.variationId,
    colorId: input.colorId,
    qty: bundles,
    secondaryQty: secondary,
    unit: product.unit,
    direction: input.direction,
    note: input.note || "Manual adjustment",
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
  });

  // FIFO costing for adjustments
  if (input.direction === "in" && secondary > 0) {
    db.stockBatches.push(
      createBatchFromLine({
        date: new Date().toISOString().slice(0, 10),
        productId: input.productId,
        variationId: input.variationId,
        colorId: input.colorId,
        qty: secondary,
        rate: 0,
        unit: product.unit,
        source: "adjustment",
        provisional: true,
      })
    );
  } else if (input.direction === "out" && secondary > 0) {
    const fifo = consumeFifo(db.stockBatches, db.batchConsumptions, {
      voucherId: `adj_${movementId}`,
      date: new Date().toISOString().slice(0, 10),
      lines: [
        {
          productId: input.productId,
          variationId: input.variationId,
          colorId: input.colorId,
          qty: secondary,
        },
      ],
      allowShortfall: false,
    });
    if (fifo.totalCost > 0.009) {
      const journal = postBalancedJournal(db, {
        date: new Date().toISOString().slice(0, 10),
        narration: input.note?.trim() || `Write-off ${product.name.en}`,
        createdBy: input.createdBy,
        legs: [
          {
            accountId: ACCT.wastage,
            debit: fifo.totalCost,
            itemLabel: product.name.en,
          },
          {
            accountId: ACCT.inventory,
            credit: fifo.totalCost,
            itemLabel: product.name.en,
          },
        ],
      });
      for (const c of db.batchConsumptions) {
        if (c.voucherId === `adj_${movementId}`) c.voucherId = journal.id;
      }
    }
  }
}

export function adjustStock(input: StockAdjustInput): void {
  const db = loadDb();
  assertPeriodOpen(new Date().toISOString().slice(0, 10), db.settings);
  applyStockAdjust(db, input);
  saveDb(db);
}

/** Apply many adjustments in one save — used by the multi-row stock editor. */
export function adjustStockBatch(inputs: StockAdjustInput[]): number {
  if (!inputs.length) return 0;
  const db = loadDb();
  assertPeriodOpen(new Date().toISOString().slice(0, 10), db.settings);
  for (const input of inputs) applyStockAdjust(db, input);
  saveDb(db);
  return inputs.length;
}

function asProductionDb(db: AppDatabase) {
  if (!db.boms) db.boms = [];
  if (!db.jobCards) db.jobCards = [];
  return db as AppDatabase & {
    boms: NonNullable<AppDatabase["boms"]>;
    jobCards: NonNullable<AppDatabase["jobCards"]>;
  };
}

export function upsertBom(input: Parameters<typeof upsertBomOn>[1]) {
  const db = loadDb();
  const bom = upsertBomOn(asProductionDb(db), input);
  saveDb(db);
  return bom;
}

export function createJobCard(input: Parameters<typeof createJobCardOn>[1]) {
  const db = loadDb();
  const job = createJobCardOn(asProductionDb(db), input);
  saveDb(db);
  return job;
}

export function issueJobCard(jobId: string, createdBy: string) {
  const db = loadDb();
  const job = issueJobCardOn(asProductionDb(db), jobId, createdBy);
  saveDb(db);
  return job;
}

export function completeJobCard(input: {
  jobId: string;
  actualQty?: number;
  actuals?: { id?: string; actualQty: number }[];
  createdBy: string;
}) {
  const db = loadDb();
  const job = completeJobCardOn(asProductionDb(db), input);
  saveDb(db);
  return job;
}

export function orderJobMaterials(jobId: string, createdBy: string) {
  const db = loadDb();
  const result = orderJobMaterialsOn(asProductionDb(db), jobId, createdBy);
  saveDb(db);
  return result;
}

export function cancelIssuedJobCard(jobId: string, createdBy: string) {
  const db = loadDb();
  const job = cancelIssuedJobCardOn(asProductionDb(db), jobId, createdBy);
  saveDb(db);
  return job;
}

export function clockStaffPunch(input: {
  userId: string;
  kind: HrPunch["kind"];
  lat?: number;
  lng?: number;
  accuracyM?: number;
  photoUrl?: string;
  userAgent?: string;
  gpsFallback?: boolean;
  at?: string;
  skipKindGuard?: boolean;
  correctedBy?: string;
  note?: string;
}): HrPunch {
  const db = loadDb();
  ensureHrAuditCollections(db);
  const at = input.at || new Date().toISOString();
  const month = dateInIst(at).slice(0, 7);
  if (
    isHrMonthLocked({
      month,
      userId: input.userId,
      audits: db.monthlyAudits,
      payslips: db.hrPayslips,
    })
  ) {
    throw new Error("Payroll locked for this month");
  }
  if (!input.skipKindGuard) {
    const guard = punchKindGuard(db.hrPunches ?? [], input.userId, input.kind, at);
    if (guard === "duplicate_in") throw new Error("Already clocked in today");
    if (guard === "duplicate_out") throw new Error("Already clocked out today");
    if (guard === "out_without_in") throw new Error("Clock in before clocking out");
  }
  const terms = (db.hrTerms ?? []).find((t) => t.userId === input.userId);
  const punch = buildHrPunch({
    ...input,
    at,
    sites: db.hrSites ?? [],
    siteIds: terms?.siteIds,
  });
  if (terms?.requireSelfie && input.kind === "in" && !input.photoUrl) {
    throw new Error("Selfie required to clock in");
  }
  db.hrPunches = [punch, ...(db.hrPunches ?? [])];
  saveDb(db);
  return punch;
}

export function startMonthCounts(month: string, startedBy: string): void {
  const db = loadDb();
  ensureCountCollections(db);
  const hasStock = (db.stockCounts ?? []).some(
    (c) => c.month === month && c.status === "draft"
  );
  if (!hasStock) {
    db.stockCounts = [
      startStockCountSession({
        month,
        startedBy,
        products: db.products ?? [],
      }),
      ...(db.stockCounts ?? []),
    ];
  }
  const hasCash = (db.cashCounts ?? []).some(
    (c) => c.month === month && c.status === "draft"
  );
  if (!hasCash) {
    db.cashCounts = [
      startCashCountSession({
        month,
        startedBy,
        accounts: db.accounts ?? [],
        ledgerEntries: db.ledgerEntries ?? [],
      }),
      ...(db.cashCounts ?? []),
    ];
  }
  saveDb(db);
}

export function approveStockCountLines(input: {
  countId: string;
  lineIds: string[];
  actor: UserProfile;
  ctx?: Parameters<typeof canEnterPhysicalCount>[1];
}): number {
  const db = loadDb();
  if (!userHasCapability(input.actor, "view_financials", input.ctx)) {
    throw new Error("Only the owner can post count shortages to stock");
  }
  const session = (db.stockCounts ?? []).find((c) => c.id === input.countId);
  if (!session) throw new Error("Count session not found");
  const adjs = adjustmentsFromApprovedLines(
    session,
    input.lineIds,
    input.actor.id
  );
  assertPeriodOpen(new Date().toISOString().slice(0, 10), db.settings);
  const posted = new Map<string, string>();
  for (const adj of adjs) {
    applyStockAdjust(db, {
      productId: adj.productId,
      variationId: adj.variationId,
      colorId: adj.colorId,
      qty: adj.qty,
      direction: adj.direction,
      note: adj.note,
      createdBy: adj.createdBy,
    });
    const mov = db.stockMovements[0];
    if (mov) posted.set(adj.lineId, mov.id);
  }
  const want = new Set(input.lineIds);
  session.lines = session.lines.map((l) =>
    want.has(l.id)
      ? {
          ...l,
          ownerDecision: posted.has(l.id) ? "approved" : l.ownerDecision,
          postedMovementId: posted.get(l.id) || l.postedMovementId,
        }
      : l
  );
  session.status = "owner_reviewed";
  session.updatedAt = new Date().toISOString();
  saveDb(db);
  return adjs.length;
}

export function canEnterPhysicalCountNow(
  session: { id: string; role: UserRole } | null | undefined,
  db: AppDatabase | null
): boolean {
  if (!session || !db) return false;
  const actor = db.users.find((u) => u.id === session.id);
  return canEnterPhysicalCount(actor || { role: session.role }, {
    rolePresets: db.rolePresets,
    staffJobs: db.staffJobs,
  });
}

export function createSaleVoucherFromOrder(
  orderId: string,
  createdBy: string,
  taxPercent = 0
): Voucher {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  if (order.status === "cancelled") {
    throw new Error("Order is cancelled");
  }
  const billAmount = order.actualBillAmount ?? 0;
  // Need a billed amount — do not wait for status (estimate + billNow / failed auto-post)
  if (!(billAmount > 0) && order.status === "estimate") {
    throw new Error("Order is not ready for a sales voucher");
  }
  if (!(billAmount > 0) && !(order.estimatedTotal > 0)) {
    throw new Error("Order has no bill amount");
  }
  const existing = db.vouchers.find(
    (v) => v.linkedOrderId === order.id && v.type === "sale" && !v.voided
  );
  if (existing) return existing;

  let party = db.parties.find(
    (p) => p.linkedUserId === order.userId && p.type === "customer"
  );
  if (!party) {
    // Fallback: match by phone / name among customers
    const user = db.users.find((u) => u.id === order.userId);
    const phone = (order.phone || user?.phone || "").trim();
    if (phone) {
      party = db.parties.find(
        (p) => p.type === "customer" && p.active && p.phone === phone
      );
    }
  }
  if (!party) {
    const user = db.users.find((u) => u.id === order.userId);
    party = {
      id: `party_${crypto.randomUUID()}`,
      name: order.checkoutName || order.userName,
      phone: order.phone || user?.phone || "",
      type: "customer",
      linkedUserId: order.userId,
      openingBalance: 0,
      address: order.deliveryAddress,
      pincode: user?.pincode,
      gstin: order.gstOrAadhar,
      active: true,
      createdAt: new Date().toISOString(),
    };
    db.parties.push(party);
    saveDb(db);
  } else if (!party.linkedUserId) {
    party.linkedUserId = order.userId;
    saveDb(db);
  }

  const amount = billAmount > 0 ? billAmount : order.estimatedTotal;
  let lines = linesFromOrderProducts(order.lines);
  const lineSum = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
  const targetNet =
    taxPercent > 0
      ? roundMoney(amount / (1 + taxPercent / 100))
      : amount;

  // Keep product lines for inventory; if bill differs, scale amounts but keep qty
  if (lines.length && Math.abs(lineSum - targetNet) > 1 && lineSum > 0) {
    const factor = targetNet / lineSum;
    lines = lines.map((l) => ({
      ...l,
      amount: roundMoney(l.amount * factor),
      rate: l.qty ? roundMoney((l.amount * factor) / l.qty) : l.rate,
      taxPercent,
    }));
  } else if (taxPercent > 0) {
    for (const l of lines) l.taxPercent = taxPercent;
  }

  if (!lines.length) {
    lines = [
      {
        id: `vl_${crypto.randomUUID()}`,
        itemLabel: `Order ${order.orderNumber}`,
        qty: 1,
        rate: amount,
        amount: amount,
        taxPercent,
      },
    ];
  }

  // Skip voucher stock only when estimate actually reserved stock.
  // If the flag is set but no reserve movement exists, deduct now.
  const hasReserveMovement = db.stockMovements.some(
    (m) =>
      m.orderId === order.id &&
      m.type === "estimate_reserve" &&
      m.direction === "out"
  );
  const skipInventory = !!order.stockReserved && hasReserveMovement;

  const billDate = (
    order.billUploadedAt ||
    order.updatedAt ||
    new Date().toISOString()
  ).slice(0, 10);

  return createVoucher({
    type: "sale",
    date: billDate,
    dueDate: saleDueDate(billDate, party.creditDays),
    partyId: party.id,
    narration: `Auto sale from order ${order.orderNumber}`,
    lines,
    linkedOrderId: order.id,
    createdBy,
    skipInventory,
    allowOverCredit: !!order.allowOverCredit,
  });
}

/** Receipt when payment verified — one bank receipt per proof item (not combined). */
export function createReceiptFromOrder(
  orderId: string,
  createdBy: string
): Voucher {
  const receipts = syncOrderPaymentReceipts(orderId, createdBy);
  if (receipts.length) return receipts[receipts.length - 1]!;
  const any = loadDb().vouchers.find(
    (v) => v.linkedOrderId === orderId && v.type === "receipt" && !v.voided
  );
  if (any) return any;
  throw new Error("Nothing to receipt");
}

/**
 * Post Bank Dr / Debtors Cr for each payment-proof item with an amount.
 * Legacy combined receipts (no linkedPaymentProofItemId) are split when
 * multiple part-payments exist.
 */
export function syncOrderPaymentReceipts(
  orderId: string,
  createdBy: string
): Voucher[] {
  const db = loadDb();
  const order = db.orders.find((o) => o.id === orderId);
  if (!order) throw new Error("Order not found");
  const sale = db.vouchers.find(
    (v) => v.linkedOrderId === orderId && v.type === "sale" && !v.voided
  );
  if (!sale) throw new Error("Create sales voucher first");
  const partyId = sale.partyId;
  if (!partyId) throw new Error("Sale has no party");

  const proofItems = getProofItems(order.paymentProof);
  const due = paymentAmountDue(order);
  const payable: { id: string; amount: number; at: string }[] = [];
  for (const it of proofItems) {
    const amt =
      typeof it.amount === "number" && Number.isFinite(it.amount)
        ? Math.max(0, roundMoney(it.amount))
        : 0;
    if (amt > 0) {
      payable.push({
        id: it.id,
        amount: amt,
        at: (it.uploadedAt || order.paymentProof?.uploadedAt || "").slice(0, 10),
      });
    }
  }
  // Legacy single proof without per-item amounts → one receipt for due
  if (!payable.length && proofItems.length) {
    const paid = proofPaidTotal(order.paymentProof);
    const bankAmount =
      paid > 0
        ? paid
        : due > 0
          ? due
          : Math.max(
              0,
              (order.actualBillAmount ?? sale.total) - (order.walletUsed || 0)
            );
    if (bankAmount > 0) {
      payable.push({
        id: proofItems[0]!.id,
        amount: bankAmount,
        at: (proofItems[0]!.uploadedAt || "").slice(0, 10),
      });
    }
  }

  // Split legacy combined receipt(s) when part-payments are tracked per item
  const legacyCombined = db.vouchers.filter(
    (v) =>
      v.linkedOrderId === orderId &&
      v.type === "receipt" &&
      !v.voided &&
      !v.linkedPaymentProofItemId
  );
  if (legacyCombined.length) {
    if (payable.length > 1) {
      for (const leg of legacyCombined) {
        voidVoucher(leg.id, createdBy);
      }
    } else if (payable.length === 1) {
      const snap = loadDb();
      const tagged = snap.vouchers.find((v) => v.id === legacyCombined[0]!.id);
      if (tagged && !tagged.voided) {
        tagged.linkedPaymentProofItemId = payable[0]!.id;
        saveDb(snap);
      }
    }
  }

  const created: Voucher[] = [];
  for (const pay of payable) {
    const snap = loadDb();
    const already = snap.vouchers.find(
      (v) =>
        !v.voided &&
        v.type === "receipt" &&
        v.linkedPaymentProofItemId === pay.id
    );
    if (already) {
      created.push(already);
      continue;
    }

    const saleNow = snap.vouchers.find((v) => v.id === sale.id)!;
    const open = refreshInvoiceOutstanding(
      saleNow,
      snap.vouchers,
      snap.billAllocations
    );
    const allocAmt = Math.min(pay.amount, open);
    const date =
      pay.at && /^\d{4}-\d{2}-\d{2}$/.test(pay.at)
        ? pay.at
        : new Date().toISOString().slice(0, 10);

    const receipt = createVoucher({
      type: "receipt",
      date,
      partyId,
      narration: `Payment on order ${order.orderNumber}${
        pay.id !== "legacy" ? ` · proof ${pay.id.slice(0, 8)}` : ""
      }`,
      lines: [
        {
          id: `vl_${crypto.randomUUID()}`,
          itemLabel: `Receipt ${order.orderNumber}`,
          qty: 1,
          rate: pay.amount,
          amount: pay.amount,
        },
      ],
      cashAccountId: ACCT.bank,
      linkedOrderId: orderId,
      linkedPaymentProofItemId: pay.id,
      createdBy,
      skipInventory: true,
      allocations:
        allocAmt > 0
          ? [{ invoiceVoucherId: sale.id, amount: allocAmt }]
          : undefined,
    });
    created.push(receipt);
  }

  // Clear wallet portion of the sale so debtors don't stay inflated.
  const wallet = Math.max(0, order.walletUsed || 0);
  if (wallet > 0) {
    const alreadyCn = loadDb().vouchers.find(
      (v) =>
        v.linkedOrderId === orderId &&
        v.type === "credit_note" &&
        !v.voided &&
        (v.narration || "").toLowerCase().includes("wallet")
    );
    if (!alreadyCn) {
      try {
        createVoucher({
          type: "credit_note",
          date: new Date().toISOString().slice(0, 10),
          partyId,
          linkedInvoiceId: sale.id,
          linkedOrderId: orderId,
          narration: `Wallet applied on order ${order.orderNumber}`,
          lines: [
            {
              id: `vl_${crypto.randomUUID()}`,
              itemLabel: `Wallet credit ${order.orderNumber}`,
              qty: 1,
              rate: wallet,
              amount: wallet,
            },
          ],
          createdBy,
          skipInventory: true,
        });
      } catch {
        /* ok — books may already be settled */
      }
    }
  }

  return created;
}

/**
 * Repair common books gaps: missing sales for billed orders, party openings,
 * cancelled orders that still have live sale vouchers, and per-item receipts.
 */
export function repairBooksIntegrity(createdBy = "system"): {
  salesCreated: number;
  salesFailed: string[];
  receiptsSynced: number;
  cancelledVoided: number;
  openingsSynced: boolean;
} {
  const db = loadDb();
  syncPartyControlOpenings(db.parties, db.accounts);
  rebalanceCapitalOpening(
    db.accounts,
    db.ledgerEntries,
    new Date().toISOString().slice(0, 10)
  );
  const cancelledVoid = voidBooksForCancelledOrders(db, createdBy);
  saveDb(db);

  let salesCreated = 0;
  const salesFailed: string[] = [];
  const billed = db.orders.filter(
    (o) =>
      o.status !== "cancelled" &&
      o.actualBillAmount != null &&
      o.actualBillAmount > 0
  );
  for (const order of billed) {
    const hasPost = (loadDb().tallyPosts ?? []).some(
      (p) => p.orderId === order.id && p.kind === "sale" && p.status !== "failed"
    );
    if (hasPost) continue;
    try {
      enqueueTallySaleFromOrder(order.id);
      salesCreated += 1;
    } catch (err) {
      salesFailed.push(
        `${order.orderNumber || order.id}: ${
          err instanceof Error ? err.message : "failed"
        }`
      );
    }
  }

  let receiptsSynced = 0;
  const payOrders = loadDb().orders.filter(
    (o) =>
      o.status !== "cancelled" &&
      o.paymentProof?.verified &&
      (o.actualBillAmount ?? 0) > 0
  );
  for (const order of payOrders) {
    try {
      const before = loadDb().vouchers.filter(
        (v) =>
          v.linkedOrderId === order.id && v.type === "receipt" && !v.voided
      ).length;
      syncOrderPaymentReceipts(order.id, createdBy);
      const after = loadDb().vouchers.filter(
        (v) =>
          v.linkedOrderId === order.id && v.type === "receipt" && !v.voided
      ).length;
      receiptsSynced += Math.max(0, after - before);
    } catch {
      /* sale missing or period lock */
    }
  }

  return {
    salesCreated,
    salesFailed,
    receiptsSynced,
    cancelledVoided: cancelledVoid.voidedNumbers.length,
    openingsSynced: true,
  };
}

function nextPoNumber(orders: PurchaseOrder[]): string {
  let max = 1000;
  for (const o of orders) {
    const n = Number(o.number.replace(/\D/g, ""));
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `PO-${max + 1}`;
}

function nextGrnNumber(receipts: GoodsReceipt[]): string {
  let max = 1000;
  for (const g of receipts) {
    const n = Number(g.number.replace(/\D/g, ""));
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `GRN-${max + 1}`;
}

function postGrniAccrual(
  db: AppDatabase,
  grn: GoodsReceipt,
  supplierId: string,
  createdBy: string
): void {
  const accrued = roundMoney(grn.accruedAmount || 0);
  if (!(accrued > 0.009)) return;
  const accrual = postBalancedJournal(db, {
    date: grn.date,
    narration: `GRNI ${grn.number}`,
    createdBy,
    partyId: supplierId,
    linkedGrnId: grn.id,
    legs: [
      { accountId: ACCT.inventory, debit: accrued, itemLabel: grn.number },
      { accountId: ACCT.grni, credit: accrued, itemLabel: grn.number },
    ],
  });
  grn.accrualVoucherId = accrual.id;
  grn.accruedAmount = accrued;
}

function reaccrueGrniAfterVoidedBill(
  db: AppDatabase,
  bill: Voucher,
  voidedBy: string
): void {
  const grnId = bill.linkedGrnId;
  if (!grnId) return;
  const grn = db.goodsReceipts.find((g) => g.id === grnId);
  if (!grn || grn.voided) return;
  const po = db.purchaseOrders.find(
    (p) => p.id === (bill.linkedPoId || grn.poId)
  );
  if (po) {
    for (const line of grn.lines) {
      const poLine = po.lines.find((x) => x.id === line.poLineId);
      if (poLine) {
        poLine.billedQty = roundMoney(
          Math.max(0, (poLine.billedQty ?? 0) - line.qty)
        );
      }
    }
    syncPoStatus(db, po.id);
  }
  const stillBilled = db.vouchers.some(
    (x) =>
      x.id !== bill.id &&
      x.type === "purchase" &&
      !x.voided &&
      x.linkedGrnId === grn.id
  );
  if (stillBilled) return;
  if (!((grn.accruedAmount || 0) > 0.009)) return;
  const existing = grn.accrualVoucherId
    ? db.vouchers.find((x) => x.id === grn.accrualVoucherId)
    : undefined;
  if (existing && !existing.voided) return;
  postGrniAccrual(db, grn, po?.supplierId || bill.partyId || "", voidedBy);
}

function syncPoStatus(db: AppDatabase, poId: string): void {
  const po = db.purchaseOrders.find((p) => p.id === poId);
  if (!po || po.status === "cancelled") return;
  let allReceived = true;
  let anyReceived = false;
  let allBilled = true;
  for (const l of po.lines) {
    const recv = l.receivedQty ?? 0;
    const billed = l.billedQty ?? 0;
    if (recv < l.qty) allReceived = false;
    if (recv > 0) anyReceived = true;
    if (billed < l.qty) allBilled = false;
  }
  if (allBilled && anyReceived) po.status = "billed";
  else if (allReceived) po.status = "received";
  else if (anyReceived) po.status = "partial";
  else if (po.status === "draft") po.status = "draft";
  else po.status = "ordered";
}

export function createPurchaseOrder(input: {
  supplierId: string;
  date: string;
  lines: PurchaseOrderLine[];
  narration?: string;
  createdBy: string;
  status?: PurchaseOrder["status"];
  /** Staff goods-received: keep rate 0, do not pull contract rates */
  skipContractRates?: boolean;
}): PurchaseOrder {
  const db = loadDb();
  const lines = input.lines.map((l) => {
    const contract = input.skipContractRates
      ? null
      : resolveOpenContract(
          db.supplierContracts,
          db.products,
          input.supplierId,
          l.productId,
          input.date,
          { contractId: l.contractId, variationId: l.variationId }
        );
    const rate = contract ? contract.rate : l.rate;
    const secondaryQty = l.secondaryQty ?? l.qty;
    return {
      ...l,
      rate,
      contractId: contract?.id,
      amount: roundMoney(secondaryQty * rate),
      receivedQty: l.receivedQty ?? 0,
      billedQty: l.billedQty ?? 0,
    };
  });
  const po: PurchaseOrder = {
    id: `po_${crypto.randomUUID()}`,
    number: nextPoNumber(db.purchaseOrders),
    supplierId: input.supplierId,
    date: input.date.slice(0, 10),
    status: input.status || "ordered",
    lines,
    narration: input.narration?.trim(),
    total: roundMoney(lines.reduce((s, l) => s + l.amount, 0)),
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
  };
  db.purchaseOrders.unshift(po);
  saveDb(db);
  return po;
}

/** Draft POs from reorder alerts — one PO per preferred supplier. */
export function createDraftPosFromStockAlerts(
  createdBy: string,
  opts?: { minQty?: number; rowKeys?: string[] }
): PurchaseOrder[] {
  const db = loadDb();
  let rows = undefined as ReturnType<typeof stockAlertsFromDb> | undefined;
  if (opts?.rowKeys?.length) {
    const want = new Set(opts.rowKeys);
    rows = stockAlertsFromDb(db)
      .filter((r) => r.kind === "reorder")
      .filter((r) =>
        want.has(`${r.productId}|${r.variationId ?? ""}|${r.colorId ?? ""}`)
      );
  }
  const created = buildDraftPosFromAlerts(db, createdBy, {
    minQty: opts?.minQty,
    rows,
  });
  saveDb(db);
  return created;
}

export function markPurchaseOrderOrdered(
  poId: string,
  byUserId: string
): PurchaseOrder {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === byUserId);
  if (
    !actor ||
    (!actorCan(actor, "manage_reorder", db) &&
      !actorCan(actor, "manage_accounts", db))
  ) {
    throw new Error("Not allowed to confirm purchase orders");
  }
  const po = db.purchaseOrders.find((p) => p.id === poId);
  if (!po) throw new Error("PO not found");
  Object.assign(po, confirmDraftPurchaseOrder(po));
  saveDb(db);
  return po;
}

export function updateDraftPurchaseOrder(
  poId: string,
  byUserId: string,
  patch: { lines?: PurchaseOrder["lines"]; narration?: string }
): PurchaseOrder {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === byUserId);
  if (
    !actor ||
    (!actorCan(actor, "manage_reorder", db) &&
      !actorCan(actor, "manage_accounts", db))
  ) {
    throw new Error("Not allowed to edit purchase orders");
  }
  const po = db.purchaseOrders.find((p) => p.id === poId);
  if (!po) throw new Error("PO not found");
  if (po.status !== "draft") {
    throw new Error("Only draft purchase orders can be edited");
  }
  if (patch.lines) {
    po.lines = patch.lines
      .filter((l) => l.qty > 0)
      .map((l) => ({
        ...l,
        amount: roundMoney((Number(l.qty) || 0) * (Number(l.rate) || 0)),
      }));
    po.total = roundMoney(po.lines.reduce((s, l) => s + l.amount, 0));
  }
  if (patch.narration !== undefined) po.narration = patch.narration;
  saveDb(db);
  return po;
}

export function cancelPurchaseOrder(
  poId: string,
  byUserId: string
): PurchaseOrder {
  const db = loadDb();
  const actor = db.users.find((u) => u.id === byUserId);
  if (
    !actor ||
    (!actorCan(actor, "manage_reorder", db) &&
      !actorCan(actor, "manage_accounts", db))
  ) {
    throw new Error("Not allowed to cancel purchase orders");
  }
  const po = db.purchaseOrders.find((p) => p.id === poId);
  if (!po) throw new Error("PO not found");
  Object.assign(po, cancelDraftPurchaseOrder(po));
  saveDb(db);
  return po;
}

export function createGoodsReceipt(input: {
  poId: string;
  date: string;
  lines: GoodsReceiptLine[];
  narration?: string;
  packingSlipDataUrl?: string;
  packingSlipName?: string;
  createdBy: string;
}): GoodsReceipt {
  const db = loadDb();
  assertPeriodOpen(input.date, db.settings);
  const po = db.purchaseOrders.find((p) => p.id === input.poId);
  if (!po) throw new Error("PO not found");
  if (po.status === "cancelled") throw new Error("PO cancelled");

  for (const line of input.lines) {
    const poLine = po.lines.find((l) => l.id === line.poLineId);
    if (!poLine) throw new Error("Invalid PO line");
    const already = poLine.receivedQty ?? 0;
    if (already + line.qty > poLine.qty + 0.001) {
      throw new Error(`GRN qty exceeds PO for ${poLine.itemLabel}`);
    }
  }

  const grn: GoodsReceipt = {
    id: `grn_${crypto.randomUUID()}`,
    number: nextGrnNumber(db.goodsReceipts),
    poId: input.poId,
    date: input.date.slice(0, 10),
    lines: input.lines,
    packingSlipDataUrl: input.packingSlipDataUrl,
    packingSlipName: input.packingSlipName,
    narration: input.narration?.trim(),
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
    voided: false,
  };
  db.goodsReceipts.unshift(grn);
  for (const line of grn.lines) {
    const poLine = po.lines.find((l) => l.id === line.poLineId);
    if (poLine) {
      poLine.receivedQty = roundMoney((poLine.receivedQty ?? 0) + line.qty);
    }
    const productId = line.productId || poLine?.productId;
    const qtyUnit = line.secondaryQty ?? line.qty;
    const contract = resolveOpenContract(
      db.supplierContracts,
      db.products,
      po.supplierId,
      productId,
      grn.date,
      {
        contractId: poLine?.contractId,
        variationId: line.variationId || poLine?.variationId,
      }
    );
    if (contract) {
      applyContractUsage(
        contract,
        qtyUnit,
        poLine?.rate || contract.rate
      );
    }
  }
  applyGrnStock(db, grn, input.createdBy, false);

  // FIFO layers — accrue at PO/contract rate when known; else rate 0 until priced
  db.stockBatches = db.stockBatches || [];
  let accrued = 0;
  for (const line of grn.lines) {
    const poLine = po.lines.find((l) => l.id === line.poLineId);
    const productId = line.productId || poLine?.productId;
    if (!productId) continue;
    const product = db.products.find((p) => p.id === productId);
    const measure = product
      ? deriveSecondaryQty(
          product,
          line.qty > 0 ? line.qty : 1,
          line.variationId || poLine?.variationId,
          line.secondaryQty
        )
      : line.secondaryQty ?? line.qty;
    if (measure <= 0) continue;
    const contract = resolveOpenContract(
      db.supplierContracts,
      db.products,
      po.supplierId,
      productId,
      grn.date,
      {
        contractId: poLine?.contractId,
        variationId: line.variationId || poLine?.variationId,
      }
    );
    const rate = roundMoney(
      (poLine?.rate && poLine.rate > 0 ? poLine.rate : 0) ||
        (contract?.rate && contract.rate > 0 ? contract.rate : 0)
    );
    if (rate > 0) accrued = roundMoney(accrued + measure * rate);
    db.stockBatches.push(
      createBatchFromLine({
        date: grn.date,
        productId,
        variationId: line.variationId || poLine?.variationId,
        colorId: line.colorId || poLine?.colorId,
        qty: measure,
        rate,
        unit: line.unit || poLine?.unit || product?.unit,
        source: "grn",
        grnId: grn.id,
        provisional: true,
      })
    );
  }
  if (accrued > 0.009) {
    grn.accruedAmount = accrued;
    postGrniAccrual(db, grn, po.supplierId, input.createdBy);
  }

  syncPoStatus(db, po.id);
  saveDb(db);
  return grn;
}

/**
 * Void a goods receipt: reverse stock, contract usage, PO receivedQty and
 * provisional FIFO layers. Refuses when a purchase bill is linked or when
 * GRN batch layers have already been consumed.
 */
export function voidGoodsReceipt(grnId: string, voidedBy = "system"): void {
  const db = loadDb();
  const grn = db.goodsReceipts.find((g) => g.id === grnId);
  if (!grn) throw new Error("Goods receipt not found");
  if (grn.voided) throw new Error("Already voided");

  const billed = (db.vouchers ?? []).some(
    (v) => v.type === "purchase" && !v.voided && v.linkedGrnId === grn.id
  );
  if (billed) {
    throw new Error("Void the purchase bill first, then void this GRN");
  }

  db.stockBatches = db.stockBatches || [];
  db.batchConsumptions = db.batchConsumptions || [];
  const grnBatchIds = new Set(
    db.stockBatches.filter((b) => b.grnId === grn.id).map((b) => b.id)
  );
  if (grnBatchIds.size) {
    const consumed = db.batchConsumptions.some((c) =>
      grnBatchIds.has(c.batchId)
    );
    if (consumed) {
      throw new Error(
        "Cannot void — stock from this GRN was already sold (FIFO consumed)"
      );
    }
  }

  const po = db.purchaseOrders.find((p) => p.id === grn.poId);
  if (po) {
    for (const line of grn.lines) {
      const poLine = po.lines.find((l) => l.id === line.poLineId);
      if (poLine) {
        poLine.receivedQty = roundMoney(
          Math.max(0, (poLine.receivedQty ?? 0) - line.qty)
        );
      }
      const productId = line.productId || poLine?.productId;
      const qtyUnit = line.secondaryQty ?? line.qty;
      const contract = resolveOpenContract(
        db.supplierContracts,
        db.products,
        po.supplierId,
        productId,
        grn.date,
        {
          contractId: poLine?.contractId,
          variationId: line.variationId || poLine?.variationId,
        }
      );
      if (contract) {
        reverseContractUsage(
          contract,
          qtyUnit,
          poLine?.rate || contract.rate
        );
      }
    }
  }

  applyGrnStock(db, grn, voidedBy, true);
  db.stockBatches = db.stockBatches.filter((b) => b.grnId !== grn.id);
  if (grn.accrualVoucherId) {
    voidJournalOn(db, grn.accrualVoucherId, voidedBy);
  }

  grn.voided = true;
  grn.voidedAt = new Date().toISOString();
  grn.voidedBy = voidedBy;

  if (po) syncPoStatus(db, po.id);
  saveDb(db);
}

/**
 * Staff walk-in: receive goods with packing slip. Creates a rate-less PO + GRN
 * behind the scenes — staff never see "purchase order".
 */
export function recordGoodsReceived(input: {
  supplierId: string;
  date: string;
  lines: {
    productId?: string;
    variationId?: string;
    colorId?: string;
    itemLabel: string;
    qty: number;
    secondaryQty?: number;
    unit?: UnitOfSale;
  }[];
  narration?: string;
  packingSlipDataUrl?: string;
  packingSlipName?: string;
  createdBy: string;
}): { po: PurchaseOrder; grn: GoodsReceipt } {
  const cleaned = input.lines.filter(
    (l) => l.itemLabel.trim() && (l.qty > 0 || (l.secondaryQty ?? 0) > 0)
  );
  if (!input.supplierId) throw new Error("Select a supplier");
  if (!cleaned.length) throw new Error("Add at least one item");

  const poLines: PurchaseOrderLine[] = cleaned.map((l) => {
    const qty = l.qty > 0 ? l.qty : 1;
    const secondaryQty = l.secondaryQty ?? qty;
    return {
      id: `pol_${crypto.randomUUID()}`,
      productId: l.productId,
      variationId: l.variationId,
      colorId: l.colorId,
      itemLabel: l.itemLabel.trim(),
      qty,
      secondaryQty,
      unit: l.unit,
      rate: 0,
      amount: 0,
      receivedQty: 0,
      billedQty: 0,
    };
  });

  const po = createPurchaseOrder({
    supplierId: input.supplierId,
    date: input.date,
    lines: poLines,
    narration: input.narration || "Goods received",
    createdBy: input.createdBy,
    status: "ordered",
    skipContractRates: true,
  });

  const grnLines: GoodsReceiptLine[] = po.lines.map((pl) => ({
    id: `grnl_${crypto.randomUUID()}`,
    poLineId: pl.id,
    productId: pl.productId,
    variationId: pl.variationId,
    colorId: pl.colorId,
    itemLabel: pl.itemLabel,
    qty: pl.qty,
    secondaryQty: pl.secondaryQty,
    unit: pl.unit,
  }));

  const grn = createGoodsReceipt({
    poId: po.id,
    date: input.date,
    lines: grnLines,
    narration: input.narration,
    packingSlipDataUrl: input.packingSlipDataUrl,
    packingSlipName: input.packingSlipName,
    createdBy: input.createdBy,
  });

  // Flush immediately so a cloud poll cannot wipe GRN stock mid-debounce
  void import("@/lib/supabase/sync")
    .then(async (m) => {
      if (m.supabaseSyncEnabled() || (await m.detectSupabaseSync())) {
        await m.flushPushCloudDatabase(loadDb());
      }
    })
    .catch(() => {
      /* ignore */
    });

  return { po, grn };
}

/** GRNs that have stock in but no purchase bill yet. */
export function listUnpricedGoodsReceipts(db: AppDatabase): {
  grn: GoodsReceipt;
  po: PurchaseOrder;
  supplierName: string;
}[] {
  const billed = new Set(
    (db.vouchers ?? [])
      .filter((v) => v.type === "purchase" && !v.voided && v.linkedGrnId)
      .map((v) => v.linkedGrnId as string)
  );
  const out: {
    grn: GoodsReceipt;
    po: PurchaseOrder;
    supplierName: string;
  }[] = [];
  for (const grn of db.goodsReceipts ?? []) {
    if (grn.voided || billed.has(grn.id)) continue;
    const po = db.purchaseOrders.find((p) => p.id === grn.poId);
    if (!po) continue;
    const supplier =
      db.parties.find((p) => p.id === po.supplierId)?.name || "Supplier";
    out.push({ grn, po, supplierName: supplier });
  }
  return out.sort((a, b) => b.grn.date.localeCompare(a.grn.date));
}

/** Owner: set rates on a goods receipt and post the purchase bill. */
export function priceGoodsReceived(input: {
  grnId: string;
  date: string;
  createdBy: string;
  /** Rate per GRN line id */
  rates: Record<string, number>;
  taxPercent?: number;
  /** Extra bill lines — freight, packing, etc. (expense heads) */
  expenses?: {
    itemLabel: string;
    accountId: string;
    amount: number;
    taxPercent?: number;
  }[];
}): Voucher {
  const db = loadDb();
  const grn = db.goodsReceipts.find((g) => g.id === input.grnId);
  if (!grn || grn.voided) throw new Error("Goods receipt not found");
  const already = db.vouchers.find(
    (v) => v.type === "purchase" && !v.voided && v.linkedGrnId === grn.id
  );
  if (already) throw new Error(`Already billed as ${already.number}`);

  const po = db.purchaseOrders.find((p) => p.id === grn.poId);
  if (!po) throw new Error("Linked order not found");

  for (const line of grn.lines) {
    const rate = Number(input.rates[line.id]);
    if (!(rate > 0)) {
      throw new Error(`Enter a rate for ${line.itemLabel}`);
    }
    const poLine = po.lines.find((l) => l.id === line.poLineId);
    if (poLine) {
      const secondaryQty = line.secondaryQty ?? line.qty;
      poLine.rate = rate;
      poLine.amount = roundMoney(secondaryQty * rate);
    }
  }
  po.total = roundMoney(po.lines.reduce((s, l) => s + l.amount, 0));
  saveDb(db);

  return createPurchaseBillFromGrn({
    grnId: input.grnId,
    date: input.date,
    createdBy: input.createdBy,
    taxPercent: input.taxPercent,
    rateOverrides: input.rates,
    expenses: input.expenses,
  });
}

function priceProvisionalLayersForGrn(
  batches: StockBatch[],
  grnId: string,
  voucher: Voucher
): void {
  const provisional = batches.filter(
    (b) => b.grnId === grnId && b.provisional && b.qty > 0
  );
  if (!provisional.length) {
    addPurchaseLayers(batches, voucher);
    return;
  }
  for (const line of voucher.lines) {
    if (!line.productId || line.rate <= 0) continue;
    const measure = lineMeasure(line);
    let left = measure;
    for (const batch of provisional) {
      if (left <= 0.001) break;
      if (batch.productId !== line.productId) continue;
      if (batch.variationId !== line.variationId) continue;
      if (batch.rate > 0 && !batch.provisional) continue;
      batch.rate = line.rate;
      batch.provisional = false;
      batch.voucherId = voucher.id;
      left = roundMoney(left - batch.qty);
    }
  }
}

export function createPurchaseBillFromGrn(input: {
  grnId: string;
  date: string;
  createdBy: string;
  taxPercent?: number;
  /** Optional rates keyed by GRN line id (owner pricing) */
  rateOverrides?: Record<string, number>;
  /** Freight / packing / other expenses on the same bill */
  expenses?: {
    itemLabel: string;
    accountId: string;
    amount: number;
    taxPercent?: number;
  }[];
}): Voucher {
  const db = loadDb();
  const grn = db.goodsReceipts.find((g) => g.id === input.grnId);
  if (!grn || grn.voided) throw new Error("GRN not found");
  const po = db.purchaseOrders.find((p) => p.id === grn.poId);
  if (!po) throw new Error("PO not found");
  const taxPercent = input.taxPercent ?? 0;
  const lines: VoucherLine[] = grn.lines.map((l) => {
    const poLine = po.lines.find((x) => x.id === l.poLineId);
    const override = input.rateOverrides?.[l.id];
    const rate =
      override != null && override > 0 ? override : (poLine?.rate ?? 0);
    if (!(rate > 0)) {
      throw new Error(`Missing rate for ${l.itemLabel}`);
    }
    const secondaryQty = l.secondaryQty ?? l.qty;
    const amount = roundMoney(secondaryQty * rate);
    return {
      id: `vl_${crypto.randomUUID()}`,
      itemLabel: l.itemLabel,
      qty: l.qty,
      secondaryQty,
      unit: l.unit || poLine?.unit,
      rate,
      amount,
      taxPercent,
      productId: l.productId || poLine?.productId,
      variationId: l.variationId || poLine?.variationId,
      colorId: l.colorId || poLine?.colorId,
    };
  });
  for (const exp of input.expenses ?? []) {
    const amount = roundMoney(exp.amount);
    if (!(amount > 0)) continue;
    if (!exp.accountId) throw new Error("Expense account required");
    lines.push({
      id: `vl_${crypto.randomUUID()}`,
      itemLabel: exp.itemLabel.trim() || "Expense",
      accountId: exp.accountId,
      qty: 1,
      secondaryQty: 1,
      rate: amount,
      amount,
      taxPercent: exp.taxPercent ?? 0,
    });
  }
  const voucher = createVoucher({
    type: "purchase",
    date: input.date,
    partyId: po.supplierId,
    narration: `Bill for ${grn.number}`,
    lines,
    linkedPoId: po.id,
    linkedGrnId: grn.id,
    grniAmount: grn.accruedAmount || 0,
    packingSlipDataUrl: grn.packingSlipDataUrl,
    packingSlipName: grn.packingSlipName,
    createdBy: input.createdBy,
    skipInventory: true,
  });
  // Reload and bump billed qty
  const db2 = loadDb();
  const po2 = db2.purchaseOrders.find((p) => p.id === po.id);
  if (po2) {
    for (const l of grn.lines) {
      const poLine = po2.lines.find((x) => x.id === l.poLineId);
      if (poLine) {
        poLine.billedQty = roundMoney((poLine.billedQty ?? 0) + l.qty);
      }
    }
    syncPoStatus(db2, po2.id);
    saveDb(db2);
  }
  return voucher;
}

function nextContractNumber(contracts: SupplierContract[]): string {
  let max = 1000;
  for (const c of contracts) {
    const n = Number(c.number.replace(/\D/g, ""));
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `CTR-${max + 1}`;
}

export function upsertSupplierContract(contract: SupplierContract): void {
  const db = loadDb();
  const i = db.supplierContracts.findIndex((c) => c.id === contract.id);
  if (i >= 0) db.supplierContracts[i] = contract;
  else db.supplierContracts.unshift(contract);
  saveDb(db);
}

export function createSupplierContract(input: {
  supplierId: string;
  date: string;
  validFrom: string;
  validTo?: string;
  scope: SupplierContract["scope"];
  categoryId?: string;
  productId?: string;
  variationId?: string;
  itemLabel: string;
  rate: number;
  unit: SupplierContract["unit"];
  contractedQty: number;
  lockMode?: SupplierContract["lockMode"];
  contractedValue?: number;
  narration?: string;
  createdBy: string;
  /** When set, reuse this CTR number (multi-line batch) */
  number?: string;
}): SupplierContract {
  const db = loadDb();
  const lockMode = input.lockMode === "value" ? "value" : "qty";
  if (lockMode === "qty" && input.contractedQty <= 0) {
    throw new Error("Contract qty must be > 0");
  }
  if (lockMode === "value") {
    const value =
      input.contractedValue ??
      roundMoney((input.contractedQty || 0) * (input.rate || 0));
    if (value <= 0) throw new Error("Contract value must be > 0");
  }
  if (input.rate < 0) throw new Error("Rate cannot be negative");
  if (input.scope === "category" && !input.categoryId) {
    throw new Error("Category required");
  }
  if (input.scope === "product" && !input.productId) {
    throw new Error("Product required");
  }
  const contractedValue =
    lockMode === "value"
      ? roundMoney(
          input.contractedValue ??
            (input.contractedQty || 0) * (input.rate || 0)
        )
      : undefined;
  const contract: SupplierContract = {
    id: `ctr_${crypto.randomUUID()}`,
    number: input.number || nextContractNumber(db.supplierContracts),
    supplierId: input.supplierId,
    date: input.date.slice(0, 10),
    validFrom: input.validFrom.slice(0, 10),
    validTo: input.validTo?.slice(0, 10),
    scope: input.scope,
    categoryId: input.categoryId,
    productId: input.productId,
    variationId: input.variationId,
    itemLabel: input.itemLabel.trim(),
    rate: input.rate,
    unit: input.unit,
    contractedQty:
      input.contractedQty > 0
        ? input.contractedQty
        : lockMode === "value" && input.rate > 0
          ? roundMoney((contractedValue || 0) / input.rate)
          : 0,
    usedQty: 0,
    lockMode,
    contractedValue,
    usedValue: lockMode === "value" ? 0 : undefined,
    narration: input.narration?.trim(),
    active: true,
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
  };
  db.supplierContracts.unshift(contract);
  saveDb(db);
  return contract;
}

export type SupplierContractLineInput = {
  scope: SupplierContract["scope"];
  categoryId?: string;
  productId?: string;
  variationId?: string;
  itemLabel: string;
  rate: number;
  unit: SupplierContract["unit"];
  contractedQty: number;
  contractedValue?: number;
};

/** One CTR number, many lines (items and/or categories). */
export function createSupplierContractBatch(input: {
  supplierId: string;
  date: string;
  validFrom: string;
  validTo?: string;
  lockMode?: SupplierContract["lockMode"];
  narration?: string;
  createdBy: string;
  lines: SupplierContractLineInput[];
}): SupplierContract[] {
  if (!input.lines.length) throw new Error("Add at least one line");
  const db = loadDb();
  const number = nextContractNumber(db.supplierContracts);
  const lockMode = input.lockMode === "value" ? "value" : "qty";
  const created: SupplierContract[] = [];
  for (const line of input.lines) {
    if (line.scope === "category" && !line.categoryId) {
      throw new Error("Category required");
    }
    if (line.scope === "product" && !line.productId) {
      throw new Error("Product required");
    }
    if (line.rate < 0) throw new Error("Rate cannot be negative");
    const contractedValue =
      lockMode === "value"
        ? roundMoney(
            line.contractedValue ??
              (line.contractedQty || 0) * (line.rate || 0)
          )
        : undefined;
    if (lockMode === "qty" && line.contractedQty <= 0) {
      throw new Error("Contract qty must be > 0");
    }
    if (lockMode === "value" && (contractedValue || 0) <= 0) {
      throw new Error("Contract value must be > 0");
    }
    const contract: SupplierContract = {
      id: `ctr_${crypto.randomUUID()}`,
      number,
      supplierId: input.supplierId,
      date: input.date.slice(0, 10),
      validFrom: input.validFrom.slice(0, 10),
      validTo: input.validTo?.slice(0, 10),
      scope: line.scope,
      categoryId: line.categoryId,
      productId: line.productId,
      variationId: line.variationId,
      itemLabel: line.itemLabel.trim(),
      rate: line.rate,
      unit: line.unit,
      contractedQty:
        line.contractedQty > 0
          ? line.contractedQty
          : lockMode === "value" && line.rate > 0
            ? roundMoney((contractedValue || 0) / line.rate)
            : 0,
      usedQty: 0,
      lockMode,
      contractedValue,
      usedValue: lockMode === "value" ? 0 : undefined,
      narration: input.narration?.trim(),
      active: true,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
    };
    db.supplierContracts.unshift(contract);
    created.push(contract);
  }
  saveDb(db);
  return created;
}

export { calcLineTotal, buildOrderLine };
