import type { DistanceUnit } from '@/types/supabase';
import { formatDay, isIsoDate } from '@/lib/service-book/calendar';

/**
 * How the service book prints a figure. One place, so the book page, an entry,
 * the usage panel and a later PDF print the same hours, miles and money.
 *
 * Pure: no Supabase, no Next, so the phone app can import it.
 */

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** `12.3 h`; one decimal, no trailing zero on a whole number. */
export function formatHours(hours: unknown): string | null {
  const value = finite(hours);
  if (value === null) return null;
  const rounded = Math.round(value * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} h`;
}

/** `1,240 mi` / `1,240 km`; whole numbers, since an odometer reads in them. */
export function formatDistance(distance: unknown, unit: DistanceUnit): string | null {
  const value = finite(distance);
  if (value === null) return null;
  return `${Math.round(value).toLocaleString('en-US')} ${unit}`;
}

/** `$12.34` from whole cents. The book stores a currency code; only USD is printed as a symbol today. */
export function formatMoney(cents: unknown, currency = 'USD'): string | null {
  const value = finite(cents);
  if (value === null || !Number.isInteger(value) || value < 0) return null;
  const amount = (value / 100).toFixed(2);
  return currency === 'USD' ? `$${amount}` : `${amount} ${currency}`;
}

/** A stored `YYYY-MM-DD` as `20 Sep 2026`, or the text as it came when it is not a date. */
export function formatServiceDate(date: unknown): string {
  return isIsoDate(date) ? formatDay(date) : typeof date === 'string' ? date : '';
}

/** `12.3 h`, `1,240 mi`, or both joined with a dot; `null` when the reading carries neither. */
export function formatReading(
  reading: { hours: unknown; distance: unknown },
  unit: DistanceUnit,
): string | null {
  const parts = [formatHours(reading.hours), formatDistance(reading.distance, unit)].filter(
    (part): part is string => part !== null,
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** An interval such as `every 15 h`, `every 1,000 mi`, `every 90 days`, joined by ` or `. */
export function formatInterval(
  item: { interval_hours: unknown; interval_distance: unknown; interval_days: unknown },
  unit: DistanceUnit,
): string | null {
  const parts: string[] = [];
  const hours = formatHours(item.interval_hours);
  if (hours) parts.push(hours);
  const distance = formatDistance(item.interval_distance, unit);
  if (distance) parts.push(distance);
  const days = finite(item.interval_days);
  if (days !== null && days > 0) parts.push(`${Math.round(days)} ${days === 1 ? 'day' : 'days'}`);
  return parts.length > 0 ? `every ${parts.join(' or ')}` : null;
}

/** Text a rider typed for a number: blank is nothing, anything else must be a finite number. */
export function parseNumberText(text: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, value: null };
  const value = Number(trimmed);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

/** Dollars typed as text (`12`, `12.5`, `$12.34`) as whole cents; blank is nothing. */
export function parseMoneyText(text: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = text.trim().replace(/^\$/, '').replace(/,/g, '');
  if (trimmed === '') return { ok: true, value: null };
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return { ok: false };
  return { ok: true, value: Math.round(Number(trimmed) * 100) };
}

/** Whole cents as the text a money field shows: `1234` -> `12.34`, nothing -> ``. */
export function moneyText(cents: unknown): string {
  const value = finite(cents);
  return value === null ? '' : (value / 100).toFixed(2);
}

/** A number as the text a field shows; nothing -> ``. */
export function numberText(value: unknown): string {
  const number = finite(value);
  return number === null ? '' : String(number);
}
