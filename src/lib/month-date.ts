/** Calendar-month helpers. Dates are YYYY-MM or YYYY-MM-DD; IST is UTC+05:30. */

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return {
    from: `${month}-01`,
    to: `${month}-${pad2(last)}`,
  };
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function lastDayOfMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return new Date(y, m, 0).getDate();
}

/** Calendar date in IST (YYYY-MM-DD). */
export function dateInIst(now: Date | string = new Date()): string {
  const d = typeof now === "string" ? new Date(now) : now;
  if (Number.isNaN(d.getTime())) return String(now).slice(0, 10);
  return new Date(d.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export function monthInIst(now: Date | string = new Date()): string {
  return dateInIst(now).slice(0, 7);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Inclusive last 7 calendar days of `month` (IST). */
export function lastWeekStart(month: string): string {
  const last = lastDayOfMonth(month);
  return `${month}-${pad2(Math.max(1, last - 6))}`;
}

export function isInLastWeekOfMonth(ymd: string, month = ymd.slice(0, 7)): boolean {
  const day = ymd.slice(0, 10);
  return day >= lastWeekStart(month) && day <= monthRange(month).to;
}
