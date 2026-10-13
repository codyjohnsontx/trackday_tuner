'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardGroup, Eyebrow, GroupRow } from '@/components/ui/surface';
import { VehicleReadingForm } from '@/components/service-book/vehicle-reading-form';
import { useRiderClock } from '@/components/service-book/rider-clock';
import { buildServiceBookView, liveItems, type ServiceBookData, type ServiceBookView } from '@/lib/service-book/book-data';
import { describeEntryItems } from '@/lib/service-book/entry-draft';
import type { AxisDue, ItemDue, ItemDueStatus } from '@/lib/service-book/due';
import { formatDistance, formatHours, formatInterval, formatReading, formatServiceDate } from '@/lib/service-book/format';
import type { AxisUsage } from '@/lib/service-book/usage';
import { formatDay } from '@/lib/service-book/calendar';
import { cn } from '@/lib/utils';

interface ServiceBookScreenProps {
  data: ServiceBookData;
  demoMode: boolean;
  /** Whether removed entries are in `data.entries`; the toggle flips it through the URL. */
  showingRemoved: boolean;
}

/**
 * A bike's service book: usage now, the schedule with each item's due state,
 * the entries with their honest-history labels, and the readings behind the
 * usage figure. The rules run here rather than on the server because the
 * rider's day and zone are known only on their device (`useRiderClock`).
 *
 * In demo it is a tour: no reading form, no "Log service", no settings link,
 * so a visitor is never offered a save that would only refuse.
 */
