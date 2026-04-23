export const TIME_FORMAT_STORAGE_KEY = 'tracktuner_time_format';

export type TimeFormat = '12h' | '24h';

export const TIME_FORMAT_CHANGE_EVENT = 'tracktuner:time-format';

export function parseTimeFormat(value: string | null): TimeFormat {
  return value === '24h' ? '24h' : '12h';
}

export function readTimeFormat(): TimeFormat {
  if (typeof window === 'undefined') return '12h';
  return parseTimeFormat(localStorage.getItem(TIME_FORMAT_STORAGE_KEY));
}

export function writeTimeFormat(format: TimeFormat): void {
  localStorage.setItem(TIME_FORMAT_STORAGE_KEY, format);
  window.dispatchEvent(new CustomEvent<TimeFormat>(TIME_FORMAT_CHANGE_EVENT, { detail: format }));
}

function to12h(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function to24h(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function formatSessionClockTime(time: string, format: TimeFormat): string {
  return format === '12h' ? to12h(time) : to24h(time);
}
