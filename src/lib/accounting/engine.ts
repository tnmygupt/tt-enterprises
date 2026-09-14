import type {
  Account,
  AccountType,
  LedgerEntry,
  Locale,
  Party,
  Voucher,
  VoucherLine,
  VoucherType,
} from "../types";
import { roundMoney, roundOffRupees } from "../pricing";
import { ACCT } from "./seed";

export function lineTax(amount: number, taxPercent?: number): number {
  return roundMoney(amount * ((taxPercent ?? 0) / 100));
}

export function summarizeLines(lines: VoucherLine[]): {
  subtotal: number;
  taxAmount: number;
  /** Exact total before nearest-rupee round-off */
  exactTotal: number;
  /** total − exactTotal (positive = rounded up) */
  roundOff: number;
  /** Payable / bill total — nearest whole rupee */
  total: number;
} {
  const subtotal = roundMoney(lines.reduce((s, l) => s + l.amount, 0));
  const taxAmount = roundMoney(
    lines.reduce((s, l) => s + lineTax(l.amount, l.taxPercent), 0)
  );
  const exactTotal = roundMoney(subtotal + taxAmount);
  const total = roundOffRupees(exactTotal);
  const roundOff = roundMoney(total - exactTotal);
  return { subtotal, taxAmount, exactTotal, roundOff, total };
}

function entry(partial: Omit<LedgerEntry, "id"> & { id?: string }): LedgerEntry {
  return {
    id: partial.id ?? `le_${crypto.randomUUID()}`,
    ...partial,
  };
}

/** Post paisa difference so party/cash side (rounded) balances line totals. */
function pushRoundOffEntry(
  rows: LedgerEntry[],
  base: Omit<LedgerEntry, "id" | "accountId" | "debit" | "credit" | "partyId">,
  roundOff: number,
  /** When true, party was debited for rounded total (sale / CN party side). */
  partyDebited: boolean,
  partyId?: string
): void {
  if (Math.abs(roundOff) < 0.005) return;
  // Sale: round up → Cr Round Off; round down → Dr Round Off
  // Purchase: opposite (party is credited)
  const creditRoundOff = partyDebited ? roundOff > 0 : roundOff < 0;
  const amt = Math.abs(roundOff);
  rows.push(
    entry({
      ...base,
      accountId: ACCT.roundOff,
      partyId,
      debit: creditRoundOff ? 0 : amt,
      credit: creditRoundOff ? amt : 0,
    })
  );
}

