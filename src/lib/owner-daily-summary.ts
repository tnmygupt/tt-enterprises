import {
  ACCT,
  accountBalance,
  allOpenPayables,
  allOpenReceivables,
  creditorsClosingList,
} from "@/lib/accounting";
import { stockAlertsFromDb } from "@/lib/accounting/analysis";
import { getAdminQueues } from "@/lib/admin-queues";
import { formatInr, roundMoney } from "@/lib/pricing";
import { proofPaidTotal } from "@/lib/proofs";
import { paymentAmountDue } from "@/lib/upi";
import type {
  Account,
  BillAllocation,
  LedgerEntry,
  Order,
  Party,
  Product,
  PurchaseOrder,
  StockMovement,
  UserProfile,
  Locale,
  Voucher,
  WalletDeposit,
} from "@/lib/types";
import type { AppSettings } from "@/lib/types";

export type OpsSnapshotDb = {
  settings: AppSettings;
  users: UserProfile[];
  orders: Order[];
  walletDeposits?: WalletDeposit[];
  parties: Party[];
  vouchers: Voucher[];
  billAllocations?: BillAllocation[];
  accounts: Account[];
  ledgerEntries: LedgerEntry[];
  products: Product[];
  stockMovements?: StockMovement[];
  purchaseOrders?: PurchaseOrder[];
};

export type OverduePartyRow = {
  party: Party;
  phone?: string;
  total: number;
  bills: { number: string; due: string; amount: number; daysOverdue: number }[];
};

export function partyPhone(
  party: Party,
  users: UserProfile[]
): string | undefined {
  const fromParty = party.phone?.trim();
  if (fromParty) return fromParty;
  if (!party.linkedUserId) return undefined;
  return users.find((u) => u.id === party.linkedUserId)?.phone?.trim();
}

export function ownerUsers(users: UserProfile[]): UserProfile[] {
  return users.filter(
    (u) => u.active && u.role === "super_admin" && !!u.phone?.trim()
  );
}

export function listOverdueParties(
  db: OpsSnapshotDb,
  today: string
): OverduePartyRow[] {
  const open = allOpenReceivables(
    db.parties,
    db.vouchers,
    db.billAllocations ?? [],
    today,
    db.orders
  ).filter((r) => r.daysOverdue > 0 && r.outstanding > 0.009);
  const byParty = new Map<string, typeof open>();
  for (const row of open) {
    const pid = row.voucher.partyId;
    if (!pid) continue;
    const list = byParty.get(pid) ?? [];
    list.push(row);
    byParty.set(pid, list);
  }
  const out: OverduePartyRow[] = [];
  for (const [partyId, bills] of byParty) {
    const party = db.parties.find((p) => p.id === partyId);
    if (!party?.active) continue;
    out.push({
      party,
      phone: partyPhone(party, db.users),
      total: roundMoney(bills.reduce((s, b) => s + b.outstanding, 0)),
      bills: bills.map((b) => ({
        number: b.voucher.number,
        due: (b.voucher.dueDate || b.voucher.date).slice(0, 10),
        amount: b.outstanding,
        daysOverdue: b.daysOverdue,
      })),
    });
  }
  out.sort((a, b) => b.total - a.total);
  return out;
}

export type StaleEstimateRow = {
  id: string;
  orderNumber: string;
  userId: string;
  userName: string;
  phone?: string;
  createdAt: string;
  daysOpen: number;
};

/** Open estimates ≥ minDays old whose stock is still reserved. Never auto-cancels. */
export function listStaleEstimates(
  orders: Order[],
  today: string,
  minDays = 5
): StaleEstimateRow[] {
  const todayDay = today.slice(0, 10);
  const todayMs = new Date(todayDay + "T00:00:00").getTime();
  const rows: StaleEstimateRow[] = [];
  for (const o of orders) {
    if (o.status !== "estimate") continue;
    if (o.stockReserved === false) continue;
    const created = o.createdAt.slice(0, 10);
    const daysOpen = Math.floor(
      (todayMs - new Date(created + "T00:00:00").getTime()) /
        (24 * 60 * 60 * 1000)
    );
    if (daysOpen < minDays) continue;
    rows.push({
      id: o.id,
      orderNumber: o.orderNumber,
      userId: o.userId,
      userName: o.userName,
      phone: o.phone?.trim() || undefined,
      createdAt: o.createdAt,
      daysOpen,
    });
  }
  rows.sort(
    (a, b) =>
      b.daysOpen - a.daysOpen || a.orderNumber.localeCompare(b.orderNumber)
  );
  return rows;
}

