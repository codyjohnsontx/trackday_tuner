import { describe, expect, it } from 'vitest';
import type { ServiceEntryRecord } from '@/lib/service-book/book-data';
import { buildSharedBookView, describeRemovedEntries, type SharedBookInput } from '@/lib/service-book/shared-view';

const BOOK_ID = '00000000-0000-4000-8000-0000000000b0';
const ITEM_ID = '00000000-0000-4000-8000-0000000000c0';
const OWNER_ID = '00000000-0000-4000-8000-0000000000aa';

function entry(id: string, extra: Partial<ServiceEntryRecord> = {}): ServiceEntryRecord {
  return {
    id,
    book_id: BOOK_ID,
    service_date: '2026-09-20',
    reading_hours: 41.5,
    reading_distance: null,
    performed_by: 'self',
    shop_name: null,
    cost_cents: 4500,
    currency: 'USD',
    notes: 'Motul 300V',
    custom_fields: {},
    origin: 'typed',
    // 01:30 UTC on the 21st: still the evening of the 20th in Chicago.
    logged_at: '2026-09-21T01:30:00Z',
    logged_by: OWNER_ID,
    revision: 1,
    deleted_at: null,
    copied_from_entry_id: null,
    created_at: '2026-09-21T01:30:00Z',
    updated_at: '2026-09-21T01:30:00Z',
    items: [{ id: `${id}-item`, entry_id: id, item_id: ITEM_ID, label: 'Engine oil and filter', created_at: '2026-09-21T01:30:00Z' }],
    parts: [],
    revisions: [{ revision: 1, kind: 'created', changed_at: '2026-09-21T01:30:00Z' }],
    attachments: [],
    ...extra,
  };
}

function input(extra: Partial<SharedBookInput> = {}): SharedBookInput {
  return {
    vehicle: { nickname: 'R6', type: 'motorcycle', year: 2019, make: 'Yamaha', model: 'YZF-R6' },
    book: { distance_unit: 'mi', owner_time_zone: 'America/Chicago', transferred_removed_entry_count: 0 },
    fields: [],
    items: [
      {
        id: ITEM_ID,
        book_id: BOOK_ID,
        name: 'Engine oil and filter',
        interval_hours: 15,
        interval_distance: null,
        interval_days: null,
        source: 'starter',
        source_attachment_id: null,
        sort_order: 0,
        archived_at: null,
        created_at: '2026-09-01T00:00:00Z',
        updated_at: '2026-09-01T00:00:00Z',
      },
    ],
    entries: [entry('00000000-0000-4000-8000-000000000001')],
    readings: [],
    ...extra,
  };
}

describe('a shared service book', () => {
  it('labels an entry in the owner zone, whatever zone builds the view', () => {
    const view = buildSharedBookView(input());
    expect(view.labelled).toBe(true);
    expect(view.entries[0].labels).toEqual(['Logged the day of service', 'Unedited']);

    // The same entry in another owner's zone reads differently, which is why the
    // zone has to be the owner's and never the viewer's.
    const elsewhere = buildSharedBookView(input({ book: { distance_unit: 'mi', owner_time_zone: 'UTC', transferred_removed_entry_count: 0 } }));
    expect(elsewhere.entries[0].labels).toEqual(['Logged 1 day after service', 'Unedited']);
  });

  it('carries no labels when the owner zone is missing or unknown, rather than guessing one', () => {
    for (const owner_time_zone of [null, 'Mars/Olympus_Mons']) {
      const view = buildSharedBookView(input({ book: { distance_unit: 'mi', owner_time_zone, transferred_removed_entry_count: 0 } }));
      expect(view.labelled).toBe(false);
      expect(view.entries[0].labels).toEqual([]);
    }
  });

  it('counts a removed entry and shows none of it', () => {
    const removed = entry('00000000-0000-4000-8000-000000000002', {
      deleted_at: '2026-09-25T00:00:00Z',
      notes: 'removed note text',
      items: [{ id: 'x', entry_id: 'x', item_id: null, label: 'Removed work', created_at: '2026-09-25T00:00:00Z' }],
    });
    const view = buildSharedBookView(input({ entries: [entry('00000000-0000-4000-8000-000000000001'), removed] }));
    expect(view.entries).toHaveLength(1);
    expect(view.removedCount).toBe(1);
    expect(JSON.stringify(view)).not.toContain('removed note text');
    expect(JSON.stringify(view)).not.toContain('Removed work');
    expect(describeRemovedEntries(view.removedCount)).toBe('1 entry removed by an owner');
    expect(describeRemovedEntries(3)).toBe('3 entries removed by an owner');
    expect(describeRemovedEntries(0)).toBeNull();
  });

  it('counts the removals a book came with from earlier owners, and its own on top', () => {
    const book = { distance_unit: 'mi' as const, owner_time_zone: 'America/Chicago', transferred_removed_entry_count: 3 };
    const inherited = buildSharedBookView(input({ book }));
    expect(inherited.entries).toHaveLength(1);
    expect(inherited.removedCount).toBe(3);

    const removed = entry('00000000-0000-4000-8000-000000000002', { deleted_at: '2026-09-25T00:00:00Z' });
    expect(buildSharedBookView(input({ book, entries: [entry('00000000-0000-4000-8000-000000000001'), removed] })).removedCount).toBe(4);
  });

  it('prints no id of the owner', () => {
    expect(JSON.stringify(buildSharedBookView(input()))).not.toContain(OWNER_ID);
  });

  it('names the work, its details and when each item was last done', () => {
    const view = buildSharedBookView(input());
    expect(view.title).toBe('R6');
    expect(view.subtitle).toBe('2019 Yamaha YZF-R6');
    expect(view.entries[0].title).toBe('Engine oil and filter');
    expect(view.entries[0].details).toEqual([
      { label: 'Hours', value: '41.5 h' },
      { label: 'Done by', value: 'The owner' },
      { label: 'Cost', value: '$45.00' },
    ]);
    expect(view.items).toEqual([{ id: ITEM_ID, name: 'Engine oil and filter', interval: 'every 15 h', lastDone: '20 Sep 2026' }]);
  });
});