/** Build balanced ledger rows for a voucher (does not persist). */
export function buildLedgerEntries(voucher: Voucher): LedgerEntry[] {
  const summarized = summarizeLines(voucher.lines);
  const subtotal = voucher.subtotal ?? summarized.subtotal;
  const taxAmount = voucher.taxAmount ?? summarized.taxAmount;
  const total = voucher.total ?? summarized.total;
  const roundOff =
    voucher.roundOff != null ? voucher.roundOff : summarized.roundOff;
  const base = {
    voucherId: voucher.id,
    voucherNumber: voucher.number,
    voucherType: voucher.type,
    date: voucher.date.slice(0, 10),
    narration: voucher.narration,
    voided: false,
  };

  if (voucher.type === "sale") {
    if (!voucher.partyId) throw new Error("Sale requires a customer party");
    // Opening receivable: Dr Debtors / Cr Capital (no sales, no COGS)
    if (voucher.isOpening) {
      const rows: LedgerEntry[] = [
        entry({
          ...base,
          accountId: ACCT.debtors,
          partyId: voucher.partyId,
          debit: total,
          credit: 0,
        }),
        entry({
          ...base,
          accountId: ACCT.capital,
          partyId: voucher.partyId,
          debit: 0,
          credit: total,
        }),
      ];
      assertBalanced(rows);
      return rows;
    }
    const rows: LedgerEntry[] = [
      entry({
        ...base,
        accountId: ACCT.debtors,
        partyId: voucher.partyId,
        debit: total,
        credit: 0,
      }),
    ];
    // Split income: stock/default lines → Sales; charge lines (accountId) → that head
    const incomeByAccount = new Map<string, number>();
    for (const line of voucher.lines) {
      const head = line.accountId || ACCT.sales;
      incomeByAccount.set(
        head,
        roundMoney((incomeByAccount.get(head) ?? 0) + line.amount)
      );
    }
    for (const [accountId, credit] of incomeByAccount) {
      if (Math.abs(credit) < 0.001) continue;
      rows.push(
        entry({
          ...base,
          accountId,
          partyId: voucher.partyId,
          debit: credit < 0 ? roundMoney(-credit) : 0,
          credit: credit > 0 ? credit : 0,
        })
      );
    }
    if (taxAmount > 0) {
      rows.push(
        entry({
          ...base,
          accountId: ACCT.taxOutput,
          partyId: voucher.partyId,
          debit: 0,
          credit: taxAmount,
        })
      );
    }
    pushRoundOffEntry(rows, base, roundOff, true, voucher.partyId);
    // Post COGS if present
    if ((voucher.cogsAmount ?? 0) > 0.001) {
      rows.push(
        entry({
          ...base,
          accountId: ACCT.cogs,
          partyId: voucher.partyId,
          debit: voucher.cogsAmount!,
          credit: 0,
        }),
        entry({
          ...base,
          accountId: ACCT.inventory,
          partyId: voucher.partyId,
          debit: 0,
          credit: voucher.cogsAmount!,
        })
      );
    }
    assertBalanced(rows);
    return rows;
  }

  if (voucher.type === "purchase") {
    if (!voucher.partyId) throw new Error("Purchase requires a supplier party");
    // Opening payable: Dr Capital / Cr Creditors (stock via opening stock)
    if (voucher.isOpening) {
      const rows: LedgerEntry[] = [
        entry({
          ...base,
          accountId: ACCT.capital,
          partyId: voucher.partyId,
          debit: total,
          credit: 0,
        }),
        entry({
          ...base,
          accountId: ACCT.creditors,
          partyId: voucher.partyId,
          debit: 0,
          credit: total,
        }),
      ];
      assertBalanced(rows);
      return rows;
    }
    const rows: LedgerEntry[] = [];
    // Goods → Inventory; expense lines (freight etc.) → their expense heads
    const debitByAccount = new Map<string, number>();
    for (const line of voucher.lines) {
      const head =
        line.accountId && !line.productId ? line.accountId : ACCT.inventory;
      debitByAccount.set(
        head,
        roundMoney((debitByAccount.get(head) ?? 0) + line.amount)
      );
    }
    for (const [accountId, debit] of debitByAccount) {
      if (Math.abs(debit) < 0.001) continue;
      rows.push(
        entry({
          ...base,
          accountId,
          partyId: voucher.partyId,
          debit,
          credit: 0,
        })
      );
    }
    if (taxAmount > 0) {
      rows.push(
        entry({
          ...base,
          accountId: ACCT.taxInput,
          partyId: voucher.partyId,
          debit: taxAmount,
          credit: 0,
        })
      );
    }
    rows.push(
      entry({
        ...base,
        accountId: ACCT.creditors,
        partyId: voucher.partyId,
        debit: 0,
        credit: total,
      })
    );
    pushRoundOffEntry(rows, base, roundOff, false, voucher.partyId);
    assertBalanced(rows);
    return rows;
  }

  if (voucher.type === "credit_note") {
    // Sales return: reverse sale — income heads Dr, Debtors Cr (+ tax)
    if (!voucher.partyId) throw new Error("Credit note requires a customer");
    const rows: LedgerEntry[] = [];
    const incomeByAccount = new Map<string, number>();
    for (const line of voucher.lines) {
      const head = line.accountId || ACCT.sales;
      incomeByAccount.set(
        head,
        roundMoney((incomeByAccount.get(head) ?? 0) + line.amount)
      );
    }
    for (const [accountId, debit] of incomeByAccount) {
      if (Math.abs(debit) < 0.001) continue;
      rows.push(
        entry({
          ...base,
          accountId,
          partyId: voucher.partyId,
          debit,
          credit: 0,
        })
      );
    }
    if (taxAmount > 0) {
      rows.push(
        entry({
          ...base,
          accountId: ACCT.taxOutput,
          partyId: voucher.partyId,
          debit: taxAmount,
          credit: 0,
        })
      );
    }
    rows.push(
      entry({
        ...base,
        accountId: ACCT.debtors,
        partyId: voucher.partyId,
        debit: 0,
        credit: total,
      })
    );
    pushRoundOffEntry(rows, base, roundOff, false, voucher.partyId);
    // Restore inventory value
    if ((voucher.cogsAmount ?? 0) > 0.001) {
      rows.push(
        entry({
          ...base,
          accountId: ACCT.inventory,
          partyId: voucher.partyId,
          debit: voucher.cogsAmount!,
          credit: 0,
        }),
        entry({
          ...base,
          accountId: ACCT.cogs,
          partyId: voucher.partyId,
          debit: 0,
          credit: voucher.cogsAmount!,
        })
      );
    }
    assertBalanced(rows);
    return rows;
  }

  if (voucher.type === "debit_note") {
    // Purchase return: Creditors Dr, Inventory Cr (+ tax)
    if (!voucher.partyId) throw new Error("Debit note requires a supplier");
    const rows: LedgerEntry[] = [
      entry({
        ...base,
        accountId: ACCT.creditors,
        partyId: voucher.partyId,
        debit: total,
        credit: 0,
      }),
      entry({
        ...base,
        accountId: ACCT.inventory,
        partyId: voucher.partyId,
        debit: 0,
        credit: subtotal,
      }),
    ];
    if (taxAmount > 0) {
      rows.push(
        entry({
          ...base,
          accountId: ACCT.taxInput,
          partyId: voucher.partyId,
          debit: 0,
          credit: taxAmount,
        })
      );
    }
    pushRoundOffEntry(rows, base, roundOff, true, voucher.partyId);
    assertBalanced(rows);
    return rows;
  }

  if (voucher.type === "receipt") {
    const cashId = voucher.cashAccountId || ACCT.cash;
    if (!voucher.partyId) throw new Error("Receipt requires a party");
    const rows: LedgerEntry[] = [
      entry({
        ...base,
        accountId: cashId,
        partyId: voucher.partyId,
        debit: total,
        credit: 0,
      }),
      entry({
        ...base,
        accountId: ACCT.debtors,
        partyId: voucher.partyId,
        debit: 0,
        credit: total,
      }),
    ];
    assertBalanced(rows);
    return rows;
  }

  if (voucher.type === "payment") {
    const cashId = voucher.cashAccountId || ACCT.cash;
    // Expense payment: first line has expense accountId (party optional).
    // Supplier payment: party required, defaults to creditors.
    const expenseAccountId = voucher.lines[0]?.accountId;
    if (!expenseAccountId && !voucher.partyId) {
      throw new Error("Payment requires a supplier or an expense head");
    }
    const rows: LedgerEntry[] = [
      expenseAccountId
        ? entry({
            ...base,
            accountId: expenseAccountId,
            partyId: voucher.partyId,
            debit: total,
            credit: 0,
          })
        : entry({
            ...base,
            accountId: ACCT.creditors,
            partyId: voucher.partyId,
            debit: total,
            credit: 0,
          }),
      entry({
        ...base,
        accountId: cashId,
        partyId: voucher.partyId,
        debit: 0,
        credit: total,
      }),
    ];
    assertBalanced(rows);
    return rows;
  }

  // Journal: each line must specify accountId; amount > 0 = debit, use taxPercent hack? 
  // Simpler: lines with positive amount debit, negative credit — or use rate as side
  // Convention: qty=1 debit if rate>=0 stored as amount; for journal we require paired lines via amount and a flag
  // Use: if taxPercent === -1 then credit else debit
  const rows: LedgerEntry[] = voucher.lines.map((l) => {
    if (!l.accountId) throw new Error("Journal line needs account");
    const isCredit = (l.taxPercent ?? 0) < 0;
    return entry({
      ...base,
      accountId: l.accountId,
      partyId: voucher.partyId,
      debit: isCredit ? 0 : Math.abs(l.amount),
      credit: isCredit ? Math.abs(l.amount) : 0,
    });
  });
  assertBalanced(rows);
  return rows;
}

