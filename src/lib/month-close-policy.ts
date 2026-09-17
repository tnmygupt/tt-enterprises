import { monthCloseReady, monthCloseStamp } from "@/lib/owner-monthly-audit";
import {
  addDaysIso,
  dateInIst,
  isInLastWeekOfMonth,
  monthRange,
  shiftMonth,
} from "@/lib/month-date";
import type {
  AppSettings,
  CashCount,
  MonthAuditOverride,
  MonthAuditPolicy,
  MonthlyAudit,
  StockCount,
  Voucher,
} from "@/lib/types";

export type MonthCloseDb = {
  settings?: AppSettings | null;
  monthlyAudits?: MonthlyAudit[];
  stockCounts?: StockCount[];
  cashCounts?: CashCount[];
  vouchers?: Voucher[];
};

export type MonthCloseObligationState = "ok" | "due" | "overdue" | "blocking";

export type MonthCloseObligation = {
  month: string;
  inLastWeek: boolean;
  state: MonthCloseObligationState;
  blockers: string[];
  override?: MonthAuditOverride;
  policy: MonthAuditPolicy;
  graceDays: number;
};

export function monthAuditPolicyOf(
  settings: Pick<AppSettings, "monthAuditPolicy"> | null | undefined
): MonthAuditPolicy {
  const raw = settings?.monthAuditPolicy;
  if (raw === "hard" || raw === "reminder" || raw === "escalating") return raw;
  return "escalating";
}

export function monthAuditGraceDaysOf(
  settings: Pick<AppSettings, "monthAuditGraceDays"> | null | undefined
): number {
  const n = Number(settings?.monthAuditGraceDays);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(31, Math.floor(n));
}

export function overrideForMonth(
  settings: Pick<AppSettings, "monthAuditOverrides"> | null | undefined,
  month: string
): MonthAuditOverride | undefined {
  return (settings?.monthAuditOverrides ?? []).find((o) => o.month === month);
}

function latestCount<T extends { month: string; updatedAt?: string; submittedAt?: string }>(
  rows: T[] | undefined,
  month: string
): T | undefined {
  return (rows ?? [])
    .filter((r) => r.month === month)
    .sort((a, b) =>
      (b.submittedAt || b.updatedAt || "").localeCompare(
        a.submittedAt || a.updatedAt || ""
      )
    )[0];
}

function monthHasBooks(
  db: Pick<MonthCloseDb, "vouchers" | "stockCounts" | "cashCounts">,
  month: string
): boolean {
  const { from, to } = monthRange(month);
  if (
    (db.vouchers ?? []).some((v) => {
      if (v.voided) return false;
      const day = v.date.slice(0, 10);
      return day >= from && day <= to;
    })
  ) {
    return true;
  }
  if ((db.stockCounts ?? []).some((c) => c.month === month)) return true;
  if ((db.cashCounts ?? []).some((c) => c.month === month)) return true;
  return false;
}

export function monthCloseObligation(
  db: MonthCloseDb,
  now: Date = new Date()
): MonthCloseObligation {
  const today = dateInIst(now);
  const currentMonth = today.slice(0, 7);
  const priorMonth = shiftMonth(currentMonth, -1);
  const inLastWeek = isInLastWeekOfMonth(today, currentMonth);
  const policy = monthAuditPolicyOf(db.settings);
  const graceDays = monthAuditGraceDaysOf(db.settings);
  const audits = db.monthlyAudits;

  const blockersFor = (month: string): string[] => {
    const stock = latestCount(db.stockCounts, month);
    const cash = latestCount(db.cashCounts, month);
    return monthCloseReady({ stock, cash }).reasons;
  };

  const stamped = (month: string) => Boolean(monthCloseStamp(audits, month));

  const finish = (
    month: string,
    state: MonthCloseObligationState
  ): MonthCloseObligation => ({
    month,
    inLastWeek,
    state,
    blockers: state === "ok" ? [] : blockersFor(month).map(String),
    override: overrideForMonth(db.settings, month),
    policy,
    graceDays,
  });

  if (!stamped(priorMonth) && monthHasBooks(db, priorMonth)) {
    const override = overrideForMonth(db.settings, priorMonth);
    const priorEnd = monthRange(priorMonth).to;
    const graceEnd = addDaysIso(priorEnd, graceDays);
    let state: MonthCloseObligationState = "overdue";
    if (override) {
      state = "overdue";
    } else if (policy === "reminder") {
      state = "overdue";
    } else if (policy === "hard") {
      state = "blocking";
    } else if (today > graceEnd) {
      state = "blocking";
    } else {
      state = "overdue";
    }
    return { ...finish(priorMonth, state), override };
  }

  if (!stamped(currentMonth) && inLastWeek) {
    return finish(currentMonth, "due");
  }

  return finish(currentMonth, "ok");
}

/**
 * After month-end, refuse postings dated in a later month until the prior
 * month is stamped or the owner records an override. In-month dates never throw.
 */
export function assertPriorMonthAudited(
  date: string,
  db: MonthCloseDb,
  now: Date = new Date()
): void {
  const obligation = monthCloseObligation(db, now);
  if (obligation.state !== "blocking") return;
  const voucherMonth = date.slice(0, 7);
  if (voucherMonth <= obligation.month) return;
  const blockers = obligation.blockers.length
    ? ` (${obligation.blockers.join(", ")})`
    : "";
  throw new Error(
    `Month ${obligation.month} is not audited${blockers}. Stamp the monthly audit or record an owner override before posting ${voucherMonth} vouchers.`
  );
}

export function upsertMonthAuditOverride(
  settings: AppSettings,
  override: MonthAuditOverride
): AppSettings {
  const rest = (settings.monthAuditOverrides ?? []).filter(
    (o) => o.month !== override.month
  );
  return {
    ...settings,
    monthAuditOverrides: [override, ...rest],
  };
}
