'use client';

import { useSyncExternalStore } from 'react';
import { preferenceSubscription } from '@/components/ui/device-value';
import {
  TIME_FORMAT_CHANGE_EVENT,
  TIME_FORMAT_STORAGE_KEY,
  formatSessionClockTime,
  readTimeFormat,
  type TimeFormat,
} from '@/lib/time-format';

const subscribeToTimeFormat = preferenceSubscription(TIME_FORMAT_STORAGE_KEY, TIME_FORMAT_CHANGE_EVENT);

/**
 * The rider's 12h/24h choice, kept in step with the Settings toggle and with
 * other tabs. 12-hour on the server and on the hydrating render so the two
 * agree; the stored preference arrives on the render after.
 */
export function useTimeFormat(): TimeFormat {
  return useSyncExternalStore(subscribeToTimeFormat, readTimeFormat, () => '12h');
}

export function TimeDisplay({ time }: { time: string | null }) {
  const format = useTimeFormat();

  if (!time) {
    return <span className="text-sm font-medium text-ink">—</span>;
  }

  return (
    <span className="text-sm font-medium text-ink">{formatSessionClockTime(time, format)}</span>
  );
}
