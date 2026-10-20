import { describe, expect, it } from 'vitest';
import { countTowardAllowance } from '@/lib/service-book/attachments';
import { buildServiceBookView, type ServiceBookData, type ServiceEntryRecord } from '@/lib/service-book/book-data';
import { buildSharedBookView } from '@/lib/service-book/shared-view';

/**
 * A copied row's `copied_from_*` pointer names the previous owner's row, and
 * nothing on the buyer's side follows it (owner, PQ2): a screen reads it as
 * "came with the bike", a cap as "skip this one". So what the screens and the
 * caps print must not depend on WHICH row a pointer names - pointing every one
 * at a different id changes nothing - while whether there is a pointer at all
 * does. That the buyer cannot read the named row either is proven against a
 * real database, as two riders, in tests/db/service-book-transfer.spec.ts.
 */

const BUYER_ID = '00000000-0000-4000-8000-0000000000aa';
const BOOK_ID = '00000000-0000-4000-8000-0000000000b0';

function entry(id: string, copiedFrom: string | null): ServiceEntryRecord {
  return {
    id,
    book_id: BOOK_ID,
    service_date: '2026-09-20',
    reading_hours: 40,
    reading_distance: null,
    performed_by: 'self',
    shop_name: null,
    cost_cents: null,
    currency: 'USD',
    notes: 'Oil and filter.',
    custom_fields: {},
    origin: 'typed',
    logged_at: '2026-09-21T01:30:00Z',
    logged_by: copiedFrom ? '00000000-0000-4000-8000-0000000000ee' : BUYER_ID,
    revision: copiedFrom ? 2 : 1,
    deleted_at: null,
    copied_from_entry_id: copiedFrom,
    created_at: '2026-09-21T01:30:00Z',
    updated_at: '2026-09-21T01:30:00Z',
    items: [],
    parts: [],
    revisions: copiedFrom
      ? [
          { revision: 1, kind: 'created', changed_at: '2026-09-21T01:30:00Z' },
          { revision: 2, kind: 'transferred', changed_at: '2026-10-18T02:30:00Z' },
        ]
      : [{ revision: 1, kind: 'created', changed_at: '2026-09-21T01:30:00Z' }],
    attachments: [],
  };
}

/** A received book whose copied rows point at the ids `point` hands out. */
function receivedBook(point: (row: string) => string | null): ServiceBookData {
  return {
    vehicle: { id: '00000000-0000-4000-8000-0000000000c0', nickname: 'R6', type: 'motorcycle' },
    book: {
      id: BOOK_ID,
      vehicle_id: '00000000-0000-4000-8000-0000000000c0',
      tracks_hours: true,
      tracks_distance: false,
      distance_unit: 'mi',
      default_session_minutes: 20,
      default_session_distance: null,
      transferred_from_book_id: point('book'),
      transferred_at: '2026-10-18T02:30:00Z',
      transferred_removed_entry_count: 1,
      owner_time_zone: 'America/Chicago',
      created_at: '2026-10-18T02:30:00Z',
      updated_at: '2026-10-18T02:30:00Z',
    },
    fields: [],
    items: [],
    entries: [entry('00000000-0000-4000-8000-000000000001', point('entry')), entry('00000000-0000-4000-8000-000000000002', null)],
    readings: [],
    sessions: [
      { id: 's1', date: '2026-09-27', created_at: '2026-09-27T00:00:00Z', copied_from_session_id: point('session') },
      { id: 's2', date: '2026-10-20', created_at: '2026-10-20T00:00:00Z', copied_from_session_id: null },
    ],
    laps: [],
    weights: [],
    overrides: [],
    attachmentCount: 0,
    removedEntryCount: 0,
  };
}

function attachments(point: (row: string) => string | null) {
  return [
    { status: 'ready' as const, created_at: '2026-09-21T01:30:00Z', copied_from_attachment_id: point('attachment'), created_by: '00000000-0000-4000-8000-0000000000ee' },
    { status: 'ready' as const, created_at: '2026-10-20T00:00:00Z', copied_from_attachment_id: null, created_by: BUYER_ID },
  ];
}

/** Everything a screen or a cap prints for the book, as plain data. */
function whatIsPrinted(data: ServiceBookData, attachmentRows: ReturnType<typeof attachments>) {
  const view = buildServiceBookView(data, { today: '2026-10-21', timeZone: 'America/Chicago' });
  return {
    handover: view.handover,
    labels: [...view.provenanceByEntryId.entries()],
    usage: view.usage,
    shared: buildSharedBookView({ ...data, vehicle: { ...data.vehicle, year: null, make: null, model: null } }),
    allowance: countTowardAllowance(attachmentRows, BUYER_ID, new Date('2026-10-21T00:00:00Z')),
  };
}

const sellersIds = (row: string) => `00000000-0000-4000-8000-00000000${row === 'book' ? '0f01' : row === 'entry' ? '0f02' : row === 'session' ? '0f03' : '0f04'}`;
const otherIds = (row: string) => sellersIds(row).replace('00000000-0000', '22222222-2222');

describe('copied_from_* pointers are read as flags, never followed', () => {
  it('prints the same book, labels, shared view and allowance whichever row a pointer names', () => {
    expect(whatIsPrinted(receivedBook(otherIds), attachments(otherIds))).toEqual(
      whatIsPrinted(receivedBook(sellersIds), attachments(sellersIds)),
    );
  });

  it('prints something different once there is no pointer, so the flag is what is read', () => {
    const none = () => null;
    const withPointers = whatIsPrinted(receivedBook(sellersIds), attachments(sellersIds));
    const without = whatIsPrinted({ ...receivedBook(none), book: { ...receivedBook(none).book, transferred_at: null } }, attachments(none));
    expect(withPointers.handover).toMatchObject({ entries: 1, sessions: 1 });
    expect(without.handover).toBeNull();
    expect(withPointers.allowance).toBe(1);
    expect(without.allowance).toBe(2);
    expect(withPointers.labels).not.toEqual(without.labels);
  });
});
