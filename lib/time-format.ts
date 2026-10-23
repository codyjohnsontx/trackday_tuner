export const TIME_FORMAT_STORAGE_KEY = 'tracktuner_time_format';

export type TimeFormat = '12h' | '24h';

export const TIME_FORMAT_CHANGE_EVENT = 'tracktuner:time-format';

export function parseTimeFormat(value: string | null): TimeFormat {
  return value === '24h' ? '24h' : '12h';
}

/**
 * What the rider chose when storage would not keep it - Safari private mode, a
 * full quota, storage disabled - and what the key still held when it refused.
 * Every screen reads the format through `readTimeFormat`, so without this a
 * refused write would leave the toggle and every clock on the old format. Same
 * rule as `unitFallback` in `lib/temperature.ts`.
 */
let formatFallback: TimeFormat | null = null;
let formatFallbackShadowed: string | null = null;

function readStoredFormat(): string | null {
  try {
    return localStorage.getItem(TIME_FORMAT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function readTimeFormat(): TimeFormat {
  if (typeof window === 'undefined') return '12h';
  const stored = readStoredFormat();

  if (formatFallback !== null) {
    // Anything else in the key is a later choice - another tab writing it.
    if (stored === formatFallbackShadowed) return formatFallback;
    formatFallback = null;
    formatFallbackShadowed = null;
  }

  return parseTimeFormat(stored);
}

export function writeTimeFormat(format: TimeFormat): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TIME_FORMAT_STORAGE_KEY, format);
    formatFallback = null;
    formatFallbackShadowed = null;
  } catch {
    formatFallback = format;
    formatFallbackShadowed = readStoredFormat();
  }
  window.dispatchEvent(new CustomEvent<TimeFormat>(TIME_FORMAT_CHANGE_EVENT, { detail: format }));
}

function parseTimeParts(time: string): [number, number] | null {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(time);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return [hours, minutes];
}

function to12h(t: string): string {
  const parts = parseTimeParts(t);
  if (!parts) return t;
  const [h, m] = parts;
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function to24h(t: string): string {
  const parts = parseTimeParts(t);
  if (!parts) return t;
  const [h, m] = parts;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatSessionClockTime(time: string, format: TimeFormat): string {
  return format === '12h' ? to12h(time) : to24h(time);
}
