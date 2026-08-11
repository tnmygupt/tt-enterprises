import type {
  Account,
  LedgerEntry,
  Party,
  Product,
  StockBatch,
} from "../types";
import { roundMoney } from "../pricing";
import { ACCT } from "./seed";
import { accountBalance, isDebitNormal, trialBalance } from "./engine";

/** Sync debtors/creditors account openings from party openingBalance fields. */
export function syncPartyControlOpenings(
  parties: Party[],
  accounts: Account[]
): void {
  const debtors = accounts.find((a) => a.id === ACCT.debtors);
  const creditors = accounts.find((a) => a.id === ACCT.creditors);
  // Include inactive parties — their openings still sit in control accounts,
  // and ledger movements for them still hit Debtors/Creditors.
  if (debtors) {
    debtors.openingBalance = roundMoney(
      parties
        .filter((p) => p.type === "customer")
        .reduce((s, p) => s + (p.openingBalance || 0), 0)
    );
  }
  if (creditors) {
    creditors.openingBalance = roundMoney(
      parties
        .filter((p) => p.type === "supplier")
        .reduce((s, p) => s + (p.openingBalance || 0), 0)
    );
  }
}

/**
 * Set capital.openingBalance so trial balance nets to zero.
 * Call after party/account opening edits (ledger openings stay as posted).
 */
export function rebalanceCapitalOpening(
  accounts: Account[],
  ledgerEntries: LedgerEntry[],
  asOf: string
): number {
  const capital = accounts.find((a) => a.id === ACCT.capital);
  if (!capital) return 0;
  capital.openingBalance = 0;
  const tb = trialBalance(accounts, ledgerEntries, asOf);
  const gap = roundMoney(tb.totalDebit - tb.totalCredit);
  // Capital is credit-normal: higher OB → higher credit balance
  capital.openingBalance = gap;
  return gap;
}

/** Split a CSV/TSV line, honouring simple quoted fields. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQ = !inQ;
      }
      continue;
    }
    if (!inQ && (ch === "," || ch === "\t" || ch === ";")) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseCsvTable(text: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  if (!lines.length) return { headers: [], rows: [] };
  const headers = splitCsvLine(lines[0]).map((h) =>
    h.toLowerCase().replace(/\s+/g, "")
  );
  const rows: Record<string, string>[] = [];
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    if (cells.every((c) => !c)) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    rows.push(row);
  }
  return { headers, rows };
}

function cell(
  row: Record<string, string>,
  ...keys: string[]
): string {
  for (const k of keys) {
    const v = row[k.toLowerCase().replace(/\s+/g, "")];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

export type PartyCsvRow = {
  name: string;
  type: "customer" | "supplier";
  phone: string;
  gstin?: string;
  opening: number;
};

export function parsePartyCsv(text: string): PartyCsvRow[] {
  const { rows } = parseCsvTable(text);
  return rows
    .map((r) => {
      const typeRaw = cell(r, "type", "partytype").toLowerCase();
      const type: "customer" | "supplier" =
        typeRaw.startsWith("s") || typeRaw.includes("creditor")
          ? "supplier"
          : "customer";
      return {
        name: cell(r, "name", "party", "ledger"),
        type,
        phone: cell(r, "phone", "mobile", "mobileno").replace(/\D/g, ""),
        gstin: cell(r, "gstin", "gst") || undefined,
        opening: Number(cell(r, "opening", "openingbalance", "balance")) || 0,
      };
    })
    .filter((r) => r.name);
}

export type StockCsvRow = {
  product: string;
  variation?: string;
  qty: number;
  secondaryQty?: number;
  rate: number;
};

export function parseStockCsv(text: string): StockCsvRow[] {
  const { rows } = parseCsvTable(text);
  return rows
    .map((r) => ({
      product: cell(r, "product", "item", "name", "stockitem"),
      variation: cell(r, "variation", "size", "godown") || undefined,
      qty: Number(cell(r, "qty", "quantity", "bundles")) || 0,
      secondaryQty:
        Number(cell(r, "secondaryqty", "kg", "pcs", "quantitykg")) || undefined,
      rate: Number(cell(r, "rate", "cost", "rateperkg", "openingrate")) || 0,
    }))
    .filter((r) => r.product && (r.qty > 0 || (r.secondaryQty ?? 0) > 0));
}

export type BillCsvRow = {
  party: string;
  type: "customer" | "supplier";
  number: string;
  date: string;
  dueDate?: string;
  amount: number;
  note?: string;
};

export function parseBillCsv(text: string): BillCsvRow[] {
  const { rows } = parseCsvTable(text);
  return rows
    .map((r) => {
      const typeRaw = cell(r, "type", "partytype").toLowerCase();
      const type: "customer" | "supplier" =
        typeRaw.startsWith("s") ||
        typeRaw.includes("creditor") ||
        typeRaw.includes("payable")
          ? "supplier"
          : "customer";
      return {
        party: cell(r, "party", "name", "ledger"),
        type,
        number: cell(r, "number", "billno", "invoiceno", "ref"),
        date: cell(r, "date", "billdate").slice(0, 10),
        dueDate: cell(r, "duedate", "due")?.slice(0, 10) || undefined,
        amount: Number(cell(r, "amount", "outstanding", "balance")) || 0,
        note: cell(r, "note", "narration") || undefined,
      };
    })
    .filter((r) => r.party && r.amount > 0 && r.date);
}

/** Match product by English name or code (case-insensitive). */
export function findProductByLabel(
  products: Product[],
  label: string
): Product | undefined {
  const q = label.trim().toLowerCase();
  if (!q) return undefined;
  return (
    products.find((p) => p.code.toLowerCase() === q) ||
    products.find((p) => p.name.en.toLowerCase() === q) ||
    products.find((p) => p.itemName?.en?.toLowerCase() === q) ||
    products.find((p) => p.name.en.toLowerCase().includes(q))
  );
}

export function findVariationId(
  product: Product,
  label?: string
): string | undefined {
  if (!label || !product.variations.length) return product.variations[0]?.id;
  const q = label.trim().toLowerCase();
  const hit = product.variations.find(
    (v) =>
      v.label?.en?.toLowerCase() === q ||
      v.label?.en?.toLowerCase().includes(q) ||
      v.id === label
  );
  return hit?.id ?? product.variations[0]?.id;
}

/** Inventory ledger balance vs FIFO layer value — for openings health. */
export function inventoryOpeningGap(
  db: {
    accounts: Account[];
    ledgerEntries: LedgerEntry[];
    stockBatches?: StockBatch[];
  },
  asOf: string
): { ledger: number; layers: number; gap: number } {
  const inv = db.accounts.find((a) => a.id === ACCT.inventory);
  const ledger = inv
    ? accountBalance(inv, db.ledgerEntries, asOf)
    : 0;
  const layers = roundMoney(
    (db.stockBatches ?? [])
      .filter((b: StockBatch) => b.qty > 0)
      .reduce((s: number, b: StockBatch) => s + b.qty * b.rate, 0)
  );
  return { ledger, layers, gap: roundMoney(layers - ledger) };
}

export function naturalOpeningSign(account: Account, amount: number): number {
  if (isDebitNormal(account.type)) return amount;
  return amount;
}
