'use client';

import { riderDateOfTimestamp } from '@/lib/local-date';
import { formatDay } from '@/lib/service-book/calendar';
import { useRiderClock } from './rider-clock';

interface HandoverExpiryProps {
  lead: string;
  expiresAt: string;
}

/**
 * The day a handover link stops working, in the buyer's own calendar. The link
 * expires at an instant, and only the browser knows which day that falls on for
 * the rider reading it, so nothing is printed until the zone is known.
 */
export function HandoverExpiry({ lead, expiresAt }: HandoverExpiryProps) {
  const clock = useRiderClock();
  if (!clock) return null;
  return (
    <>
      {lead} {formatDay(riderDateOfTimestamp(expiresAt, clock.timeZone))}.
    </>
  );
}
