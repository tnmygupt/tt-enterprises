import {
  ACCT,
  accountBalance,
  allOpenPayables,
  allOpenReceivables,
  profitAndLoss,
  stockValuation,
} from "@/lib/accounting";
import { deriveDayAttendance, suspiciousPunches } from "@/lib/hr";
import {
  cashMismatch,
  isShortage,
  isSurplus,
  isUncountedLine,
  lineVariance,
  shortageValue,
} from "@/lib/stock-count";
import { roundMoney } from "@/lib/pricing";
import type { AppDatabase } from "@/lib/store/db";
import type { CashCount, HrPunch, MonthlyAudit, StockCount, UserProfile } from "@/lib/types";

export type MonthCloseBlocker =
  | "noSubmittedCount"
  | "pendingShortages"
  | "cashNotAccepted";

export function monthCloseStamp(
  audits: MonthlyAudit[] | undefined,
  month: string
): MonthlyAudit | undefined {
  return (audits ?? [])
    .filter((a) => a.month === month)
    .sort((a, b) => b.closedAt.localeCompare(a.closedAt))[0];
}

export function monthCloseReady(input: {
  stock?: StockCount | null;
  cash?: CashCount | null;
}): { ready: boolean; reasons: MonthCloseBlocker[] } {
  const reasons: MonthCloseBlocker[] = [];
  const stock = input.stock;
  if (!stock || stock.status === "draft") reasons.push("noSubmittedCount");
  else {
    const pending = (stock.lines ?? []).some((l) => {
      const needs =
        isShortage(l) ||
        isUncountedLine(l) ||
        (l.counted === true && (l.countedQty || 0) === 0 && l.bookQty > 0);
      if (!needs) return false;
      return l.ownerDecision !== "approved" && l.ownerDecision !== "rejected";
    });
    if (pending) reasons.push("pendingShortages");
  }
  const cash = input.cash;
  const noted = Boolean(cash?.note?.trim());
  const cashOk =
    cash &&
    cash.status !== "draft" &&
    (cash.ownerDecision === "approved" ||
      (noted && cash.ownerDecision !== "rejected"));
  if (!cashOk) reasons.push("cashNotAccepted");
  return { ready: reasons.length === 0, reasons };
}

export type MonthlyAuditReport = {
  month: string;
  stockShortages: {
    label: string;
    sku?: string;
    bookQty: number;
    countedQty?: number;
    variance: number;
    shortageValue: number;
    uncounted: boolean;
    decision?: string;
  }[];
  uncountedSkus: number;
  uncountedLines: {
    label: string;
    sku?: string;
    bookQty: number;
  }[];
  surplusLines: {
    label: string;
    sku?: string;
    bookQty: number;
    countedQty?: number;
    variance: number;
  }[];
  stamp: {
    closedAt: string;
    closedBy: string;
    closedByName: string;
    note?: string;
  } | null;
  ready: { ready: boolean; reasons: MonthCloseBlocker[] };
  cashDecision?: string;
  cashNote?: string;
  cash: {
    cashDiff: number;
    bankDiff: number;
    bookCash: number;
    bookBank: number;
    countedCash?: number;
    statementBank?: number;
  } | null;
  gpsFlags: {
    userName: string;
    at: string;
    kind: string;
    insideFence: boolean;
    weakGps: boolean;
    accuracyM?: number;
  }[];
  missingClockOut: { userName: string; date: string }[];
  absenteeism: { userName: string; absentDays: number }[];
  pl: { income: number; expense: number; net: number };
  cashClose: number;
  bankClose: number;
  ar: number;
  ap: number;
  overdueAr: number;
  stockBookValue: number;
  stockCountedValue: number;
  payrollNet: number;
};

function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return {
    from: `${month}-01`,
    to: `${month}-${String(last).padStart(2, "0")}`,
  };
}

function staffName(users: UserProfile[], id: string): string {
  return users.find((u) => u.id === id)?.name || id;
}

