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
