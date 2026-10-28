/** Calendar dates are `YYYY-MM-DD` strings from <input type="date">. Only the browser knows the time zone. */
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MAX_RANGE_DAYS = 366;

function parse(date: string): { y: number; m: number; d: number } | null {
  const match = DATE.exec(date);
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  const check = new Date(y, m - 1, d);
  // Reject dates the Date constructor would silently roll over (e.g. 2026-02-30).
  if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== d) return null;
  return { y, m, d };
}

/** Local midnight at the start of the date, as a UTC ISO instant. */
export function startOfLocalDay(date: string): string | null {
  const p = parse(date);
  return p && new Date(p.y, p.m - 1, p.d).toISOString();
}

/** Local midnight of the day AFTER `date`: the exclusive upper bound that makes the end date inclusive. */
export function startOfNextLocalDay(date: string): string | null {
  const p = parse(date);
  return p && new Date(p.y, p.m - 1, p.d + 1).toISOString();
}

export type DateRange = { from: string; to: string };

/** Inclusive calendar range [startDate, endDate] -> half-open instants [from, to). */
export function dateRangeToInstants(startDate: string, endDate: string): DateRange | null {
  const from = startOfLocalDay(startDate);
  const to = startOfNextLocalDay(endDate);
  return from && to ? { from, to } : null;
}

export function daysBetweenInclusive(startDate: string, endDate: string): number {
  const a = parse(startDate);
  const b = parse(endDate);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000) + 1;
}

/** Today's local calendar date as YYYY-MM-DD. */
export function todayLocal(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