export function buildOwnerDailySummary(input: {
  db: OpsSnapshotDb;
  today: string;
  locale?: Locale;
}): {
  text: string;
  overdueTotal: number;
  payableTotal: number;
  creditorTotal: number;
  needVerify: number;
} {
  const locale = input.locale === "hi" ? "hi" : "en";
  const db = input.db;
  const today = input.today.slice(0, 10);
  const company = db.settings.companyName || "TT Enterprises";
  const queues = getAdminQueues(db);
  const needVerify = queues.needVerifyPayment;
  const pendingWallet = (db.walletDeposits ?? []).filter(
    (d) => d.status === "pending_verify" || d.status === "awaiting_proof"
  );
  const overdue = listOverdueParties(db, today);
  const overdueTotal = roundMoney(overdue.reduce((s, r) => s + r.total, 0));
  const payables = allOpenPayables(
    db.parties,
    db.vouchers,
    db.billAllocations ?? [],
    today
  );
  const payableTotal = roundMoney(
    payables.reduce((s, r) => s + r.outstanding, 0)
  );
  const creditors = creditorsClosingList(
    db.parties,
    db.vouchers,
    db.billAllocations ?? [],
    db.ledgerEntries,
    today
  );
  const creditorTotal = roundMoney(
    creditors.reduce((s, r) => s + r.closing, 0)
  );
  const cash = db.accounts.find((a) => a.id === ACCT.cash);
  const bank = db.accounts.find((a) => a.id === ACCT.bank);
  const cashBal = cash
    ? accountBalance(cash, db.ledgerEntries, today)
    : 0;
  const bankBal = bank
    ? accountBalance(bank, db.ledgerEntries, today)
    : 0;
  const salesToday = db.vouchers
    .filter((v) => v.type === "sale" && !v.voided && v.date.slice(0, 10) === today)
    .reduce((s, v) => s + v.total, 0);
  const newEstimates = db.orders.filter(
    (o) => o.status === "estimate" && o.createdAt.slice(0, 10) === today
  );
  const alertRows = stockAlertsFromDb(db, { asOf: today });
  const alerts = alertRows
    .filter((r) => r.kind === "reorder")
    .sort((a, b) => b.suggestedQty - a.suggestedQty);
  const idleStock = alertRows
    .filter((r) => r.kind === "slow" || r.kind === "dead")
    .sort(
      (a, b) =>
        (b.daysSinceOut ?? 9999) - (a.daysSinceOut ?? 9999) ||
        a.label.localeCompare(b.label)
    );
  const staleEstimates = listStaleEstimates(db.orders, today);
  const inr = (n: number) => formatInr(n, locale);

  const verifyLines = needVerify.slice(0, 12).map((o) => {
    const due = paymentAmountDue(o);
    const paid = proofPaidTotal(o.paymentProof);
    return locale === "hi"
      ? `• ${o.orderNumber} · जमा ${inr(paid)} / देय ${inr(due)}`
      : `• ${o.orderNumber} · in ${inr(paid)} / due ${inr(due)}`;
  });

  const overdueLines = overdue.slice(0, 12).map((r) =>
    locale === "hi"
      ? `• ${r.party.name} · ${inr(r.total)} · ${r.bills.length} बिल`
      : `• ${r.party.name} · ${inr(r.total)} · ${r.bills.length} bill(s)`
  );

  const payableLines = payables.slice(0, 12).map((r) => {
    const name =
      db.parties.find((p) => p.id === r.voucher.partyId)?.name ||
      r.voucher.partyId ||
      "Supplier";
    return locale === "hi"
      ? `• ${name} · ${r.voucher.number} · ${inr(r.outstanding)}`
      : `• ${name} · ${r.voucher.number} · ${inr(r.outstanding)}`;
  });

  const creditorLines = creditors.slice(0, 12).map((r) =>
    locale === "hi"
      ? `• ${r.name} · क्लोजिंग ${inr(r.closing)} · ${r.billCount} बिल`
      : `• ${r.name} · closing ${inr(r.closing)} · ${r.billCount} bill(s)`
  );

  const lines =
    locale === "hi"
      ? [
          `${company} — रोज़ाना सार (सुपर एडमिन)`,
          today,
          "",
          `नकद: ${inr(cashBal)}  ·  बैंक: ${inr(bankBal)}`,
          `आज की बिक्री: ${inr(salesToday)}  ·  नए एस्टिमेट: ${newEstimates.length}`,
          `पेमेंट वेरिफाई बाकी: ${needVerify.length}  ·  वॉलेट जमा: ${pendingWallet.length}`,
          `ओवरड्यू वसूली: ${inr(overdueTotal)} (${overdue.length} पार्टी)`,
          `देय बिल (पेएबल): ${inr(payableTotal)} (${payables.length} बिल)`,
          `लेनदार क्लोजिंग: ${inr(creditorTotal)} (${creditors.length} सप्लायर)`,
          `रीऑर्डर अलर्ट: ${alerts.length}  ·  पुराने एस्टिमेट: ${staleEstimates.length}`,
        ]
      : [
          `${company} — daily owner summary`,
          today,
          "",
          `Cash: ${inr(cashBal)}  ·  Bank: ${inr(bankBal)}`,
          `Sales today: ${inr(salesToday)}  ·  New estimates: ${newEstimates.length}`,
          `Payment proofs to verify: ${needVerify.length}  ·  Wallet deposits: ${pendingWallet.length}`,
          `Overdue receivables: ${inr(overdueTotal)} (${overdue.length} parties)`,
          `Open payables: ${inr(payableTotal)} (${payables.length} bills)`,
          `Creditors closing: ${inr(creditorTotal)} (${creditors.length} suppliers)`,
          `Reorder alerts: ${alerts.length}  ·  Stale estimates: ${staleEstimates.length}`,
        ];

  if (alerts.length) {
    lines.push("", locale === "hi" ? "टॉप रीऑर्डर:" : "Top reorder:");
    for (const r of alerts.slice(0, 5)) {
      lines.push(
        locale === "hi"
          ? `• ${r.label} · ${r.suggestedQty}`
          : `• ${r.label} · order ${r.suggestedQty}`
      );
    }
  }
  if (idleStock.length) {
    lines.push("", locale === "hi" ? "स्लो / डेड स्टॉक:" : "Slow / dead stock:");
    for (const r of idleStock.slice(0, 5)) {
      const idle =
        r.daysSinceOut == null
          ? locale === "hi"
            ? "कभी नहीं"
            : "never"
          : `${r.daysSinceOut}d`;
      lines.push(`• ${r.label} · ${r.kind} · ${idle}`);
    }
  }
  if (staleEstimates.length) {
    const names = [
      ...new Set(staleEstimates.map((s) => s.userName || s.orderNumber)),
    ].slice(0, 8);
    lines.push(
      "",
      locale === "hi"
        ? `पुराने एस्टिमेट (≥5 दिन, स्टॉक आरक्षित): ${staleEstimates.length}`
        : `Stale estimates (≥5d, stock reserved): ${staleEstimates.length}`
    );
    for (const name of names) lines.push(`• ${name}`);
    if (
      [...new Set(staleEstimates.map((s) => s.userName || s.orderNumber))]
        .length > names.length
    ) {
      const extra =
        [...new Set(staleEstimates.map((s) => s.userName || s.orderNumber))]
          .length - names.length;
      lines.push(locale === "hi" ? `…और ${extra}` : `…plus ${extra} more`);
    }
  }

  if (verifyLines.length) {
    lines.push("", locale === "hi" ? "वेरिफाई कतार:" : "Verify queue:");
    lines.push(...verifyLines);
    if (needVerify.length > verifyLines.length) {
      lines.push(
        locale === "hi"
          ? `…और ${needVerify.length - verifyLines.length}`
          : `…plus ${needVerify.length - verifyLines.length} more`
      );
    }
  }
  if (overdueLines.length) {
    lines.push("", locale === "hi" ? "ओवरड्यू पार्टी:" : "Overdue parties:");
    lines.push(...overdueLines);
    if (overdue.length > overdueLines.length) {
      lines.push(
        locale === "hi"
          ? `…और ${overdue.length - overdueLines.length}`
          : `…plus ${overdue.length - overdueLines.length} more`
      );
    }
  }
  if (payableLines.length) {
    lines.push("", locale === "hi" ? "देय बिल:" : "Payables:");
    lines.push(...payableLines);
    if (payables.length > payableLines.length) {
      lines.push(
        locale === "hi"
          ? `…और ${payables.length - payableLines.length}`
          : `…plus ${payables.length - payableLines.length} more`
      );
    }
  }
  if (creditorLines.length) {
    lines.push("", locale === "hi" ? "लेनदार क्लोजिंग:" : "Creditor closing:");
    lines.push(...creditorLines);
    if (creditors.length > creditorLines.length) {
      lines.push(
        locale === "hi"
          ? `…और ${creditors.length - creditorLines.length}`
          : `…plus ${creditors.length - creditorLines.length} more`
      );
    }
  }
  lines.push(
    "",
    locale === "hi"
      ? "पेमेंट डेस्क / BRS ऐप में खोलें।"
      : "Open Payments desk / BRS on the site."
  );

  return {
    text: lines.join("\n"),
    overdueTotal,
    payableTotal,
    creditorTotal,
    needVerify: needVerify.length,
  };
}

export function orderVerifyAmount(order: Order): {
  due: number;
  paid: number;
  remaining: number;
} {
  const due = paymentAmountDue(order);
  const paid = proofPaidTotal(order.paymentProof);
  return {
    due,
    paid,
    remaining: Math.max(0, roundMoney(due - paid)),
  };
}
