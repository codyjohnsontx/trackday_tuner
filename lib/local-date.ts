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
