import type { Account, LedgerEntry, Party, Voucher } from "../types";

/** Fixed ledger IDs used by posting templates */
export const ACCT = {
  cash: "acct_cash",
  bank: "acct_bank",
  debtors: "acct_debtors",
  creditors: "acct_creditors",
  sales: "acct_sales",
  purchase: "acct_purchase",
  inventory: "acct_inventory",
  cogs: "acct_cogs",
  grni: "acct_grni",
  taxOutput: "acct_tax_output",
  taxInput: "acct_tax_input",
  capital: "acct_capital",
  freight: "acct_freight",
  rent: "acct_rent",
  salary: "acct_salary",
  electricity: "acct_electricity",
  packing: "acct_packing",
  miscExpense: "acct_misc_expense",
  /** Income — freight billed to customer on a sale */
  freightCharges: "acct_freight_charges",
  packingCharges: "acct_packing_charges",
  otherCharges: "acct_other_charges",
  /** Paisa adjustment to nearest rupee on vouchers */
  roundOff: "acct_round_off",
} as const;

/** Chart/ledger accounts hidden from non-owners (purchase cost / equity / payroll). */
export const OWNER_SENSITIVE_ACCOUNTS = new Set<string>([
  ACCT.purchase,
  ACCT.inventory,
  ACCT.cogs,
  ACCT.grni,
  ACCT.taxInput,
  ACCT.capital,
  ACCT.salary,
]);

/** Accounts selectable as Cash / Bank for receipts, payments, expenses. */
export function isCashBankAccount(account: {
  id: string;
  type: string;
  active?: boolean;
  bankBook?: boolean;
  name?: { en?: string };
}): boolean {
  if (account.active === false) return false;
  if (account.id === ACCT.cash || account.id === ACCT.bank) return true;
  if (account.bankBook && account.type === "asset") return true;
  if (account.type === "asset" && /bank/i.test(account.name?.en || "")) {
    return true;
  }
  return false;
}

export function cashBankAccounts<
  T extends {
    id: string;
    type: string;
    active?: boolean;
    bankBook?: boolean;
    name: { en: string; hi?: string };
  },
>(accounts: T[]): T[] {
  return accounts.filter((a) => isCashBankAccount(a));
}

/** Cash/bank ledgers except petty cash — extra current accounts live here. */
export function bankBookAccounts<
  T extends {
    id: string;
    type: string;
    active?: boolean;
    bankBook?: boolean;
    name: { en: string; hi?: string };
  },
>(accounts: T[]): T[] {
  return cashBankAccounts(accounts).filter((a) => a.id !== ACCT.cash);
}

/** One-tap expense presets (operating spend). */
export const EXPENSE_PRESETS: {
  id: string;
  accountId: string;
  label: string;
  ownerOnly?: boolean;
}[] = [
  { id: "freight", accountId: ACCT.freight, label: "Freight" },
  { id: "packing", accountId: ACCT.packing, label: "Packing" },
  { id: "electricity", accountId: ACCT.electricity, label: "Electricity" },
  { id: "rent", accountId: ACCT.rent, label: "Rent" },
  { id: "salary", accountId: ACCT.salary, label: "Salary", ownerOnly: true },
  { id: "misc", accountId: ACCT.miscExpense, label: "Other" },
];

/** Charges billed to the customer on a sale / credit note (income recoveries). */
export const SALE_CHARGE_PRESETS: {
  id: string;
  accountId: string;
  label: string;
}[] = [
  { id: "freight", accountId: ACCT.freightCharges, label: "Freight" },
  { id: "packing", accountId: ACCT.packingCharges, label: "Packing" },
  { id: "other", accountId: ACCT.otherCharges, label: "Other charge" },
];

/** Expenses added on a purchase / GRN bill (freight etc. → expense ledgers). */
export const PURCHASE_CHARGE_PRESETS: {
  id: string;
  accountId: string;
  label: string;
}[] = [
  { id: "freight", accountId: ACCT.freight, label: "Freight / cartage" },
  { id: "packing", accountId: ACCT.packing, label: "Packing" },
  { id: "loading", accountId: ACCT.miscExpense, label: "Loading / unloading" },
  { id: "misc", accountId: ACCT.miscExpense, label: "Other expense" },
];

