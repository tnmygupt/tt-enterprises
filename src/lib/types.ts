export type Locale = "en" | "hi";

export type UnitOfSale = "kg" | "pcs" | "jhal" | "pkt";

export type UserRole =
  | "customer"
  | "super_admin"
  | "sales"
  | "accounts"
  | "dispatch"
  | "viewer";

export type Capability =
  | "manage_products"
  | "manage_users"
  | "manage_orders"
  | "manage_schemes"
  | "manage_wallet"
  | "manage_shipping"
  | "upload_bill"
  | "verify_payment"
  | "upload_lr"
  | "manage_tally"
  | "manage_accounts"
  | "manage_contracts"
  | "view_reports"
  /** Owner-only: P/L, Balance Sheet, purchase rates, owner panel */
  | "view_financials";

export const ROLE_CAPABILITIES: Record<UserRole, Capability[]> = {
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
    "manage_tally",
    "manage_accounts",
    "manage_contracts",
    "view_reports",
    "view_financials",
  ],
};

export type ProductCategory = string;

export interface CategoryDef {
  id: string;
  name: LocalizedString;
  active: boolean;
}

export interface LocalizedString {
  en: string;
  hi: string;
}

export interface ProductVariation {
  id: string;
  label: LocalizedString;
  /** Physical size e.g. 12x18 ft / 3m width */
  size: LocalizedString;
  sku: string;
  rate: number;
  weightKg?: number;
  /** Stock in bundles / packs */
  stock: number;
  /** Stock in product unit (kg or pcs) */
  stockSecondary?: number;
  /** Reorder when this size's bundles fall at or below */
  minStockLevel?: number;
  tallyItemId?: string;
}

export interface ProductColor {
  id: string;
  name: LocalizedString;
  hex: string;
  /** Optional swatch / sample photo for this color */
  imageUrl?: string;
}

export interface ProductMedia {
  id: string;
  type: "image" | "video";
  url: string;
  alt?: string;
}

