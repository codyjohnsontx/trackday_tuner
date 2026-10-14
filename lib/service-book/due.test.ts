import { describe, expect, it } from 'vitest';
import { computeDue, type DueEntry, type DueInput, type DueItem, type DueOverride, type ItemDue } from '@/lib/service-book/due';
import type { UsageReading, UsageSession } from '@/lib/service-book/usage';

const OIL = 'oil';

function item(extra: Partial<DueItem> = {}): DueItem {
  return { id: OIL, name: 'Engine oil', interval_hours: 10, interval_distance: null, interval_days: null, archived_at: null, ...extra };
}

function reading(id: string, date: string, hours: number | null, distance: number | null = null): UsageReading {
  return { id, reading_date: date, read_at: `${date}T08:00:00Z`, hours, distance, supersedes_id: null };
}

function entry(id: string, date: string, extra: Partial<DueEntry> = {}): DueEntry {
  return { id, service_date: date, reading_hours: null, reading_distance: null, logged_at: `${date}T18:00:00Z`, deleted_at: null, ...extra };
}

function session(id: string, date: string): UsageSession {
  return { id, date, created_at: `${date}T15:00:00Z` };
}

function override(kind: DueOverride['kind'], createdAt: string, extra: Partial<DueOverride> = {}): DueOverride {
  return {
    id: `o-${kind}-${createdAt}`,
    item_id: OIL,
    kind,
    until_date: null,
    until_hours: null,
    until_distance: null,
    anchor_hours: null,
    anchor_distance: null,
    created_at: createdAt,
    ...extra,
  };
}

/** An oil change at 10 h on 1 Sep, and the bike now at `hoursNow` by reading. */
function input(hoursNow: number, extra: Partial<DueInput> = {}): DueInput {
  return {
    usage: {
      book: { tracks_hours: true, tracks_distance: false, default_session_minutes: 60, default_session_distance: null },
      readings: [reading('r-done', '2026-09-01', 10), reading('r-now', '2026-10-01', hoursNow)],
      sessions: [],
      laps: [],
      weights: [],
    },
    distanceUnit: 'mi',
    items: [item()],
    entries: [entry('e1', '2026-09-01', { reading_hours: 10 })],
    entryItems: [{ entry_id: 'e1', item_id: OIL }],
    overrides: [],
    today: '2026-10-01',
    timeZone: 'UTC',
    ...extra,
  };
}

function only(due: ItemDue[]): ItemDue {
  expect(due).toHaveLength(1);
  return due[0];
}

