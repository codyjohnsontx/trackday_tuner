import { describe, expect, it } from 'vitest';
import type { DueOverride, ItemDue } from '@/lib/service-book/due';
import {
  computeBookDue,
  describeDueSummary,
  describeOverride,
  describeSessionDuePush,
  describeSessionDuePushText,
  summarizeDue,
  weightChoiceOf,
  weightOfChoice,
  type ServiceDueData,
} from '@/lib/service-book/reminders';

const CLOCK = { today: '2026-10-01', timeZone: 'UTC' };
const OIL = 'oil';
const TIRES = 'tires';
const SESSION = 'session-1';

/**
 * An oil change at 41.5 h, the bike read at 56.4 h since, and one 20-minute
 * session logged after that reading: the oil item is due at 56.5 h, so the
 * reading alone leaves it due soon and the session's third of an hour pushes
 * it past due. That is the walk `tests/e2e/service-book-due.spec.ts` takes
 * through the screens.
 */
function data(extra: Partial<ServiceDueData> = {}): ServiceDueData {
  return {
    book: { tracks_hours: true, tracks_distance: false, distance_unit: 'mi', default_session_minutes: 20, default_session_distance: null },
    items: [
      { id: OIL, name: 'Engine oil and filter', interval_hours: 15, interval_distance: null, interval_days: null, archived_at: null },
      { id: TIRES, name: 'Tires', interval_hours: null, interval_distance: null, interval_days: null, archived_at: null },
    ],
    entries: [
      {
        id: 'e-oil',
        service_date: '2026-08-01',
        reading_hours: 41.5,
        reading_distance: null,
        logged_at: '2026-08-01T18:00:00Z',
        deleted_at: null,
        items: [{ entry_id: 'e-oil', item_id: OIL }],
      },
    ],
    readings: [
      { id: 'r-oil', reading_date: '2026-08-01', read_at: '2026-08-01T18:00:00Z', hours: 41.5, distance: null, supersedes_id: null },
      { id: 'r-now', reading_date: '2026-09-20', read_at: '2026-09-20T08:00:00Z', hours: 56.4, distance: null, supersedes_id: null },
    ],
    sessions: [{ id: SESSION, date: '2026-09-27', created_at: '2026-09-27T15:00:00Z' }],
    laps: [],
    weights: [],
    overrides: [],
    ...extra,
  };
}

function statusOf(due: ItemDue[], itemId: string): ItemDue['status'] {
  const item = due.find((candidate) => candidate.itemId === itemId);
  if (!item) throw new Error(`no due item ${itemId}`);
  return item.status;
}

describe('the due summary behind a chip', () => {
  it('names one item and counts several, overdue before due soon', () => {
    const due = computeBookDue(data(), CLOCK);
    expect(statusOf(due, OIL)).toBe('overdue');
    expect(statusOf(due, TIRES)).toBe('no_interval');
    const summary = summarizeDue(due);
    expect(summary.status).toBe('overdue');
    expect(describeDueSummary(summary)).toBe('Engine oil and filter overdue');

    const many = summarizeDue([
      { ...due[0], itemId: 'a', name: 'A', status: 'overdue' },
      { ...due[0], itemId: 'b', name: 'B', status: 'overdue' },
      { ...due[0], itemId: 'c', name: 'C', status: 'due_soon' },
    ]);
    expect(describeDueSummary(many)).toBe('2 overdue · C due soon');
  });

  it('says nothing when nothing needs attention', () => {
    const due = computeBookDue(data({ sessions: [], readings: data().readings.slice(0, 1) }), CLOCK);
    expect(statusOf(due, OIL)).toBe('ok');
    const summary = summarizeDue(due);
    expect(summary.status).toBeNull();
    expect(describeDueSummary(summary)).toBeNull();
  });

  it('reads a snoozed item as nothing to show, not as due', () => {
    const snooze: DueOverride = {
      id: 'o1',
      item_id: OIL,
      kind: 'snooze',
      until_date: '2026-12-01',
      until_hours: null,
      until_distance: null,
      anchor_hours: null,
      anchor_distance: null,
      created_at: '2026-09-28T10:00:00Z',
    };
    const due = computeBookDue(data({ overrides: [snooze] }), CLOCK);
    expect(statusOf(due, OIL)).toBe('snoozed');
    expect(describeDueSummary(summarizeDue(due))).toBeNull();
  });
});

