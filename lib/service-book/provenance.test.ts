import { describe, expect, it } from 'vitest';
import {
  describeEntryProvenance,
  type ProvenanceAttachment,
  type ProvenanceEntry,
  type ProvenanceRevision,
} from '@/lib/service-book/provenance';

function entry(extra: Partial<ProvenanceEntry> = {}): ProvenanceEntry {
  return { service_date: '2026-09-20', logged_at: '2026-09-20T18:00:00Z', revision: 1, origin: 'typed', copied_from_entry_id: null, ...extra };
}

const created: ProvenanceRevision = { revision: 1, kind: 'created', changed_at: '2026-09-20T18:00:00Z' };

function edited(revision: number, changedAt: string): ProvenanceRevision {
  return { revision, kind: 'edited', changed_at: changedAt };
}

function receipt(uploadedAt: string | null, kind: ProvenanceAttachment['kind'] = 'receipt'): ProvenanceAttachment {
  return { kind, uploaded_at: uploadedAt };
}

describe('when the entry was logged', () => {
  it('logged on the service date: Logged the day of service', () => {
    expect(describeEntryProvenance({ transferredAt: null, timeZone: 'UTC', entry: entry(), revisions: [created] }).timing).toEqual({
      kind: 'logged_same_day',
      text: 'Logged the day of service',
    });
  });

  it('judges the day in the rider zone, not UTC', () => {
    // 01:30 UTC on the 21st is still the evening of the 20th in Texas.
    const late = entry({ logged_at: '2026-09-21T01:30:00Z' });
    expect(describeEntryProvenance({ transferredAt: null, entry: late, revisions: [created], timeZone: 'America/Chicago' }).timing.kind).toBe(
      'logged_same_day',
    );
    expect(describeEntryProvenance({ transferredAt: null, timeZone: 'UTC', entry: late, revisions: [created] }).timing.kind).toBe('logged_after');
  });

  it('within 7 days: Logged N days after service', () => {
    expect(describeEntryProvenance({ transferredAt: null, timeZone: 'UTC', entry: entry({ logged_at: '2026-09-21T09:00:00Z' }), revisions: [created] }).timing).toEqual({
      kind: 'logged_after',
      days: 1,
      text: 'Logged 1 day after service',
    });
    expect(
      describeEntryProvenance({ transferredAt: null, timeZone: 'UTC', entry: entry({ logged_at: '2026-09-27T09:00:00Z' }), revisions: [created] }).timing.text,
    ).toBe('Logged 7 days after service');
  });

  it('later than that: Back-filled N days later', () => {
    expect(describeEntryProvenance({ transferredAt: null, timeZone: 'UTC', entry: entry({ logged_at: '2026-09-28T09:00:00Z' }), revisions: [created] }).timing).toEqual({
      kind: 'back_filled',
      days: 8,
      months: 0,
      text: 'Back-filled 8 days later',
    });
  });

  it('two months or more later: Back-filled N months later', () => {
    const old = entry({ service_date: '2025-03-14', logged_at: '2026-09-20T09:00:00Z' });
    expect(describeEntryProvenance({ transferredAt: null, timeZone: 'UTC', entry: old, revisions: [created] }).timing).toMatchObject({
      kind: 'back_filled',
      months: 18,
      text: 'Back-filled 18 months later',
    });
  });

  it('before the service date it names that too, rather than calling it same-day', () => {
    const ahead = entry({ service_date: '2026-09-25' });
    expect(describeEntryProvenance({ transferredAt: null, timeZone: 'UTC', entry: ahead, revisions: [created] }).timing).toEqual({
      kind: 'logged_before',
      days: 5,
      text: 'Logged 5 days before the service date',
    });
  });
});

describe("the owner's time zone", () => {
  // Logged 20:00 CDT on the service day: a UTC fallback would call it a day late.
  const evening = entry({ logged_at: '2026-09-21T01:00:00Z' });

  it.each([
    ['an empty zone', ''],
    ['no zone', undefined],
    ['a zone Intl does not accept', 'Not/AZone'],
  ])('refuses %s rather than labelling in UTC', (_name, timeZone) => {
    expect(() =>
      describeEntryProvenance({ transferredAt: null, entry: evening, revisions: [created], timeZone: timeZone as string }),
    ).toThrow(/time zone/);
  });
});

