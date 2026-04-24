export const TIME_FORMAT_STORAGE_KEY = 'tracktuner_time_format';

export type TimeFormat = '12h' | '24h';

export const TIME_FORMAT_CHANGE_EVENT = 'tracktuner:time-format';

export function parseTimeFormat(value: string | null): TimeFormat {
  return value === '24h' ? '24h' : '12h';
}

export function readTimeFormat(): TimeFormat {
  if (typeof window === 'undefined') return '12h';
  try {
    return parseTimeFormat(localStorage.getItem(TIME_FORMAT_STORAGE_KEY));
  } catch {
    return '12h';
  }
}

export function writeTimeFormat(format: TimeFormat): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TIME_FORMAT_STORAGE_KEY, format);
  } catch {
    // Ignore storage failures so the in-memory UI state can still update.
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