describe('due state from intervals', () => {
  it('is ok, then due soon within the margin, then overdue once past', () => {
    expect(only(computeDue(input(15))).status).toBe('ok');
    // 10% of 10 h is 1 h, which is also the minimum.
    expect(only(computeDue(input(19))).status).toBe('due_soon');
    expect(only(computeDue(input(20))).status).toBe('due_soon');
    expect(only(computeDue(input(20.5))).status).toBe('overdue');
  });

  it('reports the axis it measured', () => {
    const due = only(computeDue(input(15)));
    expect(due.axes).toEqual([
      { axis: 'hours', anchor: 10, anchorEstimated: false, nextDue: 20, current: 15, remaining: 5, margin: 1, status: 'ok' },
    ]);
    expect(due.lastDone).toEqual({ entryId: 'e1', serviceDate: '2026-09-01' });
  });

  it('never makes an item with no interval due', () => {
    const due = only(computeDue(input(500, { items: [item({ interval_hours: null })] })));
    expect(due).toMatchObject({ status: 'no_interval', axes: [] });
  });

  it('leaves archived items out', () => {
    expect(computeDue(input(15, { items: [item({ archived_at: '2026-09-02T00:00:00Z' })] }))).toEqual([]);
  });

  it('is overdue when any one axis is', () => {
    const due = only(computeDue(input(11, { items: [item({ interval_days: 14 })] })));
    expect(due.axes.map((axis) => [axis.axis, axis.status])).toEqual([
      ['hours', 'ok'],
      ['days', 'overdue'],
    ]);
    expect(due.status).toBe('overdue');
  });

  it('uses 14 days, 50 mi and 80 km as the smallest margins', () => {
    const days = only(computeDue(input(11, { items: [item({ interval_hours: null, interval_days: 30 })], today: '2026-09-18' })));
    expect(days.axes[0]).toMatchObject({ nextDue: '2026-10-01', remaining: 13, margin: 14, status: 'due_soon' });

    const distanceBook = input(11, {
      distanceUnit: 'km',
      items: [item({ interval_hours: null, interval_distance: 500 })],
      entries: [entry('e1', '2026-09-01', { reading_distance: 1000 })],
    });
    distanceBook.usage = {
      ...distanceBook.usage,
      book: { ...distanceBook.usage.book, tracks_distance: true },
      readings: [reading('r', '2026-10-01', null, 1430)],
    };
    expect(only(computeDue(distanceBook)).axes[0]).toMatchObject({ remaining: 70, margin: 80, status: 'due_soon' });
  });

  it('cannot measure an axis the book does not track, and says so', () => {
    const due = only(computeDue(input(11, { items: [item({ interval_hours: null, interval_distance: 500 })] })));
    expect(due.axes).toMatchObject([{ axis: 'distance', current: null, status: 'unknown' }]);
    expect(due.status).toBe('unknown');
  });

  it('ignores a removed entry, so the item falls back to the one before it', () => {
    const due = only(
      computeDue(
        input(15, {
          entries: [entry('e1', '2026-09-01', { reading_hours: 10 }), entry('e2', '2026-09-20', { reading_hours: 14, deleted_at: '2026-09-21T00:00:00Z' })],
          entryItems: [
            { entry_id: 'e1', item_id: OIL },
            { entry_id: 'e2', item_id: OIL },
          ],
        }),
      ),
    );
    expect(due.lastDone?.entryId).toBe('e1');
  });

  it('anchors an entry logged without a reading at the bike usage on its date, marked estimated', () => {
    const base = input(0);
    const due = only(
      computeDue({
        ...base,
        usage: {
          ...base.usage,
          readings: [reading('r', '2026-08-01', 10)],
          sessions: [session('a', '2026-08-10'), session('b', '2026-09-10'), session('c', '2026-09-20')],
        },
        // Done on 1 Sep with no reading typed: 10 h + one 1 h session before it.
        entries: [entry('e1', '2026-09-01'), entry('older', '2026-07-01', { reading_hours: 2 })],
        entryItems: [
          { entry_id: 'e1', item_id: OIL },
          { entry_id: 'older', item_id: OIL },
        ],
      }),
    );
    expect(due.lastDone?.entryId).toBe('e1');
    expect(due.axes[0]).toMatchObject({ anchor: 11, anchorEstimated: true, nextDue: 21, current: 13 });
  });

  it('on a book with no readings, anchors a service done before the first session at zero', () => {
    const base = input(0);
    const sessions = Array.from({ length: 11 }, (_, day) => session(`s${day}`, `2026-10-${String(day + 5).padStart(2, '0')}`));
    const due = only(
      computeDue({
        ...base,
        usage: {
          ...base.usage,
          book: { tracks_hours: true, tracks_distance: true, default_session_minutes: 60, default_session_distance: 50 },
          readings: [],
          sessions,
        },
        items: [item({ interval_hours: 10, interval_distance: 500 })],
        entries: [entry('e1', '2026-10-01')],
        today: '2026-10-20',
      }),
    );
    expect(due.axes).toMatchObject([
      { axis: 'hours', anchor: 0, anchorEstimated: true, nextDue: 10, current: 11, status: 'overdue' },
      { axis: 'distance', anchor: 0, anchorEstimated: true, nextDue: 500, current: 550, status: 'overdue' },
    ]);
    expect(due.status).toBe('overdue');
  });

  it('anchors a service done before the first reading at that reading less the sessions ridden since', () => {
    const base = input(0);
    // Oil done on 30 Jul with no reading; twelve 1 h / 50 mi days after it; the
    // book's first reading on 1 Sep. The day before the service is not taken off.
    const between = Array.from({ length: 12 }, (_, day) => session(`s${day}`, `2026-08-${String(day + 1).padStart(2, '0')}`));
    const due = only(
      computeDue({
        ...base,
        usage: {
          ...base.usage,
          book: { tracks_hours: true, tracks_distance: true, default_session_minutes: 60, default_session_distance: 50 },
          readings: [reading('r', '2026-09-01', 300, 5000)],
          sessions: [session('before', '2026-07-29'), ...between],
        },
        items: [item({ interval_hours: 10, interval_distance: 500 })],
        entries: [entry('e1', '2026-07-30')],
        today: '2026-09-02',
      }),
    );
    expect(due.axes).toMatchObject([
      { axis: 'hours', anchor: 288, anchorEstimated: true, nextDue: 298, current: 300, status: 'overdue' },
      { axis: 'distance', anchor: 4400, anchorEstimated: true, nextDue: 4900, current: 5000, status: 'overdue' },
    ]);
  });

  it('never works a pre-reading anchor back below zero', () => {
    const base = input(0);
    const due = only(
      computeDue({
        ...base,
        usage: {
          ...base.usage,
          readings: [reading('r', '2026-09-01', 2)],
          sessions: [session('a', '2026-08-01'), session('b', '2026-08-02'), session('c', '2026-08-03')],
        },
        entries: [entry('e1', '2026-07-30')],
      }),
    );
    expect(due.axes[0]).toMatchObject({ anchor: 0, anchorEstimated: true, nextDue: 10, current: 2 });
  });

  it('lets a weight-0 day keep an item from coming due', () => {
    const base = input(0);
    const heavy = {
      ...base,
      usage: { ...base.usage, readings: [reading('r', '2026-09-01', 10)], sessions: [session('big', '2026-09-15')] },
    };
    heavy.usage.weights = [{ session_id: 'big', weight: 3, minutes_override: 240, distance_override: null }];
    expect(only(computeDue(heavy)).status).toBe('overdue');

    heavy.usage.weights = [{ session_id: 'big', weight: 0, minutes_override: 240, distance_override: null }];
    expect(only(computeDue(heavy)).status).toBe('ok');
  });

  describe('an item never done', () => {
    it('anchors at the first reading and reads at least due soon', () => {
      const due = only(computeDue(input(12, { entries: [], entryItems: [] })));
      expect(due).toMatchObject({ neverDone: true, lastDone: null, status: 'due_soon', underlyingStatus: 'due_soon' });
      expect(due.axes[0]).toMatchObject({ anchor: 10, nextDue: 20, status: 'ok' });
    });

    it('is overdue when its anchor says so', () => {
      expect(only(computeDue(input(25, { entries: [], entryItems: [] }))).status).toBe('overdue');
    });

    it('on a book with no readings, counts from zero at the first session', () => {
      const base = input(0, { entries: [], entryItems: [] });
      const due = only(
        computeDue({
          ...base,
          usage: { ...base.usage, readings: [], sessions: [session('a', '2026-09-01'), session('b', '2026-09-02')] },
        }),
      );
      expect(due.axes[0]).toMatchObject({ anchor: 0, anchorEstimated: true, current: 2, nextDue: 10 });
      expect(due.status).toBe('due_soon');
    });

    it('on a book with no readings and no sessions, still reads due soon rather than fine', () => {
      const base = input(0, { entries: [], entryItems: [] });
      const due = only(computeDue({ ...base, usage: { ...base.usage, readings: [] } }));
      expect(due.axes[0].status).toBe('unknown');
      expect(due.status).toBe('due_soon');
    });
  });
});

