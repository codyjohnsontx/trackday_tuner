import { describe, expect, it } from 'vitest';
import { buildServiceBookView, type ServiceBookData, type ServiceEntryRecord } from '@/lib/service-book/book-data';

const BOOK_ID = '00000000-0000-4000-8000-0000000000b0';
const ENTRY_ID = '00000000-0000-4000-8000-000000000001';
const OWNER_ID = '00000000-0000-4000-8000-0000000000aa';

// 01:30 UTC on the 21st: still the evening of the 20th in Chicago, the 21st in London.
const ENTRY: ServiceEntryRecord = {
  id: ENTRY_ID,
  book_id: BOOK_ID,
  service_date: '2026-09-20',
  reading_hours: null,
  reading_distance: null,
  performed_by: 'self',
  shop_name: null,
  cost_cents: null,
  currency: 'USD',
  notes: null,
  custom_fields: {},
  origin: 'typed',
  logged_at: '2026-09-21T01:30:00Z',
  logged_by: OWNER_ID,
  revision: 1,
  deleted_at: null,
  copied_from_entry_id: null,
  created_at: '2026-09-21T01:30:00Z',
  updated_at: '2026-09-21T01:30:00Z',
  items: [],
  parts: [],
  revisions: [{ revision: 1, kind: 'created', changed_at: '2026-09-21T01:30:00Z' }],
  attachments: [],
};

function data(ownerTimeZone: string | null): ServiceBookData {
  return {
    vehicle: { id: '00000000-0000-4000-8000-0000000000v0', nickname: 'R6', type: 'motorcycle' },
    book: {
      id: BOOK_ID,
      vehicle_id: '00000000-0000-4000-8000-0000000000v0',
      tracks_hours: true,
      tracks_distance: false,
      distance_unit: 'mi',
      default_session_minutes: 20,
      default_session_distance: null,
      transferred_from_book_id: null,
      transferred_at: null,
      transferred_removed_entry_count: 0,
      owner_time_zone: ownerTimeZone,
      created_at: '2026-09-01T00:00:00Z',
      updated_at: '2026-09-01T00:00:00Z',
    },
    fields: [],
    items: [],
    entries: [ENTRY],
    readings: [],
    sessions: [],
    laps: [],
    weights: [],
    overrides: [],
    attachmentCount: 0,
    removedEntryCount: 0,
  };
}

function labels(ownerTimeZone: string | null, browserTimeZone: string): string[] {
  const view = buildServiceBookView(data(ownerTimeZone), { today: '2026-10-01', timeZone: browserTimeZone });
  return view.provenanceByEntryId.get(ENTRY_ID)!.labels.map((label) => label.text);
}

describe("the owner's book screen labels", () => {
  it('read in the pinned owner zone, whatever zone the browser opening the book is in', () => {
    expect(labels('America/Chicago', 'America/Chicago')).toEqual(['Logged the day of service', 'Unedited']);
    expect(labels('America/Chicago', 'Europe/London')).toEqual(['Logged the day of service', 'Unedited']);
  });

  it("read in the browser's zone only while no zone this clock knows is pinned", () => {
    expect(labels(null, 'Europe/London')).toEqual(['Logged 1 day after service', 'Unedited']);
    expect(labels('Mars/Olympus_Mons', 'Europe/London')).toEqual(['Logged 1 day after service', 'Unedited']);
    expect(labels(null, 'America/Chicago')).toEqual(['Logged the day of service', 'Unedited']);
  });
});

describe('a book that came with a bike handed over', () => {
  // Handed over at 02:30 UTC on 18 Oct: the evening of the 17th in the book's zone.
  const copiedEntry: ServiceEntryRecord = {
    ...ENTRY,
    id: '00000000-0000-4000-8000-000000000002',
    revision: 2,
    copied_from_entry_id: '00000000-0000-4000-8000-0000000000e2',
    revisions: [
      { revision: 1, kind: 'created', changed_at: '2026-09-21T01:30:00Z' },
      { revision: 2, kind: 'transferred', changed_at: '2026-10-18T02:30:00Z' },
    ],
  };

  function received(): ServiceBookData {
    const base = data('America/Chicago');
    return {
      ...base,
      book: { ...base.book, transferred_from_book_id: '00000000-0000-4000-8000-0000000000b1', transferred_at: '2026-10-18T02:30:00Z', transferred_removed_entry_count: 2 },
      entries: [ENTRY, copiedEntry],
      removedEntryCount: 1,
      sessions: [
        { id: 's1', date: '2026-09-27', created_at: '2026-09-27T00:00:00Z', copied_from_session_id: '00000000-0000-4000-8000-0000000000s1' },
        { id: 's2', date: '2026-10-20', created_at: '2026-10-20T00:00:00Z', copied_from_session_id: null },
      ],
    };
  }

  it('says when it was handed over, in the labels\' zone, what of it is here now, and every owner\'s removals', () => {
    const view = buildServiceBookView(received(), { today: '2026-10-21', timeZone: 'Europe/London' });
    expect(view.handover).toEqual({
      handedOverOn: '17 Oct 2026',
      entries: 1,
      sessions: 1,
      removedEntries: '3 entries removed by an owner',
    });
  });

  it('labels the copied entry as a previous owner\'s, dated the same way', () => {
    const view = buildServiceBookView(received(), { today: '2026-10-21', timeZone: 'Europe/London' });
    expect(view.provenanceByEntryId.get(copiedEntry.id)!.labels.map((label) => label.text)).toEqual([
      'Logged the day of service',
      'Logged by a previous owner, handed over on 17 Oct 2026',
      'Unedited',
    ]);
    expect(view.provenanceByEntryId.get(ENTRY_ID)!.labels.map((label) => label.text)).toEqual(['Logged the day of service', 'Unedited']);
  });

  it('has no banner on a book that was never handed over, and no removed line when nothing was removed', () => {
    expect(buildServiceBookView(data('America/Chicago'), { today: '2026-10-21', timeZone: 'UTC' }).handover).toBeNull();
    const base = received();
    const none = buildServiceBookView({ ...base, book: { ...base.book, transferred_removed_entry_count: 0 }, removedEntryCount: 0 }, { today: '2026-10-21', timeZone: 'UTC' });
    expect(none.handover?.removedEntries).toBeNull();
    const sinceOnly = buildServiceBookView({ ...base, book: { ...base.book, transferred_removed_entry_count: 0 } }, { today: '2026-10-21', timeZone: 'UTC' });
    expect(sinceOnly.handover?.removedEntries).toBe('1 entry removed by an owner');
  });
});