export function buildMonthlyAuditReport(
  db: AppDatabase,
  month: string
): MonthlyAuditReport {
  const { from, to } = monthRange(month);
  const counts = (db.stockCounts ?? []).filter(
    (c) => c.month === month && c.status !== "draft"
  );
  const stockSession: StockCount | undefined = counts.sort((a, b) =>
    (b.submittedAt || b.updatedAt).localeCompare(a.submittedAt || a.updatedAt)
  )[0];
  const cashSession: CashCount | undefined = (db.cashCounts ?? [])
    .filter((c) => c.month === month && c.status !== "draft")
    .sort((a, b) =>
      (b.submittedAt || b.updatedAt).localeCompare(a.submittedAt || a.updatedAt)
    )[0];

  const stockShortages = (stockSession?.lines ?? [])
    .filter(
      (l) =>
        isShortage(l) ||
        (l.counted && (l.countedQty || 0) === 0 && l.bookQty > 0)
    )
    .map((l) => ({
      label: l.label || l.sku || l.productId,
      sku: l.sku,
      bookQty: l.bookQty,
      countedQty: l.countedQty,
      variance: lineVariance(l),
      shortageValue: shortageValue(l),
      uncounted: !l.counted,
      decision: l.ownerDecision,
    }))
    .sort((a, b) => b.shortageValue - a.shortageValue);

  const uncounted = (stockSession?.lines ?? []).filter(isUncountedLine);
  const uncountedSkus = uncounted.length;
  const uncountedLines = uncounted.map((l) => ({
    label: l.label || l.sku || l.productId,
    sku: l.sku,
    bookQty: l.bookQty,
  }));
  const surplusMapped = (stockSession?.lines ?? []).filter(isSurplus).map((l) => ({
    label: l.label || l.sku || l.productId,
    sku: l.sku,
    bookQty: l.bookQty,
    countedQty: l.countedQty,
    variance: lineVariance(l),
  }));
  const stampRow = monthCloseStamp(db.monthlyAudits, month);
  const ready = monthCloseReady({ stock: stockSession, cash: cashSession });

  const cash = cashSession
    ? {
        ...cashMismatch(cashSession),
        bookCash: cashSession.bookCash,
        bookBank: cashSession.bookBank,
        countedCash: cashSession.countedCash,
        statementBank: cashSession.statementBank,
      }
    : null;

  const punches = db.hrPunches ?? [];
  const gpsFlags = suspiciousPunches(punches, month).map((p: HrPunch) => ({
    userName: staffName(db.users, p.userId),
    at: p.at,
    kind: p.kind,
    insideFence: p.insideFence,
    weakGps: Boolean(p.weakGps),
    accuracyM: p.accuracyM,
  }));

  const staff = (db.users ?? []).filter(
    (u) => u.active && u.role !== "customer"
  );
  const missingClockOut: { userName: string; date: string }[] = [];
  const absenteeism: { userName: string; absentDays: number }[] = [];
  const [yy, mm] = month.split("-").map(Number);
  const last = new Date(yy, mm, 0).getDate();
  for (const u of staff) {
    let absent = 0;
    const terms = (db.hrTerms ?? []).find((t) => t.userId === u.id);
    const weekOff = terms?.weekOff ?? 0;
    for (let d = 1; d <= last; d++) {
      const date = `${month}-${String(d).padStart(2, "0")}`;
      const dow = new Date(date + "T00:00:00").getDay();
      if (dow === weekOff) continue;
      const att = deriveDayAttendance(punches, u.id, date);
      if (att.missingOut) {
        missingClockOut.push({ userName: u.name, date });
      }
      if (!att.present && !att.half) absent += 1;
    }
    if (absent > 0) absenteeism.push({ userName: u.name, absentDays: absent });
  }
  absenteeism.sort((a, b) => b.absentDays - a.absentDays);

  const pl = profitAndLoss(db.accounts, db.ledgerEntries, from, to);
  const cashAcct = db.accounts.find((a) => a.id === ACCT.cash);
  const bankAcct = db.accounts.find((a) => a.id === ACCT.bank);
  const today = to;
  const arRows = allOpenReceivables(
    db.parties,
    db.vouchers,
    db.billAllocations ?? [],
    today
  );
  const apRows = allOpenPayables(
    db.parties,
    db.vouchers,
    db.billAllocations ?? [],
    today
  );
  const valuation = stockValuation(db.stockBatches ?? []);
  let stockCountedValue = 0;
  if (stockSession) {
    for (const line of stockSession.lines) {
      const qty =
        line.countedQty != null ? line.countedQty : line.bookQty;
      stockCountedValue += (Number(line.unitRate) || 0) * qty;
    }
  }

  const payrollNet = (db.hrPayslips ?? [])
    .filter((p) => p.month === month)
    .reduce((s, p) => s + (Number(p.net) || 0), 0);

  return {
    month,
    stockShortages,
    uncountedSkus,
    uncountedLines,
    surplusLines: surplusMapped,
    stamp: stampRow
      ? {
          closedAt: stampRow.closedAt,
          closedBy: stampRow.closedBy,
          closedByName: staffName(db.users, stampRow.closedBy),
          note: stampRow.note,
        }
      : null,
    ready,
    cashDecision: cashSession?.ownerDecision,
    cashNote: cashSession?.note,
    cash,
    gpsFlags,
    missingClockOut,
    absenteeism,
    pl: {
      income: pl.totalIncome,
      expense: pl.totalExpense,
      net: pl.netProfit,
    },
    cashClose: cashAcct
      ? accountBalance(cashAcct, db.ledgerEntries, to)
      : 0,
    bankClose: bankAcct
      ? accountBalance(bankAcct, db.ledgerEntries, to)
      : 0,
    ar: roundMoney(arRows.reduce((s, r) => s + r.outstanding, 0)),
    ap: roundMoney(apRows.reduce((s, r) => s + r.outstanding, 0)),
    overdueAr: roundMoney(
      arRows.filter((r) => r.daysOverdue > 0).reduce((s, r) => s + r.outstanding, 0)
    ),
    stockBookValue: roundMoney(
      valuation.reduce((s, r) => s + (r.value || 0), 0)
    ),
    stockCountedValue: roundMoney(stockCountedValue),
    payrollNet: roundMoney(payrollNet),
  };
}