export function ServiceBookScreen({ data, demoMode, showingRemoved }: ServiceBookScreenProps) {
  const clock = useRiderClock();
  const view = useMemo(() => (clock ? buildServiceBookView(data, clock) : null), [data, clock]);
  const vehicleId = data.vehicle.id;
  const items = liveItems(data.items);
  const unit = data.book.distance_unit;

  return (
    <div className="space-y-5">
      <UsagePanel data={data} view={view} demoMode={demoMode} />

      <CardGroup
        eyebrow="Schedule"
        title={`${items.length} ${items.length === 1 ? 'item' : 'items'}`}
        action={
          demoMode ? null : (
            <Link href={`/garage/${vehicleId}/book/settings`} className="flex min-h-11 items-center text-sm font-medium text-ink-dim hover:text-ink">
              Edit schedule →
            </Link>
          )
        }
      >
        {items.length === 0 ? (
          <GroupRow>
            <p className="text-sm text-ink-dim">No items yet. Add what this bike needs from the schedule settings.</p>
          </GroupRow>
        ) : (
          items.map((item) => (
            <GroupRow key={item.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-medium text-ink">{item.name}</p>
                <p className="mt-0.5 text-xs text-ink-faint">{formatInterval(item, unit) ?? 'No interval set'}</p>
                <ItemDueLine due={view?.dueByItemId.get(item.id) ?? null} unit={unit} />
              </div>
              <DueChip due={view?.dueByItemId.get(item.id) ?? null} />
            </GroupRow>
          ))
        )}
      </CardGroup>

      <CardGroup
        eyebrow="Entries"
        title={`${data.entries.length} ${data.entries.length === 1 ? 'entry' : 'entries'}`}
        action={
          demoMode ? null : (
            <Button asChild size="sm">
              <Link href={`/garage/${vehicleId}/book/entries/new`}>+ Log service</Link>
            </Button>
          )
        }
      >
        {data.entries.length === 0 ? (
          <GroupRow>
            <p className="text-sm text-ink-dim">Nothing logged yet.</p>
            <p className="mt-1 text-xs text-ink-faint">
              Every entry records the day you log it apart from the date the work was done, so the book stays honest about what was back-filled.
            </p>
          </GroupRow>
        ) : (
          data.entries.map((entry) => {
            const provenance = view?.provenanceByEntryId.get(entry.id) ?? null;
            const reading = formatReading({ hours: entry.reading_hours, distance: entry.reading_distance }, unit);
            return (
              <Link
                key={entry.id}
                href={`/garage/${vehicleId}/book/entries/${entry.id}`}
                className="block min-h-11 rounded-row bg-surface-2 p-4 transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
                data-testid="service-entry-row"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{describeEntryItems(entry.items) || 'Service'}</p>
                    <p className="mt-0.5 text-sm text-ink-dim">
                      {formatServiceDate(entry.service_date)}
                      {reading ? ` · ${reading}` : ''}
                      {entry.performed_by === 'shop' && entry.shop_name ? ` · ${entry.shop_name}` : ''}
                    </p>
                  </div>
                  {entry.deleted_at ? (
                    <span className="shrink-0 rounded-full bg-surface-3 px-2 py-0.5 text-xs font-semibold text-ink-faint">Removed</span>
                  ) : null}
                </div>
                {provenance ? (
                  <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="History">
                    {provenance.labels.map((label) => (
                      <li key={label.kind} className="rounded-full bg-surface-3 px-2 py-0.5 text-xs text-ink-dim">
                        {label.text}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </Link>
            );
          })
        )}
        <div className="px-3 pb-1 pt-2">
          <Link
            href={showingRemoved ? `/garage/${vehicleId}/book` : `/garage/${vehicleId}/book?removed=1`}
            className="inline-flex min-h-11 items-center text-xs font-medium text-ink-faint hover:text-ink"
          >
            {showingRemoved ? 'Hide removed entries' : 'Show removed entries'}
          </Link>
        </div>
      </CardGroup>

      <ReadingsPanel data={data} />
    </div>
  );
}

function UsagePanel({ data, view, demoMode }: { data: ServiceBookData; view: ServiceBookView | null; demoMode: boolean }) {
  const axes = [view?.usage.hours ?? null, view?.usage.distance ?? null].filter((axis): axis is AxisUsage => axis !== null);
  const unit = data.book.distance_unit;

  return (
    <Card>
      <Eyebrow>Usage</Eyebrow>
      {view === null ? (
        <p className="mt-2 text-sm text-ink-faint">Working out usage…</p>
      ) : axes.length === 0 || axes.every((axis) => axis.basis === 'none') ? (
        <div className="mt-2">
          <p className="text-lg font-semibold text-ink">No reading yet</p>
          <p className="mt-1 text-sm text-ink-dim">
            Estimates only. Log a reading off the hour meter or odometer, and the book counts sessions from there.
          </p>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          {axes.map((axis) => (
            <AxisUsageLine key={axis.axis} axis={axis} unit={unit} />
          ))}
        </div>
      )}
      {demoMode ? null : (
        <div className="mt-4">
          <VehicleReadingForm vehicleId={data.vehicle.id} book={data.book} />
        </div>
      )}
    </Card>
  );
}

function AxisUsageLine({ axis, unit }: { axis: AxisUsage; unit: 'mi' | 'km' }) {
  const format = (value: number | null) => (axis.axis === 'hours' ? formatHours(value) : formatDistance(value, unit));
  if (axis.basis === 'none') {
    return <p className="text-sm text-ink-dim">{axis.axis === 'hours' ? 'Hours' : 'Distance'}: nothing to count yet.</p>;
  }
  const counted = axis.sessions.filter((session) => session.weight > 0).length;
  const estimated = axis.basis !== 'reading';
  return (
    <div>
      <p className="text-2xl font-semibold tabular-nums text-ink">
        {estimated ? '≈ ' : ''}
        {format(axis.current)}
      </p>
      <p className="mt-0.5 text-sm text-ink-dim">
        {axis.reading
          ? `Last reading ${format(axis.reading.value)} on ${formatDay(axis.reading.date)}`
          : 'No reading on this axis'}
        {counted > 0 ? ` + ${counted} ${counted === 1 ? 'session' : 'sessions'} (estimate)` : ''}
        {axis.axis === 'distance' && axis.sessionsWithoutDistance > 0
          ? ` · ${axis.sessionsWithoutDistance} ${axis.sessionsWithoutDistance === 1 ? 'session' : 'sessions'} with no distance to count`
          : ''}
      </p>
    </div>
  );
}

const STATUS_LABEL: Record<ItemDueStatus, string> = {
  overdue: 'Overdue',
  due_soon: 'Due soon',
  ok: 'OK',
  snoozed: 'Snoozed',
  no_interval: 'No interval',
  unknown: 'Usage unknown',
};

function DueChip({ due }: { due: ItemDue | null }) {
  if (!due) return null;
  return (
    <span
      className={cn(
        'shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold',
        due.status === 'overdue' && 'bg-slower/12 text-slower',
        due.status === 'due_soon' && 'bg-signal/12 text-signal',
        due.status === 'ok' && 'bg-surface-3 text-ink-dim',
        (due.status === 'snoozed' || due.status === 'no_interval' || due.status === 'unknown') && 'bg-surface-3 text-ink-faint',
      )}
      data-testid="item-due-status"
      data-status={due.status}
    >
      {STATUS_LABEL[due.status]}
    </span>
  );
}

function describeAxisDue(axis: AxisDue, unit: 'mi' | 'km'): string | null {
  if (axis.nextDue === null) return null;
  if (axis.axis === 'days') return typeof axis.nextDue === 'string' ? `by ${formatDay(axis.nextDue)}` : null;
  const figure = axis.axis === 'hours' ? formatHours(axis.nextDue) : formatDistance(axis.nextDue, unit);
  return figure ? `at ${figure}` : null;
}

function ItemDueLine({ due, unit }: { due: ItemDue | null; unit: 'mi' | 'km' }) {
  if (!due) return null;
  const next = due.axes.map((axis) => describeAxisDue(axis, unit)).filter((text): text is string => text !== null);
  return (
    <p className="mt-1 text-xs text-ink-dim">
      {due.lastDone ? `Last done ${formatDay(due.lastDone.serviceDate)}` : due.neverDone ? 'Never logged' : null}
      {next.length > 0 ? `${due.lastDone || due.neverDone ? ' · ' : ''}Next ${next.join(' or ')}` : ''}
    </p>
  );
}

function ReadingsPanel({ data }: { data: ServiceBookData }) {
  const readings = [...data.readings].sort((a, b) => (a.reading_date < b.reading_date ? 1 : a.reading_date > b.reading_date ? -1 : b.read_at.localeCompare(a.read_at)));
  const unit = data.book.distance_unit;
  return (
    <CardGroup eyebrow="Readings" title={readings.length === 0 ? 'None yet' : `${readings.length} ${readings.length === 1 ? 'reading' : 'readings'}`}>
      {readings.length === 0 ? (
        <GroupRow>
          <p className="text-sm text-ink-dim">Readings are what the book trusts; sessions only fill the gaps between them.</p>
        </GroupRow>
      ) : (
        readings.map((reading) => (
          <GroupRow key={reading.id} className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium tabular-nums text-ink">{formatReading(reading, unit) ?? '—'}</p>
              <p className="mt-0.5 text-xs text-ink-faint">
                {formatDay(reading.reading_date)}
                {reading.source === 'entry' ? ' · from a service entry' : reading.source === 'transfer' ? ' · carried over' : ''}
                {reading.supersedes_id ? ' · correction' : ''}
              </p>
            </div>
          </GroupRow>
        ))
      )}
    </CardGroup>
  );
}
