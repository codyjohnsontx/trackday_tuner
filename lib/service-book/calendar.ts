/**
 * Calendar-date arithmetic for the service book's rules, on `YYYY-MM-DD`
 * strings. A date column (`service_date`, `reading_date`, `sessions.date`) is a
 * day with no zone, so it is counted as a day number and never passed through a
 * `Date` in the runtime's local zone, which would move it across midnight.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

/** Days since 1970-01-01 for a valid `YYYY-MM-DD`, or `null` for anything else. */
export function dayNumber(date: unknown): number | null {
  if (typeof date !== 'string') return null;
  const match = ISO_DATE.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const ms = Date.UTC(year, month - 1, day);
  const back = new Date(ms);
  // 2026-02-30 rolls over to March in Date.UTC; a date that does not exist is not one.
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return null;
  return ms / DAY_MS;
}

export function isIsoDate(date: unknown): date is string {
  return dayNumber(date) !== null;
}

/** `to - from` in whole days; both must be valid dates. */
export function daysBetween(from: string, to: string): number {
  return (dayNumber(to) as number) - (dayNumber(from) as number);
}

export function addDays(date: string, days: number): string {
  return new Date(((dayNumber(date) as number) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** Whole calendar months from `from` to `to`, counting a month only once its day is reached. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  let months = (ty - fy) * 12 + (tm - fm);
  if (td < fd) months -= 1;
  return months;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `2026-09-20` as `20 Sep 2026`, the same in every runtime and locale. */
export function formatDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/** Milliseconds since the epoch for a stored `timestamptz`, or `null` when it does not parse. */
export function instantOf(timestamp: unknown): number | null {
  if (typeof timestamp !== 'string') return null;
  const ms = Date.parse(timestamp);
  return Number.isNaN(ms) ? null : ms;
}