export function assertBalanced(entries: LedgerEntry[]): void {
  const debit = roundMoney(entries.reduce((s, e) => s + e.debit, 0));
  const credit = roundMoney(entries.reduce((s, e) => s + e.credit, 0));
  if (Math.abs(debit - credit) > 0.02) {
    throw new Error(`Voucher not balanced: Dr ${debit} ≠ Cr ${credit}`);
  }
}

/** Natural balance sign: assets/expenses debit-positive; others credit-positive */
export function isDebitNormal(type: AccountType): boolean {
  return type === "asset" || type === "expense";
}

export function accountBalance(
  account: Account,
  entries: LedgerEntry[],
  asOf?: string
): number {
  const cutoff = asOf?.slice(0, 10);
  const filtered = entries.filter(
    (e) =>
      !e.voided &&
      e.accountId === account.id &&
      (!cutoff || e.date.slice(0, 10) <= cutoff)
  );
  const movement = filtered.reduce(
    (s, e) => s + e.debit - e.credit,
    0
  );
  // openingBalance stored in natural sign (debit-normal for asset/expense)
  if (isDebitNormal(account.type)) {
    return roundMoney(account.openingBalance + movement);
  }
  // credit-normal: opening is credit; movement debit-credit reduces credit balance
  return roundMoney(account.openingBalance - movement);
}

