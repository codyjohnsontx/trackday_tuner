'use client';

import { useRiderClock } from '@/components/service-book/rider-clock';
import { formatDay } from '@/lib/service-book/calendar';
import { describeSoldBook } from '@/lib/service-book/handover';
import { riderDateOfTimestamp } from '@/lib/local-date';

interface SoldBannerProps {
  soldAt: string;
}

/**
 * The seller's book once the buyer has accepted (owner, TQ3): their read-only
 * copy, dated in their own calendar. The date needs the rider's zone, which
 * only their browser knows, so it is filled in after mount.
 */
export function SoldBanner({ soldAt }: SoldBannerProps) {
  const clock = useRiderClock();
  const soldOn = clock ? formatDay(riderDateOfTimestamp(soldAt, clock.timeZone)) : null;
  return (
    <section className="rounded-card bg-surface p-5" data-testid="sold-banner" role="status">
      <p className="text-sm font-semibold text-ink">Sold</p>
      <p className="mt-1 text-sm text-ink-dim">{describeSoldBook(soldOn)}</p>
    </section>
  );
}
