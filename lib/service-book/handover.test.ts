import { describe, expect, it } from 'vitest';
import { getDemoServiceBook } from '@/lib/demo/service-book';
import { buildServiceBookView, liveItems } from '@/lib/service-book/book-data';
import {
  countHandover,
  daysUntil,
  describeHandover,
  describeHandoverState,
  describeMegabytes,
  describeSoldBook,
  handoverReadingDefaults,
  isHandoverEmailShape,
  normalizeHandoverEmail,
  type HandoverCounts,
} from '@/lib/service-book/handover';

/**
 * The handover screen's words are derived from the book's own read, so the
 * counter is run over the same `ServiceBookData` the book screen renders and
 * checked against the rows, and the describer is pinned line by line.
 */

const demo = getDemoServiceBook('demo-r6')!;
const clock = { today: '2026-10-18', timeZone: 'America/Chicago' };

const counts: HandoverCounts = {
  entries: 12,
  backFilled: 2,
  edited: 1,
  itemsWithIntervals: 5,
  readings: 4,
  attachments: 7,
  attachmentBytes: 3_355_443,
  sessions: 9,
  laps: 131,
  sessionPhotos: 3,
  outcomes: 6,
  overrides: 2,
  weights: 1,
  removedEntries: 3,
};

describe('countHandover', () => {
  const view = buildServiceBookView(demo.data, clock);
  const counted = countHandover(demo.data, view, { sessionPhotos: 2, outcomes: 1, removedEntries: 1 });

  it('counts the rows the book screen renders, and nothing else', () => {
    const live = demo.data.entries.filter((entry) => entry.deleted_at === null);
    expect(counted.entries).toBe(live.length);
    expect(counted.itemsWithIntervals).toBe(
      liveItems(demo.data.items).filter((item) => item.interval_hours !== null || item.interval_distance !== null || item.interval_days !== null).length,
    );
    expect(counted.readings).toBe(demo.data.readings.filter((reading) => reading.source !== 'entry').length);
    expect(counted.attachments).toBe(live.flatMap((entry) => entry.attachments).length);
    expect(counted.attachmentBytes).toBe(live.flatMap((entry) => entry.attachments).reduce((total, a) => total + a.bytes, 0));
    expect(counted.sessions).toBe(demo.data.sessions.length);
    expect(counted.laps).toBe(demo.data.laps.length);
    expect(counted.overrides).toBe(demo.data.overrides.length);
    expect(counted.weights).toBe(demo.data.weights.length);
  });

  it('reads the labels off the same view the book shows', () => {
    const labels = [...view.provenanceByEntryId.values()];
    expect(counted.backFilled).toBe(labels.filter((p) => p.timing.kind === 'back_filled').length);
    expect(counted.edited).toBe(labels.filter((p) => p.edits.kind === 'edited').length);
    // The demo book has both kinds, so the two counts are not trivially zero.
    expect(counted.edited).toBeGreaterThan(0);
  });

  it('carries the three figures the book never loads, and adds earlier owners\' removals to this owner\'s', () => {
    expect(counted).toMatchObject({ sessionPhotos: 2, outcomes: 1 });
    expect(counted.removedEntries).toBe(demo.data.book.transferred_removed_entry_count + 1);
    const inherited = { ...demo.data, book: { ...demo.data.book, transferred_removed_entry_count: 4 } };
    expect(countHandover(inherited, view, { sessionPhotos: 0, outcomes: 0, removedEntries: 1 }).removedEntries).toBe(5);
  });

  it('leaves a removed entry the caller named out of every count', () => {
    const removed = { ...demo.data.entries[0], id: 'removed', deleted_at: '2026-10-01T00:00:00Z' };
    const withRemoved = { ...demo.data, entries: [...demo.data.entries, removed] };
    const again = countHandover(withRemoved, buildServiceBookView(withRemoved, clock), { sessionPhotos: 0, outcomes: 0, removedEntries: 0 });
    expect(again.entries).toBe(counted.entries);
    expect(again.attachments).toBe(counted.attachments);
  });
});