describe('the rider overrides', () => {
  describe('snooze', () => {
    it('reads snoozed while it holds, keeping what it would otherwise be', () => {
      const due = only(computeDue(input(25, { overrides: [override('snooze', '2026-09-30T00:00:00Z', { until_date: '2026-10-15' })] })));
      expect(due).toMatchObject({ status: 'snoozed', underlyingStatus: 'overdue', override: { kind: 'snooze' } });
    });

    it('ends on its date, and is no longer the override in force', () => {
      const snooze = override('snooze', '2026-09-30T00:00:00Z', { until_date: '2026-10-01' });
      expect(only(computeDue(input(25, { overrides: [snooze] })))).toMatchObject({ status: 'overdue', override: null });
    });

    it('ends once the bike reaches its hours or distance, whichever comes first', () => {
      const snooze = override('snooze', '2026-09-30T00:00:00Z', { until_date: '2027-01-01', until_hours: 24 });
      expect(only(computeDue(input(23, { overrides: [snooze] }))).status).toBe('snoozed');
      expect(only(computeDue(input(24, { overrides: [snooze] }))).status).toBe('overdue');
    });

    it('naming no limit, holds until the item is logged again: a dismissal', () => {
      const dismissed = override('snooze', '2026-09-30T00:00:00Z');
      expect(only(computeDue(input(500, { overrides: [dismissed] }))).status).toBe('snoozed');
    });

    it('is not an anchor, so a never-done item still sits under it at due soon', () => {
      const due = only(
        computeDue(input(12, { entries: [], entryItems: [], overrides: [override('snooze', '2026-09-30T00:00:00Z', { until_date: '2026-10-01' })] })),
      );
      expect(due.status).toBe('due_soon');
    });
  });

  describe('skip_cycle', () => {
    it('moves the anchor to where the bike was, without pretending to be a service', () => {
      const skip = override('skip_cycle', '2026-09-25T10:00:00Z', { anchor_hours: 19 });
      const due = only(computeDue(input(21, { overrides: [skip] })));
      expect(due.axes[0]).toMatchObject({ anchor: 19, anchorEstimated: false, nextDue: 29, status: 'ok' });
      expect(due.lastDone?.entryId).toBe('e1');
      expect(due.status).toBe('ok');
    });

    it('anchors the days axis on the rider day it was made', () => {
      const skip = override('skip_cycle', '2026-09-26T03:00:00Z', { anchor_hours: 19 });
      const due = only(computeDue(input(21, { items: [item({ interval_days: 30 })], overrides: [skip], timeZone: 'America/Chicago' })));
      expect(due.axes.find((axis) => axis.axis === 'days')).toMatchObject({ anchor: '2026-09-25', nextDue: '2026-10-25' });
    });

    it('anchors a never-done item, lifting the due-soon floor', () => {
      const skip = override('skip_cycle', '2026-09-25T10:00:00Z', { anchor_hours: 11 });
      expect(only(computeDue(input(12, { entries: [], entryItems: [], overrides: [skip] }))).status).toBe('ok');
    });
  });

  describe('set_next_due', () => {
    it('makes the typed point the only due point', () => {
      const set = override('set_next_due', '2026-09-25T10:00:00Z', { until_hours: 40 });
      const due = only(computeDue(input(25, { items: [item({ interval_days: 14 })], overrides: [set] })));
      expect(due.axes).toEqual([
        { axis: 'hours', anchor: null, anchorEstimated: false, nextDue: 40, current: 25, remaining: 15, margin: 1, status: 'ok' },
      ]);
      expect(due.status).toBe('ok');
    });

    it('takes a date', () => {
      const set = override('set_next_due', '2026-09-25T10:00:00Z', { until_date: '2026-10-10' });
      const due = only(computeDue(input(25, { overrides: [set] })));
      expect(due.axes).toMatchObject([{ axis: 'days', nextDue: '2026-10-10', remaining: 9, status: 'due_soon' }]);
    });

    it('applies to an item with no interval', () => {
      const set = override('set_next_due', '2026-09-25T10:00:00Z', { until_hours: 20 });
      expect(only(computeDue(input(25, { items: [item({ interval_hours: null })], overrides: [set] }))).status).toBe('overdue');
    });

    it('naming nothing, is ignored', () => {
      const set = override('set_next_due', '2026-09-25T10:00:00Z');
      expect(only(computeDue(input(25, { overrides: [set] }))).override).toBeNull();
    });
  });

  it('takes the newest override per item', () => {
    const due = only(
      computeDue(
        input(25, {
          overrides: [
            override('snooze', '2026-09-20T00:00:00Z', { until_date: '2027-01-01' }),
            override('set_next_due', '2026-09-28T00:00:00Z', { until_hours: 30 }),
          ],
        }),
      ),
    );
    expect(due).toMatchObject({ status: 'ok', override: { kind: 'set_next_due' } });
  });

  it('is ended by logging the item after it', () => {
    const snooze = override('snooze', '2026-08-15T00:00:00Z');
    const due = only(computeDue(input(25, { overrides: [snooze] })));
    expect(due).toMatchObject({ status: 'overdue', override: null });
  });

  it('is not ended by back-filling an older service, even when that is the only one', () => {
    const set = override('set_next_due', '2026-10-10T15:00:00Z', { until_hours: 40 });
    const backFilled = entry('paper', '2025-06-01', { reading_hours: 2, logged_at: '2026-10-12T18:00:00Z' });
    const due = only(
      computeDue(input(25, { entries: [backFilled], entryItems: [{ entry_id: 'paper', item_id: OIL }], overrides: [set] })),
    );
    expect(due).toMatchObject({ status: 'ok', override: { kind: 'set_next_due' }, lastDone: { entryId: 'paper' } });
  });

  it('is ended by a service dated on or after the rider day it was made', () => {
    const set = override('set_next_due', '2026-10-10T15:00:00Z', { until_hours: 40 });
    const done = entry('done', '2026-10-10', { reading_hours: 10, logged_at: '2026-10-12T18:00:00Z' });
    const due = only(
      computeDue(input(25, { entries: [done], entryItems: [{ entry_id: 'done', item_id: OIL }], overrides: [set] })),
    );
    expect(due).toMatchObject({ status: 'overdue', override: null });
  });

  it('is not ended by a same-day service logged before it was made', () => {
    const snooze = override('snooze', '2026-09-01T20:00:00Z');
    expect(only(computeDue(input(25, { overrides: [snooze] }))).status).toBe('snoozed');
  });

  it('only touches its own item', () => {
    const due = computeDue(
      input(25, {
        items: [item(), item({ id: 'chain', name: 'Chain' })],
        entryItems: [
          { entry_id: 'e1', item_id: OIL },
          { entry_id: 'e1', item_id: 'chain' },
        ],
        overrides: [override('snooze', '2026-09-30T00:00:00Z')],
      }),
    );
    expect(due.map((d) => [d.itemId, d.status])).toEqual([
      [OIL, 'snoozed'],
      ['chain', 'overdue'],
    ]);
  });
});
