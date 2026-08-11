export type DatePreset = "today" | "7d" | "mtd" | "custom";

export type DateRange = {
  preset: DatePreset;
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
};

const STORAGE_KEY = "tt_admin_date_range";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Local calendar date as YYYY-MM-DD */
export function toDateInputValue(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function startOfDayMs(ymd: string): number {
  const [y, m, day] = ymd.split("-").map(Number);
  return new Date(y, m - 1, day, 0, 0, 0, 0).getTime();
}

function endOfDayMs(ymd: string): number {
  const [y, m, day] = ymd.split("-").map(Number);
  return new Date(y, m - 1, day, 23, 59, 59, 999).getTime();
}

export function rangeForPreset(preset: Exclude<DatePreset, "custom">): DateRange {
  const today = toDateInputValue();
  if (preset === "today") {
    return { preset, from: today, to: today };
  }
  if (preset === "7d") {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return { preset, from: toDateInputValue(d), to: today };
  }
  // mtd
  const now = new Date();
  const from = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-01`;
  return { preset: "mtd", from, to: today };
}

export function defaultRange(preset: Exclude<DatePreset, "custom"> = "today"): DateRange {
  return rangeForPreset(preset);
}

export function inRange(
  iso: string | undefined | null,
  from: string,
  to: string
): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= startOfDayMs(from) && t <= endOfDayMs(to);
}

export function daysBetween(iso: string, now = Date.now()): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, (now - t) / (24 * 60 * 60 * 1000));
}

export function loadStoredRange(): DateRange | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DateRange;
    if (
      !parsed?.from ||
      !parsed?.to ||
      !["today", "7d", "mtd", "custom"].includes(parsed.preset)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveStoredRange(range: DateRange): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(range));
  } catch {
    /* ignore quota */
  }
}

export function eachDayInclusive(from: string, to: string): string[] {
  const out: string[] = [];
  let cur = startOfDayMs(from);
  const end = startOfDayMs(to);
  if (cur > end) return out;
  while (cur <= end) {
    out.push(toDateInputValue(new Date(cur)));
    cur += 24 * 60 * 60 * 1000;
  }
  return out;
}
