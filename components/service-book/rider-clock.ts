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
 * On the owner's own screens the owner's zone is the viewer's, which is what
 * `describeEntryProvenance` is handed. A screen another person reads - the
 * share link, a PDF - cannot use this and reads `service_books.owner_time_zone`,
 * which the book screen records from this zone the first time and never after.
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