/** Party balance: customer = receivable (debit), supplier = payable (credit) */
export function partyBalance(
  party: Party,
  entries: LedgerEntry[],
  asOf?: string
): number {
  const cutoff = asOf?.slice(0, 10);
  const controlId =
    party.type === "customer" ? ACCT.debtors : ACCT.creditors;
  const filtered = entries.filter(
    (e) =>
      !e.voided &&
      e.partyId === party.id &&
      e.accountId === controlId &&
      (!cutoff || e.date.slice(0, 10) <= cutoff)
  );
  const movement = filtered.reduce((s, e) => s + e.debit - e.credit, 0);
  if (party.type === "customer") {
    return roundMoney(party.openingBalance + movement);
  }
  // payable: credit balance shown positive
  return roundMoney(party.openingBalance - movement);
}

export interface ReportRow {
  accountId: string;
  code: string;
  name: string;
  amount: number;
}

export function profitAndLoss(
  accounts: Account[],
  entries: LedgerEntry[],
  from: string,
  to: string
): {
  income: ReportRow[];
  expenses: ReportRow[];
  totalIncome: number;
  totalExpense: number;
  netProfit: number;
} {
  const fromD = from.slice(0, 10);
  const toD = to.slice(0, 10);
  const period = entries.filter(
    (e) => !e.voided && e.date.slice(0, 10) >= fromD && e.date.slice(0, 10) <= toD
  );

  const income: ReportRow[] = [];
  const expenses: ReportRow[] = [];

  for (const a of accounts.filter((x) => x.active)) {
    const mov = period
      .filter((e) => e.accountId === a.id)
      .reduce((s, e) => s + e.debit - e.credit, 0);
    if (a.type === "income") {
      const amt = roundMoney(-mov); // credit increases income
      if (Math.abs(amt) > 0.001) {
        income.push({
          accountId: a.id,
          code: a.code,
          name: a.name.en,
          amount: amt,
        });
      }
    }
    if (a.type === "expense") {
      const amt = roundMoney(mov);
      if (Math.abs(amt) > 0.001) {
        expenses.push({
          accountId: a.id,
          code: a.code,
          name: a.name.en,
          amount: amt,
        });
      }
    }
  }

  const totalIncome = roundMoney(income.reduce((s, r) => s + r.amount, 0));
  const totalExpense = roundMoney(expenses.reduce((s, r) => s + r.amount, 0));
  return {
    income,
    expenses,
    totalIncome,
    totalExpense,
    netProfit: roundMoney(totalIncome - totalExpense),
  };
}

