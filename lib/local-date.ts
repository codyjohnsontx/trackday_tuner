/**
 * The rider's own calendar date.
 *
 * `new Date().toISOString()` is UTC, so seeding the session form's Date field
 * from it hands anyone west of Greenwich tomorrow's date all evening: at 19:00
 * in Texas it is already the next day in London. A track day logged half under
 * one date and half under the next splits the day group, the compare picker and
 * every track history that keys on the date.
 *
 * The instant has to be read where the rider is, so callers evaluate this on the
 * client rather than during SSR - a server rendering in UTC would seed the wrong
 * day just as reliably as `toISOString` did.
 */
export function todayLocalDate(now: Date = new Date()): string {
  const year = String(now.getFullYear()).padStart(4, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The calendar date of `instant` in the IANA `timeZone`, or `null` when the
 * zone is one this runtime does not recognise.
 *
 * `en-CA` is used for its field order only; the parts are reassembled here so
 * the result is `YYYY-MM-DD` whatever the locale data says.
 */
export function dateInTimeZone(instant: Date, timeZone: string): string | null {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(instant);
  } catch {
    return null;
  }
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  return year && month && day ? `${year}-${month}-${day}` : null;
}

/**
 * The rider's calendar date for a stored `timestamptz`, for text that names the
 * day a rider did something on the server.
 *
 * The server cannot know the rider's day, so it has to be told their zone - the
 * AI routes carry the browser's `Intl.DateTimeFormat().resolvedOptions().timeZone`
 * as `time_zone`. Without one, or with one this runtime rejects, it falls back
 * to the UTC date, which is what slicing the ISO string always gave: up to a day
 * off, but never worse than before a zone was carried.
 */
export function riderDateOfTimestamp(timestamp: string, timeZone?: string): string {
  if (timeZone) {
    const instant = new Date(timestamp);
    if (!Number.isNaN(instant.getTime())) {
      const local = dateInTimeZone(instant, timeZone);
      if (local) return local;
    }
  }
  return timestamp.slice(0, 10);
}