describe('receipts', () => {
  it('uploaded within 24 h of logging: Receipt attached when logged', () => {
    const result = describeEntryProvenance({
      transferredAt: null,
      timeZone: 'UTC',
      entry: entry(),
      revisions: [created],
      attachments: [receipt('2026-09-21T17:00:00Z')],
    });
    expect(result.receipt).toEqual({ kind: 'receipt_when_logged', text: 'Receipt attached when logged' });
  });

  it('an invoice counts as a receipt', () => {
    const result = describeEntryProvenance({
      transferredAt: null,
      timeZone: 'UTC',
      entry: entry(),
      revisions: [created],
      attachments: [receipt('2026-09-20T18:05:00Z', 'invoice')],
    });
    expect(result.receipt?.kind).toBe('receipt_when_logged');
  });

  it('first uploaded later: Receipt added N days later', () => {
    const result = describeEntryProvenance({
      transferredAt: null,
      timeZone: 'UTC',
      entry: entry(),
      revisions: [created],
      attachments: [receipt('2026-09-25T10:00:00Z'), receipt('2026-10-02T10:00:00Z')],
    });
    expect(result.receipt).toEqual({ kind: 'receipt_added_later', days: 5, text: 'Receipt added 5 days later' });
  });

  it('says nothing without one: a photo, a manual page or a pending upload is not a receipt', () => {
    const result = describeEntryProvenance({
      transferredAt: null,
      timeZone: 'UTC',
      entry: entry(),
      revisions: [created],
      attachments: [receipt('2026-09-20T18:05:00Z', 'photo'), receipt('2026-09-20T18:05:00Z', 'manual_page'), receipt(null)],
    });
    expect(result.receipt).toBeNull();
  });
});

describe('edits', () => {
  it('revision 1: Unedited', () => {
    expect(describeEntryProvenance({ transferredAt: null, timeZone: 'UTC', entry: entry(), revisions: [created] }).edits).toEqual({ kind: 'unedited', text: 'Unedited' });
  });

  it('edited: Edited N times, last on <date>', () => {
    const result = describeEntryProvenance({
      transferredAt: null,
      timeZone: 'UTC',
      entry: entry({ revision: 3 }),
      revisions: [created, edited(2, '2026-09-22T10:00:00Z'), edited(3, '2026-10-04T10:00:00Z')],
    });
    expect(result.edits).toEqual({
      kind: 'edited',
      count: 2,
      beforeHandover: 0,
      sinceHandover: 2,
      lastEditedOn: '2026-10-04',
      text: 'Edited 2 times, last on 4 Oct 2026',
    });
  });

  it('edited once reads as once', () => {
    const result = describeEntryProvenance({ transferredAt: null, timeZone: 'UTC', entry: entry({ revision: 2 }), revisions: [created, edited(2, '2026-09-22T10:00:00Z')] });
    expect(result.edits.text).toBe('Edited once, last on 22 Sep 2026');
  });

  // 20261010000100: a save that changes nothing writes no revision and leaves
  // `revision` alone, though it still moves `updated_at`. Provenance reads only
  // the revisions, so the entry stays unedited.
  it('a save that changed nothing is not an edit', () => {
    const resaved = { ...entry(), updated_at: '2026-10-01T09:00:00Z' };
    expect(describeEntryProvenance({ transferredAt: null, timeZone: 'UTC', entry: resaved, revisions: [created] }).edits.kind).toBe('unedited');
  });

  it('removing and restoring the same content is not an edit', () => {
    const result = describeEntryProvenance({
      transferredAt: null,
      timeZone: 'UTC',
      entry: entry({ revision: 3 }),
      revisions: [
        created,
        { revision: 2, kind: 'deleted', changed_at: '2026-09-22T10:00:00Z' },
        { revision: 3, kind: 'restored', changed_at: '2026-09-23T10:00:00Z' },
      ],
    });
    expect(result.edits.kind).toBe('unedited');
  });

  it('counts a revision the caller did not pass as an edit, so a gap never reads cleaner', () => {
    const result = describeEntryProvenance({ transferredAt: null, timeZone: 'UTC', entry: entry({ revision: 3 }), revisions: [created, edited(2, '2026-09-22T10:00:00Z')] });
    expect(result.edits).toMatchObject({ kind: 'edited', count: 2, lastEditedOn: '2026-09-22' });

    const none = describeEntryProvenance({ transferredAt: null, timeZone: 'UTC', entry: entry({ revision: 2 }), revisions: [] });
    expect(none.edits).toEqual({ kind: 'edited', count: 1, beforeHandover: 0, sinceHandover: 1, lastEditedOn: null, text: 'Edited once' });
  });
});