describe('describeHandover', () => {
  it('says what goes over, what stays, what the seller keeps, and warns about receipts in one line', () => {
    expect(describeHandover(counts)).toEqual({
      goesOver: [
        'Your service book: 12 entries (2 back-filled, 1 edited), 5 items with intervals, 4 readings, 7 receipts and photos (about 3.2 MB)',
        'Your track sessions on this bike: 9 sessions, 131 lap times, 3 photos, 6 outcome notes',
        'Your snoozes and adjustments: 2',
        '1 session you weighted',
        '3 removed entries are counted, not shown',
      ],
      staysWithYou:
        'What stays with you only: your Race Engineer advice and what it has learned about this bike, your saved baseline setup, and your AI questions.',
      youKeep:
        'What you keep: a read-only copy of everything above, as it stands the moment the buyer accepts. Anything either of you adds afterwards is yours alone.',
      receiptsWarning:
        'Receipts and photos go over exactly as you uploaded them, so remove any that show details you would rather keep before you hand over.',
    });
  });

  it('drops the detail that does not apply: no labels, no receipts, no removals', () => {
    const bare = describeHandover({ ...counts, backFilled: 0, edited: 0, attachments: 0, attachmentBytes: 0, removedEntries: 0, entries: 1, weights: 2 });
    expect(bare.goesOver[0]).toBe('Your service book: 1 entry, 5 items with intervals, 4 readings, 0 receipts and photos');
    expect(bare.goesOver).toHaveLength(4);
    expect(bare.goesOver[3]).toBe('2 sessions you weighted');
    expect(bare.receiptsWarning).toBeNull();
    expect(describeHandover({ ...counts, removedEntries: 1 }).goesOver[4]).toBe('1 removed entry is counted, not shown');
  });

  it('describes storage in megabytes a rider can picture', () => {
    expect(describeMegabytes(0)).toBe('under 0.1 MB');
    expect(describeMegabytes(10 * 1024 * 1024)).toBe('about 10.0 MB');
    expect(describeMegabytes(150 * 1024 * 1024)).toBe('about 150 MB');
  });
});

describe('the pending link', () => {
  const now = new Date('2026-10-18T12:00:00Z');

  it('counts whole days left, rounded up, and reads expired at zero', () => {
    expect(daysUntil('2026-11-01T12:00:00Z', now)).toBe(14);
    expect(daysUntil('2026-10-19T06:00:00Z', now)).toBe(1);
    expect(daysUntil('2026-10-18T11:59:00Z', now)).toBe(0);
    expect(daysUntil('not a date', now)).toBe(0);
  });

  it('describes a pending link by its days left and an expired one as needing a new link', () => {
    expect(describeHandoverState({ status: 'pending', expires_at: '2026-11-01T12:00:00Z' }, now)).toEqual({
      kind: 'pending',
      daysLeft: 14,
      text: 'Handover pending - link expires in 14 days',
    });
    expect(describeHandoverState({ status: 'pending', expires_at: '2026-10-19T06:00:00Z' }, now)?.text).toBe('Handover pending - link expires in 1 day');
    expect(describeHandoverState({ status: 'pending', expires_at: '2026-10-10T00:00:00Z' }, now)).toEqual({ kind: 'expired', text: 'Link expired - send a new one' });
    expect(describeHandoverState({ status: 'accepted', expires_at: '2026-11-01T12:00:00Z' }, now)).toBeNull();
    expect(describeHandoverState({ status: 'cancelled', expires_at: '2026-11-01T12:00:00Z' }, now)).toBeNull();
  });
});

describe('the form\'s inputs', () => {
  it('prefills the reading from the book\'s current usage, as the usage panel rounds it', () => {
    const view = buildServiceBookView(demo.data, clock);
    const defaults = handoverReadingDefaults(view);
    const hours = view.usage.hours?.current ?? null;
    const distance = view.usage.distance?.current ?? null;
    expect(view.usage.hours?.basis).toMatch(/^reading/);
    expect(defaults.hours).toBe(hours === null ? '' : String(Math.round(hours * 10) / 10));
    expect(defaults.distance).toBe(distance === null ? '' : String(Math.round(distance)));
    expect(defaults.hours).not.toBe('');
  });

  it('leaves an axis blank when the book only estimates it from sessions', () => {
    const noReadings = { ...demo.data, readings: [] };
    const view = buildServiceBookView(noReadings, clock);
    expect(view.usage.hours?.basis).toBe('estimate_only');
    expect(handoverReadingDefaults(view)).toEqual({ hours: '', distance: '' });
  });

  it('folds the buyer\'s email the way the database stores it and asks only for an address shape', () => {
    expect(normalizeHandoverEmail('  Buyer@Example.COM ')).toBe('buyer@example.com');
    expect(isHandoverEmailShape('buyer@example.com')).toBe(true);
    expect(isHandoverEmailShape('buyer')).toBe(false);
    expect(isHandoverEmailShape('two words@example.com')).toBe(false);
  });

  it('words the sold banner with and without the day', () => {
    expect(describeSoldBook('3 Oct 2026')).toBe('Handed over on 3 Oct 2026. This is your copy of the history up to then, and it no longer changes.');
    expect(describeSoldBook(null)).toBe('Handed over. This is your copy of the history up to then, and it no longer changes.');
  });
});
