'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Wrench } from 'lucide-react';
import { useRiderClock } from '@/components/service-book/rider-clock';
import { CardGroup } from '@/components/ui/surface';
import { computeBookDue, describeDueSummary, summarizeDue, type DueSummary, type ServiceDueData } from '@/lib/service-book/reminders';
import { cn } from '@/lib/utils';

/**
 * The in-app reminders (owner, Q8): a chip on each garage bike and one line per
 * bike on the dashboard, derived on the rider's device from the same rows the
 * book screen reads, because today's date and the zone are known only there
 * (`useRiderClock`). Nothing renders until the clock is read, and nothing
 * renders when nothing is due, so a bike that is fine carries no badge.
 *
 * Tone follows the book's own chip: `signal` for due soon, because a reminder
 * is a caution (the design rule: the accent marks interaction or caution, never
 * data), and `slower` for overdue.
 */

function useDueSummary(data: ServiceDueData | null): DueSummary | null {
  const clock = useRiderClock();
  return useMemo(() => (clock && data ? summarizeDue(computeBookDue(data, clock)) : null), [clock, data]);
}

function toneClass(status: DueSummary['status']): string {
  return status === 'overdue' ? 'bg-slower/12 text-slower' : 'bg-signal/12 text-signal';
}

interface ServiceDueChipProps {
  data: ServiceDueData | null;
  className?: string;
}

/** `Engine oil and filter overdue` on a garage card; nothing when nothing is due. */
export function ServiceDueChip({ data, className }: ServiceDueChipProps) {
  const summary = useDueSummary(data);
  const text = summary ? describeDueSummary(summary) : null;
  if (!summary || !text) return null;
  return (
    <span
      className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', toneClass(summary.status), className)}
      data-testid="vehicle-due-chip"
      data-status={summary.status}
    >
      {text}
    </span>
  );
}

interface ServiceDueNoticesProps {
  vehicles: readonly { id: string; nickname: string }[];
  books: Record<string, ServiceDueData>;
}

/** One row per bike with anything due, under the dashboard's recent sessions. */
export function ServiceDueNotices({ vehicles, books }: ServiceDueNoticesProps) {
  const clock = useRiderClock();
  const rows = useMemo(() => {
    if (!clock) return [];
    return vehicles.flatMap((vehicle) => {
      const data = books[vehicle.id];
      if (!data) return [];
      const summary = summarizeDue(computeBookDue(data, clock));
      const text = describeDueSummary(summary);
      return text ? [{ vehicle, summary, text }] : [];
    });
  }, [clock, vehicles, books]);

  if (rows.length === 0) return null;
  return (
    <CardGroup icon={Wrench} eyebrow="Service" title="Due on your bikes">
      <ul className="space-y-2" data-testid="service-due-notices">
        {rows.map(({ vehicle, summary, text }) => (
          <li key={vehicle.id}>
            <Link
              href={`/garage/${vehicle.id}/book`}
              className="flex min-h-11 items-center justify-between gap-3 rounded-row bg-surface-2 px-4 py-3 transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
              data-testid="service-due-notice"
              data-status={summary.status}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-ink">{vehicle.nickname}</span>
                <span className={cn('block text-sm', summary.status === 'overdue' ? 'text-slower' : 'text-signal')}>{text}</span>
              </span>
              <span aria-hidden="true" className="shrink-0 text-ink-faint">
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </CardGroup>
  );
}
