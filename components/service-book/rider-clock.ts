'use client';

import { useEffect, useState } from 'react';
import { todayLocalDate } from '@/lib/local-date';

export interface RiderClock {
  /** The rider's own calendar day, `YYYY-MM-DD`. */
  today: string;
  /** The IANA zone of the browser looking at the book. */
  timeZone: string;
}

/**
 * The two inputs the service-book rules need that only the rider's device
 * knows: today's date in their calendar (`todayLocalDate`, never the server's
 * UTC day) and their time zone. Both are read after mount, so a server render
 * cannot seed them with where the server is; until then the hook answers
 * `null` and a screen shows nothing derived from them.
 *
 * An entry's honest-history labels are read in `service_books.owner_time_zone`
 * on every screen - the owner's, the share link, a PDF - so they never move with
 * the viewer. The book screen records it from this zone the first time and never
 * after, and the owner's screens fall back to this zone only until it is
 * recorded (`ownerLabelTimeZone`).
 */
export function useRiderClock(): RiderClock | null {
  const [clock, setClock] = useState<RiderClock | null>(null);
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    setClock({ today: todayLocalDate(), timeZone });
  }, []);
  return clock;
}

/** A stored instant as the rider reads it, in their own zone and locale. */
export function formatInstant(timestamp: string): string {
  const instant = new Date(timestamp);
  if (Number.isNaN(instant.getTime())) return timestamp;
  return instant.toLocaleString('en-US', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
