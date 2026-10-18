'use client';

import { useRiderClock } from '@/components/service-book/rider-clock';
import { formatDay } from '@/lib/service-book/calendar';
import { riderDateOfTimestamp } from '@/lib/local-date';

/**
 * The Sold chip and "Sold 3 Oct 2026 - history kept" on a handed-over bike's
 * card (owner, TQ3). The day is the rider's own calendar day of the sale,
 * which needs their zone, so it is filled in after mount; until then the line
 * reads "Sold - history kept".
 */
export function SoldLine({ soldAt }: { soldAt: string }) {
  const clock = useRiderClock();
  const soldOn = clock ? formatDay(riderDateOfTimestamp(soldAt, clock.timeZone)) : null;
  return (
    <p className="flex items-center gap-2 text-sm text-ink-dim" data-testid="sold-line">
      <span className="rounded-full bg-surface-3 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-ink-dim" data-testid="sold-chip">
        Sold
      </span>
      <span>{soldOn ? `${soldOn} - history kept` : 'History kept'}</span>
    </p>
  );
}
