'use client';

import Link from 'next/link';
import { useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardGroup, Eyebrow, GroupRow } from '@/components/ui/surface';
import { DueOverrideForm } from '@/components/service-book/due-override-form';
import { SessionWeightSelect } from '@/components/service-book/session-weight';
import { VehicleReadingForm } from '@/components/service-book/vehicle-reading-form';
import { useRiderClock, type RiderClock } from '@/components/service-book/rider-clock';
import { recordServiceBookOwnerTimeZone } from '@/lib/actions/service-book-shares';
import { buildServiceBookView, liveItems, type ReceivedHistory, type ServiceBookData, type ServiceBookView } from '@/lib/service-book/book-data';
import { describeEntryItems } from '@/lib/service-book/entry-draft';
import type { AxisDue, ItemDue, ItemDueStatus } from '@/lib/service-book/due';
import { formatDistance, formatHours, formatInterval, formatReading, formatServiceDate } from '@/lib/service-book/format';
import { describeOverride, SESSION_WEIGHT_CHOICES, weightChoiceOf } from '@/lib/service-book/reminders';
import type { AxisUsage, SessionUsage } from '@/lib/service-book/usage';
import { formatDay } from '@/lib/service-book/calendar';
import { riderDateOfTimestamp } from '@/lib/local-date';
import { cn } from '@/lib/utils';

interface ServiceBookScreenProps {
  data: ServiceBookData;
  demoMode: boolean;
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
export function ServiceBookScreen({ data, demoMode }: ServiceBookScreenProps) {
  const clock = useRiderClock();
  const view = useMemo(() => (clock ? buildServiceBookView(data, clock) : null), [data, clock]);
  const vehicleId = data.vehicle.id;
  const items = liveItems(data.items);
  const unit = data.book.distance_unit;
  const storedZone = data.book.owner_time_zone;

  // A shared copy of the book is labelled in the owner's zone, which only their
  // browser knows; record it the first time they open the book. Once stored it
  // never moves, so opening the book from somewhere else relabels nothing.
  useEffect(() => {
    if (demoMode || !clock || storedZone !== null) return;
    void recordServiceBookOwnerTimeZone(vehicleId, clock.timeZone);
  }, [demoMode, clock, storedZone, vehicleId]);

  return (
    <div className="space-y-5">
      {view?.handover ? <ReceivedBanner handover={view.handover} /> : null}

      <UsagePanel data={data} view={view} demoMode={demoMode} />

      <CountedSessions data={data} view={view} demoMode={demoMode} />

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
          items.map((item) => {
            const due = view?.dueByItemId.get(item.id) ?? null;
            return (
              <GroupRow key={item.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{item.name}</p>
                    <p className="mt-0.5 text-xs text-ink-faint">{formatInterval(item, unit) ?? 'No interval set'}</p>
                    <ItemDueLine due={due} unit={unit} />
                    <OverrideLine data={data} due={due} clock={clock} unit={unit} />
                  </div>
                  <DueChip due={due} />
                </div>
                {demoMode ? null : (
                  <DueOverrideForm vehicleId={vehicleId} item={{ id: item.id, name: item.name }} book={data.book} usage={view?.usage ?? null} due={due} />
                )}
              </GroupRow>
            );
          })
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
        {view?.handover?.removedEntries ? (
          <GroupRow>
            <p className="text-sm text-ink-dim" data-testid="received-removed-entries">
              {view.handover.removedEntries}
            </p>
          </GroupRow>
        ) : null}
      </CardGroup>

      <ReadingsPanel data={data} />
    </div>
  );
}

/**
 * A book that came with a bike handed over by its previous owner (owner, PQ2).
 * The counts are what of that history is here now, read off the rows' own
 * `copied_from_*` pointers; nothing here reaches the previous owner's data, and
 * the two copies never do.
 */
function ReceivedBanner({ handover }: { handover: ReceivedHistory }) {
  const entries = `${handover.entries} ${handover.entries === 1 ? 'entry' : 'entries'}`;
  const sessions = `${handover.sessions} ${handover.sessions === 1 ? 'session' : 'sessions'}`;
  return (
    <Card id="received-book-banner">
      <Eyebrow>Handed over to you</Eyebrow>
      <p className="mt-2 text-sm text-ink">
        Handed over to you on {handover.handedOverOn}. {entries} and {sessions} from before then are here now; the previous owner keeps
        their own copy, and nothing either of you adds from now on reaches the other.
      </p>
      <p className="mt-1 text-xs text-ink-faint">Entries a previous owner logged can be removed but not edited. What you log is yours.</p>
    </Card>
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

/**
 * The override in force on an item, in the rider's words. A snooze that has run
 * out is not in force, since the schedule's own answer is back on the chip.
 */
function OverrideLine({ data, due, clock, unit }: { data: ServiceBookData; due: ItemDue | null; clock: RiderClock | null; unit: 'mi' | 'km' }) {
  if (!due?.override || !clock) return null;
  const row = data.overrides.find((override) => override.id === due.override?.id);
  if (!row) return null;
  const text = describeOverride(row, unit, { madeOn: riderDateOfTimestamp(row.created_at, clock.timeZone) });
  return (
    <p className="mt-1 text-xs text-ink-faint" data-testid="item-override">
      {text}
    </p>
  );
}

/**
 * The sessions counted on top of the latest reading, each with the rider's
 * weight (owner, 2026-10-08: the rider decides what a day counts for). Only
 * these move the figure above, so only these are offered here; the session
 * page offers the same control for any session of the bike.
 */
function CountedSessions({ data, view, demoMode }: { data: ServiceBookData; view: ServiceBookView | null; demoMode: boolean }) {
  if (!view) return null;
  const byId = new Map<string, SessionUsage>();
  for (const axis of [view.usage.hours, view.usage.distance]) {
    for (const session of axis?.sessions ?? []) byId.set(session.sessionId, session);
  }
  const sessions = [...byId.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (sessions.length === 0) return null;
  const weightById = new Map(data.weights.map((row) => [row.session_id, row.weight]));

  return (
    <CardGroup eyebrow="Counted since the last reading" title={`${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`}>
      {sessions.map((session) => {
        const weight = weightById.get(session.sessionId) ?? null;
        const label = SESSION_WEIGHT_CHOICES.find((choice) => choice.value === weightChoiceOf(weight))?.label ?? 'Normal';
        return (
          <GroupRow key={session.sessionId} className="flex items-center justify-between gap-3">
            <Link
              href={`/sessions/${session.sessionId}`}
              className="flex min-h-11 min-w-0 flex-col justify-center rounded-plate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
            >
              <span className="text-sm font-medium text-ink">{formatDay(session.date)}</span>
              <span className="mt-0.5 text-xs text-ink-faint">
                {Math.round(session.minutes)} min{session.minutesBasis === 'laps' ? ' from lap times' : session.minutesBasis === 'override' ? ', your figure' : ', the book’s default'}
                {session.weight !== 1 ? ` · counted ×${session.weight}` : ''}
              </span>
            </Link>
            {demoMode ? (
              <span className="shrink-0 text-xs text-ink-dim">{label}</span>
            ) : (
              <SessionWeightSelect vehicleId={data.vehicle.id} sessionId={session.sessionId} weight={weight} label={formatDay(session.date)} />
            )}
          </GroupRow>
        );
      })}
    </CardGroup>
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