export const SEED_ACCOUNTS: Account[] = [
  {
    id: ACCT.cash,
    code: "1001",
    name: { en: "Cash", hi: "नकद" },
    type: "asset",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.bank,
    code: "1002",
    name: { en: "Bank", hi: "बैंक" },
    type: "asset",
    openingBalance: 0,
    active: true,
    bankBook: true,
  },
  {
    id: ACCT.debtors,
    code: "1100",
    name: { en: "Sundry Debtors", hi: "देनदार" },
    type: "asset",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.inventory,
    code: "1300",
    name: { en: "Inventory", hi: "इन्वेंटरी" },
    type: "asset",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.creditors,
    code: "2100",
    name: { en: "Sundry Creditors", hi: "लेनदार" },
    type: "liability",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.grni,
    code: "2105",
    name: { en: "Goods Received Not Billed", hi: "माल प्राप्त पर बिल नहीं" },
    type: "liability",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.sales,
    code: "4001",
    name: { en: "Sales", hi: "बिक्री" },
    type: "income",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.freightCharges,
    code: "4101",
    name: { en: "Freight charges recovered", hi: "भाड़ा वसूली" },
    type: "income",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.packingCharges,
    code: "4102",
    name: { en: "Packing charges recovered", hi: "पैकिंग वसूली" },
    type: "income",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.otherCharges,
    code: "4199",
    name: { en: "Other charges recovered", hi: "अन्य वसूली" },
    type: "income",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.purchase,
    code: "5001",
    name: { en: "Purchase", hi: "खरीद" },
    type: "expense",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.cogs,
    code: "5002",
    name: { en: "Cost of Goods Sold", hi: "बेचे गए माल की लागत" },
    type: "expense",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.taxOutput,
    code: "2201",
    name: { en: "Output Tax (GST)", hi: "आउटपुट टैक्स (GST)" },
    type: "liability",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.taxInput,
    code: "1201",
    name: { en: "Input Tax (GST)", hi: "इनपुट टैक्स (GST)" },
    type: "asset",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.capital,
    code: "3001",
    name: { en: "Capital", hi: "पूंजी" },
    type: "equity",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.freight,
    code: "5101",
    name: { en: "Freight / Cartage", hi: "भाड़ा" },
    type: "expense",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.rent,
    code: "5102",
    name: { en: "Rent", hi: "किराया" },
    type: "expense",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.salary,
    code: "5103",
    name: { en: "Salary / Wages", hi: "वेतन" },
    type: "expense",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.electricity,
    code: "5104",
    name: { en: "Electricity", hi: "बिजली" },
    type: "expense",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.packing,
    code: "5105",
    name: { en: "Packing / Material", hi: "पैकिंग" },
    type: "expense",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.miscExpense,
    code: "5199",
    name: { en: "Misc. Expense", hi: "अन्य खर्च" },
    type: "expense",
    openingBalance: 0,
    active: true,
  },
  {
    id: ACCT.roundOff,
    code: "5200",
    name: { en: "Round Off", hi: "राउंड ऑफ" },
    type: "expense",
    openingBalance: 0,
    active: true,
  },
];

export const SEED_PARTIES: Party[] = [
  {
    id: "party_dealer",
    name: "Walk-in Customer (sample)",
    phone: "",
    type: "customer",
    linkedUserId: undefined,
    openingBalance: 0,
    address: "",
    pincode: "",
    gstin: "",
    creditLimit: 500000,
    active: true,
    createdAt: new Date().toISOString(),
  },
  {
    id: "party_supplier_hdpe",
    name: "Kanpur HDPE Mills",
    phone: "9123456780",
    type: "supplier",
    openingBalance: 0,
    address: "Panki, Kanpur",
    pincode: "208022",
    active: true,
    createdAt: new Date().toISOString(),
  },
];

/**
 * Fresh books start empty — no demo sale/purchase. Real balances come from
 * /admin/accounts/openings and live vouchers posted by the site.
 */
export function buildSeedAccounting(): {
  vouchers: Voucher[];
  ledgerEntries: LedgerEntry[];
} {
  return { vouchers: [], ledgerEntries: [] };
}
