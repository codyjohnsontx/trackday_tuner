import type { DistanceUnit, ServiceDueOverrideKind, Tables } from '@/types/supabase';
import { riderDateOfTimestamp } from '@/lib/local-date';
import { addDays, daysBetween, instantOf, isIsoDate } from '@/lib/service-book/calendar';
import {
  computeUsage,
  currentReadings,
  firstReading,
  usageBeforeReading,
  type UsageAxis,
  type UsageInput,
} from '@/lib/service-book/usage';

/**
 * What is due on a bike, item by item.
 *
 * An item is measured on up to three axes - hours, distance, days - each from
 * the last time it was done to that point plus its interval. It is `overdue`
 * once the bike has passed the due point on ANY axis, and `due_soon` within a
 * margin of one: 10% of the interval, and never less than 1 h, 50 mi / 80 km or
 * 14 days. An item with no interval is never due.
 *
 * WHEN IT WAS LAST DONE. The newest entry covering the item (not removed) is the
 * last service. Its own reading anchors the hours and distance axes; an entry
 * logged without one is anchored at the bike's usage on its service date
 * (`computeUsage` with `asOf`), and is marked estimated. A service dated before
 * the book's first reading on an axis is anchored at that reading less what the
 * sessions since the service add (`usageBeforeReading`), since a session count
 * from zero shares no scale with usage now; on a book with no reading at all it
 * is the session count by that date, zero when none came before it. An older
 * entry that did carry a reading is NOT used in its place - it would anchor the item before its
 * newest service and call it overdue when it was just done.
 *
 * NEVER DONE. Anchored at the book's first reading on that axis, or zero at the
 * first logged session when there is no reading, and the earliest of those two
 * dates on the days axis. It reads at least `due_soon` until the rider logs it or
 * sets an anchor with an override, because a book that has never seen an item
 * done cannot say it is fine.
 *
 * THE RIDER OVERRIDES (owner, 2026-10-08). Reminders are suggestions; the rider
 * decides. The newest `service_due_overrides` row per item wins. A service logged
 * after it and dated on or after the rider day it was made ends it, since that
 * is the rider's newer word on that item; back-filling older history never does,
 * whatever else the book holds:
 *
 * - `snooze`: the item reads `snoozed` until `until_date` is reached or the bike
 *   reaches `until_hours` / `until_distance`, whichever comes first. A snooze
 *   naming none of them holds until the item is logged again, which is how a
 *   reminder is dismissed. A limit on an axis whose usage is unknown does not end
 *   it: the rider's word stands until the book can show it has run out.
 * - `skip_cycle`: the anchor moves to where the bike was when the rider skipped -
 *   `anchor_hours`, `anchor_distance`, and the day the override was made - so the
 *   next due point is one interval on from there. It is never a service: nothing
 *   is written to readings or entries, and `lastDone` still names the real one.
 * - `set_next_due`: the rider types the next due point outright. The axes they
 *   typed are the only due points until the item is logged again; an axis they
 *   left blank is not measured, because the rider has said when this is next due.
 *   It applies to an item with no interval too.
 *
 * Adjusting an interval is an edit of `service_items` and needs no rule here.
 * Weighting or dismissing a session is `session_usage_weights`, which reaches
 * this through `computeUsage`.
 *
 * Pure: no Supabase, no Next, so the phone app can import it.
 */

export type DueAxis = UsageAxis | 'days';
export type AxisDueStatus = 'ok' | 'due_soon' | 'overdue' | 'unknown';
export type ItemDueStatus = 'no_interval' | 'ok' | 'due_soon' | 'overdue' | 'snoozed' | 'unknown';

export type DueItem = Pick<
  Tables<'service_items'>,
  'id' | 'name' | 'interval_hours' | 'interval_distance' | 'interval_days' | 'archived_at'
>;
export type DueEntry = Pick<
  Tables<'service_entries'>,
  'id' | 'service_date' | 'reading_hours' | 'reading_distance' | 'logged_at' | 'deleted_at'
>;
export type DueEntryItem = Pick<Tables<'service_entry_items'>, 'entry_id' | 'item_id'>;
export type DueOverride = Pick<
  Tables<'service_due_overrides'>,
  | 'id'
  | 'item_id'
  | 'kind'
  | 'until_date'
  | 'until_hours'
  | 'until_distance'
  | 'anchor_hours'
  | 'anchor_distance'
  | 'created_at'
>;

export interface DueInput {
  usage: UsageInput;
  distanceUnit: DistanceUnit;
  items: readonly DueItem[];
  entries: readonly DueEntry[];
  entryItems: readonly DueEntryItem[];
  overrides: readonly DueOverride[];
  /** The rider's calendar date (`todayLocalDate`), never the server's. */
  today: string;
  /** The book owner's IANA zone, for the day an override was made. */
  timeZone: string;
}

