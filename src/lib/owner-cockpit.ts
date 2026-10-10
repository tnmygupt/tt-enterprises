import { computeCommandDesk, type CommandDesk } from "@/lib/admin-command-desk";
import { getAdminQueues } from "@/lib/admin-queues";
import type { DateRange } from "@/lib/date-range";
import { monthRange } from "@/lib/month-date";
import {
  buildMonthlyAuditReport,
  type MonthlyAuditReport,
} from "@/lib/owner-monthly-audit";
import { computeOwnerMetrics, type OwnerMetrics } from "@/lib/owner-metrics";
import type { AppDatabase } from "@/lib/store/db";

export type OwnerCockpit = {
  month: string;
  asOf: string;
  from: string;
  to: string;
  desk: CommandDesk;
  metrics: OwnerMetrics;
  queues: ReturnType<typeof getAdminQueues>;
  audit: MonthlyAuditReport;
};

/**
 * One typed owner snapshot. The cockpit page must not do its own arithmetic —
 * it reads this object and the month pack from `buildOwnerMonthReport`.
 */
export function buildOwnerCockpit(
  db: AppDatabase,
  opts: { month: string; asOf?: string; range?: Pick<DateRange, "from" | "to"> }
): OwnerCockpit {
  const bounds = monthRange(opts.month);
  const from = (opts.range?.from || bounds.from).slice(0, 10);
  const to = (opts.range?.to || bounds.to).slice(0, 10);
  const asOf = (opts.asOf || to).slice(0, 10);
  return {
    month: opts.month,
    asOf,
    from,
    to,
    desk: computeCommandDesk(db, asOf),
    metrics: computeOwnerMetrics(db, { preset: "custom", from, to }),
    queues: getAdminQueues(db),
    audit: buildMonthlyAuditReport(db, opts.month),
  };
}