export function balanceSheet(
  accounts: Account[],
  entries: LedgerEntry[],
  asOf: string,
  locale: Locale = "en",
  /** FY start month 1–12 (default April = 4 for India) */
  fyStartMonth = 4
): {
  assets: ReportRow[];
  liabilities: ReportRow[];
  equity: ReportRow[];
  totalAssets: number;
  totalLiabEquity: number;
  netProfitYtd: number;
} {
  const asOfD = asOf.slice(0, 10);
  const month = Math.min(12, Math.max(1, fyStartMonth || 4));
  const y = Number(asOfD.slice(0, 4));
  const m = Number(asOfD.slice(5, 7));
  const startYear = m >= month ? y : y - 1;
  const yearStart = `${startYear}-${String(month).padStart(2, "0")}-01`;
  const pl = profitAndLoss(accounts, entries, yearStart, asOfD);

  const assets: ReportRow[] = [];
  const liabilities: ReportRow[] = [];
  const equity: ReportRow[] = [];

  for (const a of accounts.filter((x) => x.active)) {
    const bal = accountBalance(a, entries, asOfD);
    if (Math.abs(bal) < 0.001) continue;
    const row: ReportRow = {
      accountId: a.id,
      code: a.code,
      name: a.name[locale] || a.name.en,
      amount: Math.abs(bal),
    };
    if (a.type === "asset") assets.push(row);
    else if (a.type === "liability") liabilities.push(row);
    else if (a.type === "equity") equity.push(row);
  }

  if (Math.abs(pl.netProfit) > 0.001) {
    equity.push({
      accountId: "_pl",
      code: "PL",
      name: locale === "hi" ? "वर्ष का लाभ / हानि" : "Profit / Loss (YTD)",
      amount: pl.netProfit,
    });
  }

  const totalAssets = roundMoney(assets.reduce((s, r) => s + r.amount, 0));
  const totalLiabEquity = roundMoney(
    liabilities.reduce((s, r) => s + r.amount, 0) +
      equity.reduce((s, r) => s + r.amount, 0)
  );

  return {
    assets,
    liabilities,
    equity,
    totalAssets,
    totalLiabEquity,
    netProfitYtd: pl.netProfit,
  };
}