describe('an entry read from a photographed page', () => {
  it('says so, with the day the owner confirmed it, and is always back-filled', () => {
    const result = describeEntryProvenance({
      transferredAt: null,
      timeZone: 'UTC',
      entry: entry({ origin: 'photo_draft', service_date: '2026-09-18' }),
      revisions: [created],
    });
    expect(result.origin).toEqual({
      kind: 'photo_draft',
      confirmedOn: '2026-09-20',
      text: 'Read from a photographed page, confirmed by the owner on 20 Sep 2026',
    });
    expect(result.timing).toMatchObject({ kind: 'back_filled', days: 2, text: 'Back-filled 2 days later' });
  });

  it('is back-filled even when the page carries the day it was confirmed', () => {
    const result = describeEntryProvenance({ transferredAt: null, timeZone: 'UTC', entry: entry({ origin: 'photo_draft' }), revisions: [created] });
    expect(result.timing).toMatchObject({ kind: 'back_filled', text: 'Back-filled the day of service' });
  });
});

describe('an entry that came with the bike', () => {
  // The seller logged it at revision 1 and edited it twice; the copy is revision
  // 4, of kind `transferred` (20261017000600), on a book handed over at 02:30 UTC
  // on 18 Oct - still the evening of the 17th in the book's own zone.
  const transferred: ProvenanceRevision = { revision: 4, kind: 'transferred', changed_at: '2026-10-18T02:30:00Z' };
  const copied = entry({ revision: 4, copied_from_entry_id: 'seller-entry' });
  const sellersEdits = [created, edited(2, '2026-09-22T10:00:00Z'), edited(3, '2026-10-04T10:00:00Z')];

  it('says a previous owner logged it, dated the handover in the book zone', () => {
    const chicago = describeEntryProvenance({
      transferredAt: '2026-10-18T02:30:00Z',
      timeZone: 'America/Chicago',
      entry: copied,
      revisions: [...sellersEdits, transferred],
    });
    expect(chicago.handover).toEqual({
      kind: 'previous_owner',
      handedOverOn: '2026-10-17',
      text: 'Logged by a previous owner, handed over on 17 Oct 2026',
    });
    const utc = describeEntryProvenance({
      transferredAt: '2026-10-18T02:30:00Z',
      timeZone: 'UTC',
      entry: copied,
      revisions: [...sellersEdits, transferred],
    });
    expect(utc.handover?.handedOverOn).toBe('2026-10-18');
  });

  it('names no owner on an entry the book owner logged themselves', () => {
    const own = describeEntryProvenance({ transferredAt: '2026-10-18T02:30:00Z', timeZone: 'UTC', entry: entry(), revisions: [created] });
    expect(own.handover).toBeNull();
    expect(own.labels.map((label) => label.kind)).not.toContain('previous_owner');
  });

  it('still says a previous owner logged it when the book carries no handover date', () => {
    const undated = describeEntryProvenance({ transferredAt: null, timeZone: 'UTC', entry: copied, revisions: [...sellersEdits, transferred] });
    expect(undated.handover).toEqual({ kind: 'previous_owner', handedOverOn: null, text: 'Logged by a previous owner' });
  });

  it("counts the seller's edits as a previous owner's, below the transferred revision", () => {
    const result = describeEntryProvenance({ transferredAt: '2026-10-18T02:30:00Z', timeZone: 'UTC', entry: copied, revisions: [...sellersEdits, transferred] });
    expect(result.edits).toEqual({
      kind: 'edited',
      count: 2,
      beforeHandover: 2,
      sinceHandover: 0,
      lastEditedOn: '2026-10-04',
      text: 'Edited 2 times by a previous owner, last on 4 Oct 2026',
    });
  });

  it('the copy itself is not an edit', () => {
    const untouched = entry({ revision: 2, copied_from_entry_id: 'seller-entry' });
    const result = describeEntryProvenance({
      transferredAt: '2026-10-18T02:30:00Z',
      timeZone: 'UTC',
      entry: untouched,
      revisions: [created, { revision: 2, kind: 'transferred', changed_at: '2026-10-18T02:30:00Z' }],
    });
    expect(result.edits).toEqual({ kind: 'unedited', text: 'Unedited' });
  });

  it('counts an edit above the transferred revision as made since handover', () => {
    const since = describeEntryProvenance({
      transferredAt: '2026-10-18T02:30:00Z',
      timeZone: 'UTC',
      entry: entry({ revision: 5, copied_from_entry_id: 'seller-entry' }),
      revisions: [...sellersEdits, transferred, edited(5, '2026-10-20T10:00:00Z')],
    });
    expect(since.edits).toMatchObject({
      beforeHandover: 2,
      sinceHandover: 1,
      text: 'Edited 2 times by a previous owner and once since handover, last on 20 Oct 2026',
    });

    const onlySince = describeEntryProvenance({
      transferredAt: '2026-10-18T02:30:00Z',
      timeZone: 'UTC',
      entry: entry({ revision: 3, copied_from_entry_id: 'seller-entry' }),
      revisions: [created, { revision: 2, kind: 'transferred', changed_at: '2026-10-18T02:30:00Z' }, edited(3, '2026-10-20T10:00:00Z')],
    });
    expect(onlySince.edits).toMatchObject({ beforeHandover: 0, sinceHandover: 1, text: 'Edited once since handover, last on 20 Oct 2026' });
  });

  it('a gap counts on the side of the boundary it falls, so neither side reads cleaner', () => {
    // Revisions 2 and 5 were not passed: one below the handover, one above.
    const gaps = describeEntryProvenance({
      transferredAt: '2026-10-18T02:30:00Z',
      timeZone: 'UTC',
      entry: entry({ revision: 5, copied_from_entry_id: 'seller-entry' }),
      revisions: [created, edited(3, '2026-10-04T10:00:00Z'), transferred],
    });
    expect(gaps.edits).toMatchObject({ beforeHandover: 2, sinceHandover: 1, count: 3 });
  });

  it('on a bike handed over twice, the last handover is the boundary', () => {
    // Owner A logged and edited it; B received it (revision 3, transferred) and
    // could not edit it; C received it from B (revision 4, transferred).
    const twice = describeEntryProvenance({
      transferredAt: '2026-10-18T02:30:00Z',
      timeZone: 'UTC',
      entry: entry({ revision: 4, copied_from_entry_id: 'b-entry' }),
      revisions: [
        created,
        edited(2, '2026-09-22T10:00:00Z'),
        { revision: 3, kind: 'transferred', changed_at: '2026-10-01T00:00:00Z' },
        { revision: 4, kind: 'transferred', changed_at: '2026-10-18T02:30:00Z' },
      ],
    });
    expect(twice.edits).toMatchObject({ beforeHandover: 1, sinceHandover: 0, text: 'Edited once by a previous owner, last on 22 Sep 2026' });
    expect(twice.handover?.text).toBe('Logged by a previous owner, handed over on 18 Oct 2026');
  });

  it('keeps the timing and receipt labels the seller had, read in the book zone', () => {
    const result = describeEntryProvenance({
      transferredAt: '2026-10-18T02:30:00Z',
      timeZone: 'America/Chicago',
      entry: entry({ revision: 2, copied_from_entry_id: 'seller-entry', logged_at: '2026-09-21T01:30:00Z' }),
      revisions: [created, { revision: 2, kind: 'transferred', changed_at: '2026-10-18T02:30:00Z' }],
      attachments: [receipt('2026-09-21T01:40:00Z')],
    });
    expect(result.labels.map((label) => label.text)).toEqual([
      'Logged the day of service',
      'Logged by a previous owner, handed over on 17 Oct 2026',
      'Receipt attached when logged',
      'Unedited',
    ]);
  });
});

it('lists the labels in reading order: when, where from, handover, receipt, edits', () => {
  const result = describeEntryProvenance({
      transferredAt: null,
    timeZone: 'UTC',
    entry: entry({ origin: 'photo_draft', revision: 2 }),
    revisions: [created, edited(2, '2026-09-22T10:00:00Z')],
    attachments: [receipt('2026-09-20T18:01:00Z')],
  });
  expect(result.labels.map((label) => label.kind)).toEqual(['back_filled', 'photo_draft', 'receipt_when_logged', 'edited']);

  const copied = describeEntryProvenance({
    transferredAt: '2026-10-18T02:30:00Z',
    timeZone: 'UTC',
    entry: entry({ origin: 'photo_draft', revision: 3, copied_from_entry_id: 'seller-entry' }),
    revisions: [created, edited(2, '2026-09-22T10:00:00Z'), { revision: 3, kind: 'transferred', changed_at: '2026-10-18T02:30:00Z' }],
    attachments: [receipt('2026-09-20T18:01:00Z')],
  });
  expect(copied.labels.map((label) => label.kind)).toEqual(['back_filled', 'photo_draft', 'previous_owner', 'receipt_when_logged', 'edited']);
});