export interface AxisDue {
  axis: DueAxis;
  /** Where the count starts: a usage figure, or a date on the days axis. */
  anchor: number | string | null;
  /** True when the anchor came from session estimates rather than a reading. */
  anchorEstimated: boolean;
  /** The due point: a usage figure, or a date on the days axis. */
  nextDue: number | string | null;
  /** Usage now, or today's date on the days axis. */
  current: number | string | null;
  /** How far to go: hours, distance or days. Negative once past. */
  remaining: number | null;
  /** How close counts as due soon, in the axis's own unit. */
  margin: number;
  status: AxisDueStatus;
}

export interface ItemDue {
  itemId: string;
  name: string;
  status: ItemDueStatus;
  /** What the status would be without a snooze; equal to `status` otherwise. */
  underlyingStatus: Exclude<ItemDueStatus, 'snoozed'>;
  lastDone: { entryId: string; serviceDate: string } | null;
  neverDone: boolean;
  /** The override in force, if any. */
  override: { id: string; kind: ServiceDueOverrideKind } | null;
  axes: AxisDue[];
}

const SOON_FRACTION = 0.1;
const MIN_MARGIN = { hours: 1, mi: 50, km: 80, days: 14 } as const;

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positive(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function marginFor(axis: DueAxis, interval: number | null, unit: DistanceUnit): number {
  const minimum = axis === 'hours' ? MIN_MARGIN.hours : axis === 'days' ? MIN_MARGIN.days : MIN_MARGIN[unit];
  return Math.max((interval ?? 0) * SOON_FRACTION, minimum);
}

function statusFor(remaining: number | null, margin: number): AxisDueStatus {
  if (remaining === null) return 'unknown';
  if (remaining < 0) return 'overdue';
  if (remaining <= margin) return 'due_soon';
  return 'ok';
}

const RANK: Record<AxisDueStatus, number> = { unknown: 0, ok: 1, due_soon: 2, overdue: 3 };

/** Newest first: service date, then when it was logged. */
function compareEntriesDesc(a: DueEntry, b: DueEntry): number {
  if (a.service_date !== b.service_date) return a.service_date < b.service_date ? 1 : -1;
  return (instantOf(b.logged_at) ?? 0) - (instantOf(a.logged_at) ?? 0);
}

/** The newest override per item, by the server's `created_at`. */
function newestOverride(overrides: readonly DueOverride[], itemId: string): DueOverride | null {
  let newest: DueOverride | null = null;
  for (const override of overrides) {
    if (override.item_id !== itemId) continue;
    if (
      newest === null ||
      (instantOf(override.created_at) ?? 0) > (instantOf(newest.created_at) ?? 0) ||
      (override.created_at === newest.created_at && override.id > newest.id)
    ) {
      newest = override;
    }
  }
  return newest;
}

/** Whether an override names anything to act on. A `skip_cycle` always does: its day. */
function overrideSaysSomething(override: DueOverride): boolean {
  if (override.kind !== 'set_next_due') return true;
  return (
    isIsoDate(override.until_date) || finite(override.until_hours) !== null || finite(override.until_distance) !== null
  );
}

export function computeDue(input: DueInput): ItemDue[] {
  const now = computeUsage(input.usage);
  const liveEntries = input.entries.filter((entry) => entry.deleted_at === null);
  const entryById = new Map(liveEntries.map((entry) => [entry.id, entry]));
  const asOfCache = new Map<string, ReturnType<typeof computeUsage>>();
  const usageAsOf = (date: string) => {
    let usage = asOfCache.get(date);
    if (!usage) {
      usage = computeUsage(input.usage, { asOf: date });
      asOfCache.set(date, usage);
    }
    return usage;
  };

  const firstSessionDate = [...input.usage.sessions].map((session) => session.date).sort()[0] ?? null;

  return input.items
    .filter((item) => item.archived_at === null)
    .map((item) => {
      const entries = input.entryItems
        .filter((row) => row.item_id === item.id)
        .map((row) => entryById.get(row.entry_id))
        .filter((entry): entry is DueEntry => entry !== undefined)
        .sort(compareEntriesDesc);
      const last = entries[0] ?? null;

      let override = newestOverride(input.overrides, item.id);
      if (override) {
        const madeAt = instantOf(override.created_at) ?? 0;
        const madeOn = riderDateOfTimestamp(override.created_at, input.timeZone);
        if (entries.some((entry) => (instantOf(entry.logged_at) ?? 0) > madeAt && entry.service_date >= madeOn)) {
          override = null;
        }
      }
      if (override && !overrideSaysSomething(override)) override = null;

      const intervals = {
        hours: positive(item.interval_hours),
        distance: positive(item.interval_distance),
        days: positive(item.interval_days),
      };

      const usageAnchor = (axis: UsageAxis): { anchor: number | null; estimated: boolean } => {
        if (last) {
          const own = finite(axis === 'hours' ? last.reading_hours : last.reading_distance);
          if (own !== null) return { anchor: own, estimated: false };
          const then = usageAsOf(last.service_date)[axis];
          if (then?.reading) return { anchor: then.current, estimated: then.basis !== 'reading' };
          const first = firstReading(input.usage.readings, axis);
          if (first) return { anchor: usageBeforeReading(input.usage, axis, last.service_date, first), estimated: true };
          return { anchor: then ? (then.current ?? 0) : null, estimated: true };
        }
        const first = firstReading(input.usage.readings, axis);
        if (first) return { anchor: finite(axis === 'hours' ? first.hours : first.distance), estimated: false };
        // No reading at all: usage is counted from zero at the first session.
        return { anchor: now[axis] ? 0 : null, estimated: true };
      };

      const daysAnchor = (): string | null => {
        if (last) return last.service_date;
        const readingDates = currentReadings(input.usage.readings).map((reading) => reading.reading_date).filter(isIsoDate);
        const candidates = [...readingDates, ...(firstSessionDate ? [firstSessionDate] : [])].sort();
        return candidates[0] ?? null;
      };

      const usageAxis = (axis: UsageAxis): AxisDue | null => {
        const current = now[axis]?.current ?? null;
        const interval = intervals[axis];
        const margin = marginFor(axis, interval, input.distanceUnit);
        const typed = axis === 'hours' ? override?.until_hours : override?.until_distance;

        let anchor: number | null = null;
        let estimated = false;
        let nextDue: number | null = null;
        if (override?.kind === 'set_next_due') {
          nextDue = finite(typed);
          if (nextDue === null) return null;
        } else {
          if (interval === null) return null;
          const skipped =
            override?.kind === 'skip_cycle'
              ? finite(axis === 'hours' ? override.anchor_hours : override.anchor_distance)
              : null;
          const from = skipped !== null ? { anchor: skipped, estimated: false } : usageAnchor(axis);
          anchor = from.anchor;
          estimated = from.estimated;
          nextDue = anchor === null ? null : anchor + interval;
        }

        const remaining = nextDue === null || current === null ? null : nextDue - current;
        return {
          axis,
          anchor,
          anchorEstimated: estimated,
          nextDue,
          current,
          remaining,
          margin,
          status: statusFor(remaining, margin),
        };
      };

      const dayAxis = (): AxisDue | null => {
        const interval = intervals.days;
        const margin = marginFor('days', interval, input.distanceUnit);

        let anchor: string | null = null;
        let nextDue: string | null = null;
        if (override?.kind === 'set_next_due') {
          if (!isIsoDate(override.until_date)) return null;
          nextDue = override.until_date;
        } else {
          if (interval === null) return null;
          anchor =
            override?.kind === 'skip_cycle' ? riderDateOfTimestamp(override.created_at, input.timeZone) : daysAnchor();
          nextDue = anchor === null ? null : addDays(anchor, interval);
        }

        const remaining = nextDue === null ? null : daysBetween(input.today, nextDue);
        return {
          axis: 'days',
          anchor,
          anchorEstimated: false,
          nextDue,
          current: input.today,
          remaining,
          margin,
          status: statusFor(remaining, margin),
        };
      };

      const axes = [usageAxis('hours'), usageAxis('distance'), dayAxis()].filter(
        (axis): axis is AxisDue => axis !== null,
      );

      let underlying: Exclude<ItemDueStatus, 'snoozed'>;
      if (axes.length === 0) {
        underlying = 'no_interval';
      } else {
        const worst = axes.reduce<AxisDueStatus>(
          (status, axis) => (RANK[axis.status] > RANK[status] ? axis.status : status),
          'unknown',
        );
        underlying = worst;
        // Never done and no anchor of the rider's: it cannot read as fine. A snooze
        // is not an anchor, so it hides this floor without removing it.
        const anchoredByRider = override?.kind === 'skip_cycle' || override?.kind === 'set_next_due';
        if (last === null && !anchoredByRider && (worst === 'ok' || worst === 'unknown')) underlying = 'due_soon';
      }

      const snoozed = override?.kind === 'snooze' && snoozeHolds(override, now, input.today);

      return {
        itemId: item.id,
        name: item.name,
        status: snoozed ? 'snoozed' : underlying,
        underlyingStatus: underlying,
        lastDone: last ? { entryId: last.id, serviceDate: last.service_date } : null,
        neverDone: last === null,
        override: override ? { id: override.id, kind: override.kind } : null,
        axes,
      };
    });
}

function snoozeHolds(override: DueOverride, now: ReturnType<typeof computeUsage>, today: string): boolean {
  if (isIsoDate(override.until_date) && today >= override.until_date) return false;
  const untilHours = finite(override.until_hours);
  const hours = now.hours?.current ?? null;
  if (untilHours !== null && hours !== null && hours >= untilHours) return false;
  const untilDistance = finite(override.until_distance);
  const distance = now.distance?.current ?? null;
  if (untilDistance !== null && distance !== null && distance >= untilDistance) return false;
  return true;
}