export function nextVoucherNumber(
  vouchers: Voucher[],
  type: VoucherType
): string {
  const prefix: Record<VoucherType, string> = {
    sale: "SAL",
    purchase: "PUR",
    receipt: "RCT",
    payment: "PMT",
    journal: "JRN",
    credit_note: "CN",
    debit_note: "DN",
  };
  const p = prefix[type];
  let max = 1000;
  for (const v of vouchers) {
    if (v.type !== type) continue;
    const n = Number(v.number.replace(/\D/g, ""));
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return `${p}-${max + 1}`;
}

/** Trial balance: debit/credit columns as-of date */
export function trialBalance(
  accounts: Account[],
  entries: LedgerEntry[],
  asOf: string
): {
  rows: {
    accountId: string;
    code: string;
    name: string;
    debit: number;
    credit: number;
  }[];
  totalDebit: number;
  totalCredit: number;
} {
  const rows: {
    accountId: string;
    code: string;
    name: string;
    debit: number;
    credit: number;
  }[] = [];
  for (const a of accounts.filter((x) => x.active)) {
    const bal = accountBalance(a, entries, asOf);
    if (Math.abs(bal) < 0.001) continue;
    if (isDebitNormal(a.type)) {
      rows.push({
        accountId: a.id,
        code: a.code,
        name: a.name.en,
        debit: bal >= 0 ? bal : 0,
        credit: bal < 0 ? Math.abs(bal) : 0,
      });
    } else {
      rows.push({
        accountId: a.id,
        code: a.code,
        name: a.name.en,
        debit: bal < 0 ? Math.abs(bal) : 0,
        credit: bal >= 0 ? bal : 0,
      });
    }
  }
  rows.sort((a, b) => a.code.localeCompare(b.code));
  const totalDebit = roundMoney(rows.reduce((s, r) => s + r.debit, 0));
  const totalCredit = roundMoney(rows.reduce((s, r) => s + r.credit, 0));
  return { rows, totalDebit, totalCredit };
}

export function itemSalesReport(
  vouchers: Voucher[],
  from: string,
  to: string
): {
  key: string;
  label: string;
  productId?: string;
  bundles: number;
  secondaryQty: number;
  amount: number;
}[] {
  const fromD = from.slice(0, 10);
  const toD = to.slice(0, 10);
  const map = new Map<
    string,
    {
      key: string;
      label: string;
      productId?: string;
      bundles: number;
      secondaryQty: number;
      amount: number;
    }
  >();
  for (const v of vouchers) {
    if (v.voided) continue;
    if (v.date.slice(0, 10) < fromD || v.date.slice(0, 10) > toD) continue;
    const sign = v.type === "credit_note" ? -1 : v.type === "sale" ? 1 : 0;
    if (!sign) continue;
    for (const l of v.lines) {
      const key = l.productId
        ? `${l.productId}|${l.variationId ?? ""}`
        : `lbl:${l.itemLabel}`;
      const cur = map.get(key) || {
        key,
        label: l.itemLabel,
        productId: l.productId,
        bundles: 0,
        secondaryQty: 0,
        amount: 0,
      };
      cur.bundles = roundMoney(cur.bundles + sign * l.qty);
      cur.secondaryQty = roundMoney(
        cur.secondaryQty + sign * (l.secondaryQty ?? l.qty)
      );
      cur.amount = roundMoney(cur.amount + sign * l.amount);
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export function itemPurchaseReport(
  vouchers: Voucher[],
  from: string,
  to: string
): {
  key: string;
  label: string;
  productId?: string;
  bundles: number;
  secondaryQty: number;
  amount: number;
}[] {
  const fromD = from.slice(0, 10);
  const toD = to.slice(0, 10);
  const map = new Map<
    string,
    {
      key: string;
      label: string;
      productId?: string;
      bundles: number;
      secondaryQty: number;
      amount: number;
    }
  >();
  for (const v of vouchers) {
    if (v.voided) continue;
    if (v.date.slice(0, 10) < fromD || v.date.slice(0, 10) > toD) continue;
    const sign = v.type === "debit_note" ? -1 : v.type === "purchase" ? 1 : 0;
    if (!sign) continue;
    for (const l of v.lines) {
      const key = l.productId
        ? `${l.productId}|${l.variationId ?? ""}`
        : `lbl:${l.itemLabel}`;
      const cur = map.get(key) || {
        key,
        label: l.itemLabel,
        productId: l.productId,
        bundles: 0,
        secondaryQty: 0,
        amount: 0,
      };
      cur.bundles = roundMoney(cur.bundles + sign * l.qty);
      cur.secondaryQty = roundMoney(
        cur.secondaryQty + sign * (l.secondaryQty ?? l.qty)
      );
      cur.amount = roundMoney(cur.amount + sign * l.amount);
      map.set(key, cur);
    }
  }
  return [...map.values()].sort((a, b) => b.amount - a.amount);
}

export function accountLabel(
  accounts: Account[],
  id: string,
  locale: Locale
): string {
  const a = accounts.find((x) => x.id === id);
  return a ? `${a.code} · ${a.name[locale]}` : id;
}