describe('what a session pushed past due', () => {
  it('names the item the session carried from due soon to overdue', () => {
    const pushed = describeSessionDuePush(data(), SESSION, CLOCK);
    expect(pushed).toEqual([{ itemId: OIL, name: 'Engine oil and filter', from: 'due_soon', to: 'overdue' }]);
    expect(describeSessionDuePushText(pushed)).toBe('This day pushed Engine oil and filter past due.');
  });

  it('clears once the rider says the day did not count', () => {
    const weighted = data({ weights: [{ session_id: SESSION, weight: 0, minutes_override: null, distance_override: null }] });
    expect(describeSessionDuePush(weighted, SESSION, CLOCK)).toEqual([]);
    expect(describeSessionDuePushText([])).toBeNull();
  });

  it('is not raised by a day that left the item where it was', () => {
    // A reading well short of due: one session cannot reach the margin.
    const early = data({ readings: [data().readings[0], { ...data().readings[1], hours: 50 }] });
    expect(statusOf(computeBookDue(early, CLOCK), OIL)).toBe('ok');
    expect(describeSessionDuePush(early, SESSION, CLOCK)).toEqual([]);
  });

  it('reads a day that brought an item due soon as its own sentence', () => {
    // 54.9 h plus a third of an hour crosses the 1.5 h margin below 56.5 h.
    const near = data({ readings: [data().readings[0], { ...data().readings[1], hours: 54.9 }] });
    const pushed = describeSessionDuePush(near, SESSION, CLOCK);
    expect(pushed).toEqual([{ itemId: OIL, name: 'Engine oil and filter', from: 'ok', to: 'due_soon' }]);
    expect(describeSessionDuePushText(pushed)).toBe('This day brought Engine oil and filter due soon.');
    expect(
      describeSessionDuePushText([
        ...pushed,
        { itemId: 'a', name: 'Brake pads', from: 'due_soon', to: 'overdue' },
        { itemId: 'b', name: 'Chain', from: 'due_soon', to: 'overdue' },
      ]),
    ).toBe('This day pushed Brake pads and Chain past due and brought Engine oil and filter due soon.');
  });

  it('is not raised on a snoozed item, which the rider has already answered', () => {
    const snoozed = data({
      overrides: [
        {
          id: 'o1',
          item_id: OIL,
          kind: 'snooze',
          until_date: null,
          until_hours: null,
          until_distance: null,
          anchor_hours: null,
          anchor_distance: null,
          created_at: '2026-09-28T10:00:00Z',
        },
      ],
    });
    expect(describeSessionDuePush(snoozed, SESSION, CLOCK)).toEqual([]);
  });

  it('is nothing for a session the book does not know', () => {
    expect(describeSessionDuePush(data(), 'elsewhere', CLOCK)).toEqual([]);
  });
});

describe('the weight choices', () => {
  it('map the three the screens offer and nothing else', () => {
    expect(weightChoiceOf(0)).toBe('none');
    expect(weightChoiceOf(1)).toBe('normal');
    expect(weightChoiceOf(2)).toBe('heavy');
    expect(weightChoiceOf(null)).toBeNull();
    expect(weightChoiceOf(0.5)).toBeNull();
    expect(weightOfChoice('none')).toBe(0);
    expect(weightOfChoice('heavy')).toBe(2);
  });
});

describe('the override in force, in words', () => {
  const base = { until_date: null, until_hours: null, until_distance: null };

  it('says what a snooze waits for, or that it waits for the next service', () => {
    const state = { holds: true, madeOn: '2026-09-28' };
    expect(describeOverride({ ...base, kind: 'snooze', until_date: '2026-10-20' }, 'mi', state)).toBe('Snoozed until 20 Oct 2026');
    expect(describeOverride({ ...base, kind: 'snooze', until_hours: 60, until_distance: 1300 }, 'mi', state)).toBe('Snoozed until 60 h or 1,300 mi');
    expect(describeOverride({ ...base, kind: 'snooze' }, 'mi', state)).toBe('Snoozed until logged again');
  });

  it('says nothing for a snooze that has run out', () => {
    expect(describeOverride({ ...base, kind: 'snooze', until_date: '2026-09-30' }, 'mi', { holds: false, madeOn: '2026-09-28' })).toBeNull();
  });

  it('dates a skipped cycle and credits a typed next due', () => {
    expect(describeOverride({ ...base, kind: 'skip_cycle' }, 'mi', { holds: false, madeOn: '2026-09-28' })).toBe('Skipped a cycle on 28 Sep 2026');
    expect(describeOverride({ ...base, kind: 'set_next_due', until_hours: 70 }, 'mi', { holds: false, madeOn: '2026-09-28' })).toBe('Next due set by you');
  });
});