export interface Product {
  id: string;
  code: string;
  category: ProductCategory;
  /** Item under category (e.g. HDPE Tarpaulin) */
  itemName: LocalizedString;
  name: LocalizedString;
  description: LocalizedString;
  /**
   * Optional rich HTML description (with images / tables). Sanitized on
   * write and again on render. When present, this overrides the plain-text
   * `description` in the catalog UI; `description` is kept in sync as a
   * plain-text fallback for search, PDFs, and legacy consumers.
   */
  descriptionHtml?: LocalizedString;
  unit: UnitOfSale;
  baseRate: number;
  /** Admin-defined unit weight (kg) used in quick order / bundle calc */
  baseWeightKg?: number;
  pricingMode: "bundle" | "pcs";
  gsm?: number;
  thicknessMm?: number;
  material?: string;
  brand?: string;
  hsnCode?: string;
  minOrderQty?: number;
  /** Reorder alert when on-hand bundles fall at or below this (product rollup) */
  minStockLevel?: number;
  /**
   * Optional fill-to target (bundles). Suggested order qty =
   * max(0, (reorderQty ?? min) − onHand).
   */
  reorderQty?: number;
  /** Preferred supplier party id for draft / auto POs */
  preferredSupplierId?: string;
  /**
   * Reorder mins per size × color. Same keys as stockMatrix (`variationId__colorId`).
   */
  minStockMatrix?: Record<string, number>;
  variations: ProductVariation[];
  colors: ProductColor[];
  media: ProductMedia[];
  /** Square product logo for catalog list */
  logoUrl?: string;
  active: boolean;
  featured: boolean;
  /**
   * Stock per size × color (bundles).
   * Key: `${variationId}__${colorId}` — source of truth when colors exist.
   */
  stockMatrix?: Record<string, number>;
  /** Stock in bundles / packs (rollup of matrix / variations) */
  stock: number;
  /** Stock in product unit (kg or pcs) */
  stockSecondary?: number;
  tallyItemId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfile {
  id: string;
  /** Optional — phone is primary login */
  email?: string;
  passwordHash: string;
  /**
   * Plaintext password kept ONLY when an admin created the account or reset
   * the password (so admin can share it back with the dealer / staff).
   * Cleared as soon as the user changes their own password.
   * Never populated for self-registered dealers.
   */
  passwordVisible?: string;
  name: string;
  /** Primary login id (10-digit mobile preferred) */
  phone: string;
  company?: string;
  address?: string;
  /** Indian PIN / postal code */
  pincode?: string;
  gstOrAadhar?: string;
  transport?: string;
  role: UserRole;
  /**
   * Extra capabilities beyond the role preset.
   * Ignored for super_admin (always full owner preset).
   */
  extraCapabilities?: Capability[];
  /**
   * Capabilities removed from the role preset.
   * Ignored for super_admin.
   */
  deniedCapabilities?: Capability[];
  locale: Locale;
  walletBalance: number;
  assignedSchemeIds: string[];
  liftingProgressKg: number;
  /** Per-scheme cumulative lift (kg or bundles) in the active period */
  schemeProgress: Record<string, number>;
  /**
   * Per-scheme cumulative billed ₹ of scoped lines (for percent schemes).
   * Tier unlock still uses schemeProgress; payout uses this × %.
   */
  schemeValueProgress?: Record<string, number>;
  active: boolean;
  /**
   * Dealers need admin approval before login.
   * Staff accounts are always approved.
   */
  approved: boolean;
  createdAt: string;
  /** Audit trail when an admin revokes access. Cleared on restore. */
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  /**
   * Web Push subscriptions for this user (PWA notifications).
   * Cap ~5 endpoints; pruned when send fails.
   */
  pushSubscriptions?: {
    endpoint: string;
    expirationTime?: number | null;
    keys: { p256dh: string; auth: string };
  }[];
}

export type OrderStatus =
  | "estimate"
  | "confirmed"
  | "payment_pending"
  | "payment_verified"
  | "dispatched"
  | "delivered"
  | "cancelled";

export interface OrderLine {
  productId: string;
  productCode: string;
  productName: LocalizedString;
  variationId?: string;
  variationLabel?: LocalizedString;
  size?: LocalizedString;
  colorId?: string;
  colorName?: LocalizedString;
  unit: UnitOfSale;
  pricingMode: "bundle" | "pcs";
  rate: number;
  quantity: number;
  /** Display / shipping weight (estimate until actual is set) */
  weightKg: number;
  /** Weight at estimate time */
  estimatedWeightKg?: number;
  /** Admin-confirmed actual billed weight — only this counts for schemes */
  actualWeightKg?: number;
  lineTotal: number;
}

/** One uploaded file for a payment (used for part-payments too). */
export interface PaymentProofItem {
  id: string;
  /** Hosted URL (Firebase / /uploads) or an inline data URL fallback. */
  url: string;
  type: "image" | "pdf";
  fileName?: string;
  /** Free-form note (UPI ref, bank ref, "1st installment", etc.). */
  note?: string;
  /** Amount this specific transaction covers, in ₹ — used to tally part-payments. */
  amount?: number;
  uploadedAt: string;
  /** Optional uploader id for audit; empty for legacy migrated rows. */
  uploadedBy?: string;
}

export interface PaymentProof {
  /** @deprecated legacy — use `items[0]?.note` on new writes */
  note?: string;
  /** @deprecated legacy — use `items[0]?.url` on new writes */
  imageDataUrl?: string;
  /** Multi-file list. Missing on legacy rows — read via getProofItems() to normalize. */
  items?: PaymentProofItem[];
  uploadedAt: string;
  verified: boolean;
  verifiedAt?: string;
  verifiedBy?: string;
}

export type PackingSlipStatus = "draft" | "finalized";

export interface PackingSlipColumn {
  lineIndex: number;
  label: string;
  productId: string;
  variationId?: string;
  colorId?: string;
  rate: number;
  pricingMode: "bundle" | "pcs";
  /** Ordered bundle qty from estimate — drives row height */
  orderedBundles?: number;
}

export interface PackingSlipRow {
  /** kg per column; null = blank cell */
  cells: (number | null)[];
}

/** Warehouse packing slip — paper-form style, linked to an order. */
export interface PackingSlip {
  slipNo: string;
  status: PackingSlipStatus;
  /** YYYY-MM-DD */
  date: string;
  partyName: string;
  partyPhone?: string;
  partyAddress?: string;
  partyGstin?: string;
  transport?: string;
  preparedBy?: string;
  checkedBy?: string;
  note?: string;
  columns: PackingSlipColumn[];
  rows: PackingSlipRow[];
  /** Bundle counts per column (auto: 1 per cell with kg) */
  bundles: (number | null)[];
  /**
   * Shipping applied on this slip (auto from actual kg rules, or manual override).
   * When set, used for bill preview + finalize instead of estimate shipping.
   */
  shippingAmount?: number;
  /** True when staff overwrote auto shipping */
  shippingManual?: boolean;
  /**
   * When true, each column’s billing kg is rounded UP to the next whole kg
   * (ceil). Cell weighments stay as entered; amounts / actual weights use rounded kg.
   */
  roundUpKg?: boolean;
  finalizedAt?: string;
  finalizedBy?: string;
  customerPdfUrl?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  userId: string;
  userName: string;
  userEmail: string;
  status: OrderStatus;
  lines: OrderLine[];
  subtotal: number;
  shippingAmount: number;
  walletUsed: number;
  estimatedTotal: number;
  /** Per-order scheme discount (₹) applied to goods subtotal */
  schemeDiscount?: number;
  /** Scheme name shown on bill / UI */
  schemeDiscountLabel?: string;
  schemeDiscountId?: string;
  /** Sum of line estimate weights */
  estimatedWeightKg?: number;
  /** Sum of line actual weights (when set) */
  actualWeightKg?: number;
  /** True after scheme progress was applied from actual line weights */
  schemeApplied?: boolean;
  actualBillAmount?: number;
  billFileDataUrl?: string;
  billUploadedAt?: string;
  lrFileDataUrl?: string;
  lrNumber?: string;
  lrUploadedAt?: string;
  paymentProof?: PaymentProof;
  fullTruckRequested: boolean;
  shippingNotes?: string;
  deliveryAddress: string;
  customerNotes?: string;
  checkoutName?: string;
  gstOrAadhar?: string;
  phone?: string;
  transport?: string;
  adminNotes?: string;
  /** Stock already reduced when estimate was placed; restore only on cancel */
  stockReserved?: boolean;
  /** Auto-created on estimate; staff fills weighments then finalizes */
  packingSlip?: PackingSlip;
  timeline: { status: OrderStatus | string; at: string; note?: string }[];
  createdAt: string;
  updatedAt: string;
}

export type SchemeRewardType =
  | "fixed_credit"
  | "per_kg_rate"
  | "percent"
  | "order_percent"
  | "order_flat";
export type SchemeScopeType = "all" | "category" | "product";
/** What counts toward scheme progress / tier unlock */
export type SchemeProgressUnit = "kg" | "bundles";

/**
 * One tier inside a scheme.
 *
 * Lifting schemes (per_kg_rate / percent):
 * Highest achieved tier’s ratePerUnit applies to the dealer’s FULL lift
 * (not only the band above the previous tier). Payout is one wallet credit
 * after the scheme end date.
 * - per_kg_rate: ratePerUnit = ₹ per kg/bundle × full lift
 * - percent: ratePerUnit = % of scheme sales value once tier unlocked by lift
 *
 * Per-order discount schemes (order_percent / order_flat):
 * targetAmount = min qty on THIS order (kg or bundles via progressUnit).
 * ratePerUnit = % off scoped subtotal (order_percent) or flat ₹ off (order_flat).
 * Applied on the order bill — not wallet settlement.
 */
export interface SchemeLevel {
  id: string;
  name: LocalizedString;
  /**
   * Min cumulative lift (lifting schemes) OR min this-order qty
   * (order_percent / order_flat), in kg or bundles.
   */
  targetAmount: number;
  /**
   * per_kg_rate → ₹ per kg/bundle on full lift
   * percent → percent of scoped sales value (e.g. 2 = 2%)
   * order_percent → % off this order’s scoped subtotal
   * order_flat → flat ₹ off this order (capped at scoped subtotal)
   */
  ratePerUnit: number;
  /** @deprecated legacy fixed credit — ignored for tier payout */
  creditAmount?: number;
}

export interface Scheme {
  id: string;
  name: LocalizedString;
  description: LocalizedString;
  termsAndConditions: LocalizedString;
  /** Count progress in kg or bundles (default kg) */
  progressUnit?: SchemeProgressUnit;
  /**
   * Highest tier target (legacy / summary). Prefer `levels`.
   */
  targetWeightKg: number;
  /**
   * Prefer per_kg_rate / percent (lifting → wallet) or
   * order_percent / order_flat (per-order bill discount).
   * fixed_credit kept for older data migration only.
   */
  rewardType: SchemeRewardType;
  creditAmount: number;
  /** Fallback ₹/kg when a tier has no ratePerUnit (per_kg_rate) */
  discountPerKg: number;
  /** Fallback % when a tier has no ratePerUnit (percent / order_percent) */
  discountPercent?: number;
  /**
   * Tiers in one scheme.
   * Lifting: highest unlocked rate × full progress = wallet credit after end.
   * Order discount: highest unlocked tier by this-order qty → bill discount.
   */
  levels?: SchemeLevel[];
  scopeType: SchemeScopeType;
  scopeCategory?: ProductCategory;
  scopeProductIds: string[];
  /** Every dealer participates automatically */
  appliesToAllDealers: boolean;
  active: boolean;
  startDate: string;
  endDate: string;
  createdAt: string;
}

export interface WalletTransaction {
  id: string;
  userId: string;
  type: "credit" | "debit";
  amount: number;
  reason: string;
  orderId?: string;
  schemeId?: string;
  /** Settlement / adjustment for ended scheme (not per-order) */
  schemeSettlement?: boolean;
  schemeLevelId?: string;
  /** Linked advance deposit request when admin verified a top-up */
  depositId?: string;
  createdAt: string;
  createdBy: string;
}

/** Dealer advance top-up: pay via UPI/bank → upload proof → admin verifies → wallet credit. */
export type WalletDepositStatus =
  | "awaiting_proof"
  | "pending_verify"
  | "verified"
  | "rejected"
  | "cancelled";

export interface WalletDeposit {
  id: string;
  depositNumber: string;
  userId: string;
  userName: string;
  userPhone: string;
  amount: number;
  note?: string;
  status: WalletDepositStatus;
  proof?: PaymentProof;
  createdAt: string;
  updatedAt: string;
  verifiedAt?: string;
  verifiedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  rejectReason?: string;
}

export interface ShippingRule {
  id: string;
  name: string;
  minWeightKg: number;
  maxWeightKg?: number;
  minOrderValue: number;
  shippingAmount: number;
  freeAboveWeightKg?: number;
  freeAboveValue?: number;
  active: boolean;
}

export interface BankAccountDetails {
  /** Stable id (added for multi-account support). Optional so legacy singleton entries still load. */
  id?: string;
  /** Short nickname shown in the account picker (e.g. "HDFC Current"). */
  label?: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  branch: string;
  /** Per-account UPI VPA. Falls back to the top-level `settings.upiId` if empty. */
  upiId?: string;
  /** Per-account UPI payee name. Falls back to `settings.upiPayeeName` / company name. */
  upiPayeeName?: string;
  /**
   * Optional uploaded static QR (data URL / hosted URL). Used verbatim when
   * the bill amount exceeds the UPI per-transaction limit — most UPI apps
   * refuse amount-preloaded QRs above ₹1,00,000, so admins can upload a
   * plain scan-and-enter-amount QR (or a bank-issued Bharat QR) for those.
   */
  staticQrDataUrl?: string;
  /** Whether this account is available for dealers to pay into. Defaults to true. */
  active?: boolean;
  /** Marks the account shown first in the picker. */
  isDefault?: boolean;
}

/** Weight slab: ≤minKg → flat X; above min → X + steps × (X × fraction) */
export interface WeightShippingRule {
  enabled: boolean;
  /** Base X applies up to this weight; extras start when heavier (default 100) */
  minWeightKg: number;
  /** Flat base rate X (₹) — charged for any order with weight */
  flatRateX: number;
  /** Extra charge every this many kg after min (default 50) */
  stepKg: number;
  /** Increase by this fraction of X each step (0.5 = half of X) */
  stepFractionOfX: number;
}

/** Per-jhal shipping: 1 jhal = ratePerJhal (₹). Set by owner in Shipping. */
export interface JhalShippingRule {
  /** ₹ charged per jhal on the order */
  ratePerJhal: number;
}

export interface AppSettings {
  companyName: string;
  phone: string;
  /** Second phone (optional) */
  phone2?: string;
  address: string;
  /** Second business address (optional) */
  address2?: string;
  gstin: string;
  fullTruckMinWeightKg: number;
  fullTruckMinValue: number;
  /** Optional: >100kg flat X, then +½X every 50kg */
  weightShipping?: WeightShippingRule;
  /** Flat ₹ per jhal for products sold in jhal */
  jhalShipping?: JhalShippingRule;
  /** UPI VPA e.g. business@okaxis — used in amount QR */
  upiId: string;
  /** Name shown on UPI apps */
  upiPayeeName: string;
  /**
   * Legacy singleton bank account — kept for backward compatibility with old
   * saved DBs. New installs should populate `bankAccounts` instead; on load,
   * this entry is migrated into the first `bankAccounts` slot if the array
   * is empty.
   */
  bankAccount: BankAccountDetails;
  /** Multi-account list. When present, the picker in PaymentInstructions uses this. */
  bankAccounts?: BankAccountDetails[];
  /**
   * Max amount for which an amount-preloaded UPI QR is generated. Bills above
   * this fall back to the account's static QR (or bank-transfer instructions).
   * Defaults to ₹1,00,000 — the effective UPI per-txn cap for most banks.
   */
  upiMaxAmount?: number;
  paymentNote: string;
  /** Open WhatsApp (wa.me) after order / packing-slip actions */
  whatsappNotifyEnabled?: boolean;
  /** Country dial code without + (default 91 India) */
  whatsappCountryCode?: string;
  tallyLastSyncAt?: string;
  tallySyncStatus?: "idle" | "ok" | "error";
  tallySyncMessage?: string;
  /**
   * ISO timestamp set when ops data (orders/users/wallets/etc.) was purged.
   * Stale browsers with an older/missing value must not re-push deleted rows.
   */
  opsPurgeAt?: string;
  /** YouTube (or youtu.be) URL shown on /help for dealers */
  dealerHelpVideoUrl?: string;
  /** YouTube URL shown on /admin/help for staff */
  adminHelpVideoUrl?: string;
  /** ISO timestamp when FIFO perpetual accounting was initialized */
  fifoMigratedAt?: string;
  /**
   * Month the financial year starts (1–12). India default April = 4.
   * Used for P&L YTD on balance sheet and Controls FY label.
   */
  financialYearStartMonth?: number;
  /**
   * Inclusive YYYY-MM-DD — vouchers/GRNs on or before this date cannot be
   * posted or voided (period lock).
   */
  lockedThroughDate?: string;
  /** Last books backup download ISO timestamp */
  booksBackupAt?: string;
  /** Weekly auto draft-PO from reorder alerts (server cron) */
  autoReorderEnabled?: boolean;
  /** Cron expression hint shown in settings (Hostinger runs the HTTP hit) */
  autoReorderCron?: string;
  /** Ignore suggested lines below this bundle qty when auto-PO runs */
  autoReorderMinQty?: number;
}

export interface CartItem {
  key: string;
  productId: string;
  variationId?: string;
  colorId?: string;
  quantity: number;
  weightKg: number;
}

export interface SessionUser {
  id: string;
  phone: string;
  email?: string;
  name: string;
  role: UserRole;
  locale: Locale;
}

/** --- Accounting / ERP (Phase-1 simple books) --- */

export type AccountType =
  | "asset"
  | "liability"
  | "income"
  | "expense"
  | "equity";

export interface Account {
  id: string;
  code: string;
  name: LocalizedString;
  type: AccountType;
  openingBalance: number;
  /** Debit-positive for asset/expense; credit-positive for liability/income/equity */
  active: boolean;
  /** Include in Cash/Bank book and receipt/payment selectors */
  bankBook?: boolean;
}

export type PartyType = "customer" | "supplier";

export interface Party {
  id: string;
  name: string;
  phone: string;
  type: PartyType;
  linkedUserId?: string;
  openingBalance: number;
  address?: string;
  pincode?: string;
  gstin?: string;
  /** Max receivable (customers) or payable exposure (suppliers) */
  creditLimit?: number;
  active: boolean;
  createdAt: string;
}

export type VoucherType =
  | "sale"
  | "purchase"
  | "receipt"
  | "payment"
  | "journal"
  | "credit_note"
  | "debit_note";

export interface VoucherLine {
  id: string;
  itemLabel: string;
  accountId?: string;
  /** Bundles / packs */
  qty: number;
  /** kg or pcs (product unit) */
  secondaryQty?: number;
  /** Secondary unit for stock / measure */
  unit?: UnitOfSale;
  rate: number;
  amount: number;
  taxPercent?: number;
  /** Links line to catalog for inventory */
  productId?: string;
  variationId?: string;
  colorId?: string;
  /** Supplier contract consumed by this purchase line (walk-in) */
  contractId?: string;
}

export interface Voucher {
  id: string;
  number: string;
  type: VoucherType;
  date: string;
  partyId?: string;
  narration?: string;
  lines: VoucherLine[];
  /** Taxable / line total before tax */
  subtotal: number;
  taxAmount: number;
  /** Nearest-rupee adjustment (total − exact). Positive = rounded up. */
  roundOff?: number;
  total: number;
  /** Cash/Bank account used for receipt/payment */
  cashAccountId?: string;
  linkedOrderId?: string;
  /** Sale invoice this credit note returns against */
  linkedInvoiceId?: string;
  /** Purchase bill this debit note returns against */
  linkedPurchaseId?: string;
  linkedPoId?: string;
  linkedGrnId?: string;
  /** Order payment-proof item this receipt settles (part payments) */
  linkedPaymentProofItemId?: string;
  dueDate?: string;
  /** Cached open amount; recalculated on allocate/return */
  outstanding?: number;
  /** Packing slip image/PDF data URL */
  packingSlipDataUrl?: string;
  packingSlipName?: string;
  /** True when stock was not moved by this voucher (e.g. already reserved on estimate) */
  inventorySkipped?: boolean;
  /**
   * Opening / brought-forward bill — posts to Capital, not Sales/Purchase,
   * and does not move stock or run FIFO.
   */
  isOpening?: boolean;
  /** FIFO cost of goods sold (sales) or returned (credit note) */
  cogsAmount?: number;
  voided: boolean;
  voidedAt?: string;
  voidedBy?: string;
  createdAt: string;
  createdBy: string;
}

/** Partial settlement of a sale/purchase invoice by receipt/payment */
export interface BillAllocation {
  id: string;
  receiptOrPaymentVoucherId: string;
  invoiceVoucherId: string;
  amount: number;
  date: string;
}

export type PurchaseOrderStatus =
  | "draft"
  | "ordered"
  | "partial"
  | "received"
  | "billed"
  | "cancelled";

export interface PurchaseOrderLine {
  id: string;
  productId?: string;
  variationId?: string;
  colorId?: string;
  itemLabel: string;
  qty: number;
  secondaryQty?: number;
  unit?: UnitOfSale;
  rate: number;
  amount: number;
  /** Linked supplier contract (rate / qty left) */
  contractId?: string;
  /** Qty already received via GRNs */
  receivedQty?: number;
  billedQty?: number;
}

export interface PurchaseOrder {
  id: string;
  number: string;
  supplierId: string;
  date: string;
  status: PurchaseOrderStatus;
  lines: PurchaseOrderLine[];
  narration?: string;
  total: number;
  createdAt: string;
  createdBy: string;
}

export interface GoodsReceiptLine {
  id: string;
  poLineId: string;
  productId?: string;
  variationId?: string;
  colorId?: string;
  itemLabel: string;
  qty: number;
  secondaryQty?: number;
  unit?: UnitOfSale;
}

export interface GoodsReceipt {
  id: string;
  number: string;
  poId: string;
  date: string;
  lines: GoodsReceiptLine[];
  packingSlipDataUrl?: string;
  packingSlipName?: string;
  narration?: string;
  createdAt: string;
  createdBy: string;
  voided: boolean;
  voidedAt?: string;
  voidedBy?: string;
}

/** Supplier rate contract — category or item level */
export type ContractScope = "category" | "product";
/** Qty lock = kg/pcs commitment; value lock = ₹ commitment */
export type ContractLockMode = "qty" | "value";

export interface SupplierContract {
  id: string;
  number: string;
  supplierId: string;
  date: string;
  validFrom: string;
  validTo?: string;
  scope: ContractScope;
  /** When scope = category */
  categoryId?: string;
  /** When scope = product */
  productId?: string;
  variationId?: string;
  itemLabel: string;
  /** Contracted rate (per kg or pcs) — owner-sensitive */
  rate: number;
  unit: UnitOfSale;
  /** Contracted qty in unit (kg/pcs) — always tracked for history */
  contractedQty: number;
  /** Qty already lifted against this contract */
  usedQty: number;
  /**
   * Default qty. When `value`, remaining is money (`contractedValue − usedValue`)
   * even though qty is still recorded.
   */
  lockMode?: ContractLockMode;
  /** ₹ commitment when lockMode === "value" */
  contractedValue?: number;
  /** ₹ already lifted when value-locked */
  usedValue?: number;
  narration?: string;
  active: boolean;
  createdAt: string;
  createdBy: string;
}

export type StockMovementType =
  | "sale"
  | "purchase"
  | "adjustment"
  | "void_sale"
  | "void_purchase"
  | "sale_return"
  | "purchase_return"
  | "grn"
  | "estimate_reserve"
  | "estimate_release";

export interface StockMovement {
  id: string;
  date: string;
  type: StockMovementType;
  productId: string;
  variationId?: string;
  colorId?: string;
  /** Bundles / packs */
  qty: number;
  /** kg or pcs moved */
  secondaryQty?: number;
  unit?: UnitOfSale;
  /** +in / -out */
  direction: "in" | "out";
  voucherId?: string;
  orderId?: string;
  note?: string;
  createdAt: string;
  createdBy: string;
}

export interface StockBatch {
  id: string;
  date: string;
  productId: string;
  variationId?: string;
  colorId?: string;
  /** Remaining qty in secondary unit (kg/pcs) */
  qty: number;
  /** Original qty when layer created */
  originalQty: number;
  /** Cost rate per secondary unit */
  rate: number;
  unit?: UnitOfSale;
  source: "purchase" | "grn" | "opening" | "adjustment" | "sale_return";
  voucherId?: string;
  grnId?: string;
  /** True when cost is unknown / placeholder (rate may be 0) */
  provisional?: boolean;
  createdAt: string;
}

export interface BatchConsumption {
  id: string;
  date: string;
  batchId: string;
  voucherId: string;
  productId: string;
  variationId?: string;
  colorId?: string;
  qty: number;
  rate: number;
  costAmount: number;
  createdAt: string;
}

export interface LedgerEntry {
  id: string;
  voucherId: string;
  voucherNumber: string;
  voucherType: VoucherType;
  date: string;
  accountId: string;
  partyId?: string;
  debit: number;
  credit: number;
  narration?: string;
  voided: boolean;
}

/** Saved session for matching a party’s statement against our ledger */
export type StatementMatchStatus = "open" | "reconciled" | "archived";

export interface StatementMatchExtra {
  id: string;
  date: string;
  number: string;
  amount: number;
  note?: string;
  /**
   * Effect on the party balance in our convention:
   * customer — debit raises receivable; supplier — credit raises payable.
   */
  side: "increase" | "decrease";
}

export interface StatementMatch {
  id: string;
  partyId: string;
  from: string;
  to: string;
  /** Closing balance claimed on their statement (same sign as partyBalance) */
  theirClosingBalance: number;
  /** Ledger entry ids ticked as matched */
  matchedEntryIds: string[];
  theirExtraRows: StatementMatchExtra[];
  status: StatementMatchStatus;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
}

/** Queue row for office TallyPrime bridge (simple Sales / Receipt, non-GST). */
export type TallyPostKind = "sale" | "receipt";
export type TallyPostStatus = "pending" | "posted" | "failed";

export interface TallyPost {
  id: string;
  kind: TallyPostKind;
  orderId: string;
  orderNumber: string;
  /** Idempotent Tally REMOTEID — WEB-SALE-… / WEB-RCPT-… */
  remoteId: string;
  partyName: string;
  partyPhone?: string;
  partyGstin?: string;
  amount: number;
  /** YYYY-MM-DD */
  date: string;
  narration: string;
  status: TallyPostStatus;
  attempts: number;
  lastError?: string;
  createdAt: string;
  postedAt?: string;
}

/** Login / page access event for admin Tracking map + traffic stats. */
export type AccessSource = "login" | "page";

export type AccessDevice = "mobile" | "desktop" | "unknown";

export interface AccessPlace {
  id: string;
  userId?: string;
  phone?: string;
  name?: string;
  role?: UserRole;
  at: string;
  /** SHA-256 of client IP — never store raw IP */
  ipHash: string;
  city?: string;
  region?: string;
  country?: string;
  lat?: number;
  lng?: number;
  source: AccessSource;
  /** Present for page hits */
  path?: string;
  locale?: string;
  device?: AccessDevice;
}

/** Alias used in traffic aggregates (same shape as AccessPlace with source page). */
export type SiteHit = AccessPlace;
