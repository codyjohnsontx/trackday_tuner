import { describe, expect, it } from 'vitest';
import { getFreePlanLimitMessage } from '@/lib/plans';
import {
  describeAcceptRefusal,
  describeHandoverSummary,
  isHandoverTokenShape,
  readHandoverDescription,
  readHandoverSummary,
  resolveHandoverPage,
  type HandoverSummary,
} from '@/lib/service-book/handover-view';

const summary: HandoverSummary = {
  entries: 12,
  removed_entries: 1,
  items: 6,
  readings: 3,
  attachments: 25,
  attachment_bytes: 13 * 1024 * 1024,
  sessions: 30,
  laps: 240,
  session_photos: 4,
  outcomes: 9,
  weights: 2,
  overrides: 1,
};

describe('which page a viewer of a handover link gets', () => {
  it('offers sign-in to nobody, and shows nothing of the bike', () => {
    expect(resolveHandoverPage({ status: 'pending', viewer: 'signed_out' }, false)).toEqual({ kind: 'sign_in' });
  });

  it('answers one way for a link that is not pending any more, whoever asks', () => {
    for (const status of ['expired', 'cancelled'] as const) {
      for (const viewer of ['seller', 'recipient', 'other'] as const) {
        expect(resolveHandoverPage({ status, viewer }, false)).toEqual({ kind: 'invalid' });
      }
    }
    expect(resolveHandoverPage({ status: 'not_found' }, false)).toEqual({ kind: 'invalid' });
    expect(resolveHandoverPage({ status: 'accepted', viewer: 'other' }, false)).toEqual({ kind: 'invalid' });
    expect(resolveHandoverPage({ status: 'accepted', viewer: 'seller' }, false)).toEqual({ kind: 'invalid' });
  });

  it('tells the wrong account so, and the seller that the link is for the buyer', () => {
    expect(resolveHandoverPage({ status: 'pending', viewer: 'other' }, false)).toEqual({ kind: 'wrong_account' });
    expect(resolveHandoverPage({ status: 'pending', viewer: 'seller' }, false)).toEqual({ kind: 'own_link' });
  });

  it('sends the rider who accepted to their new bike', () => {
    expect(resolveHandoverPage({ status: 'accepted', viewer: 'recipient', vehicle_id: 'v-1' }, false)).toEqual({ kind: 'accepted', vehicleId: 'v-1' });
  });

  it('offers the recipient the bike, and carries whether their garage is full', () => {
    const description = { status: 'pending', viewer: 'recipient', bike: null, summary, expires_at: '2026-11-01T00:00:00Z' } as const;
    expect(resolveHandoverPage(description, false)).toMatchObject({ kind: 'offer', atVehicleLimit: false, expiresAt: '2026-11-01T00:00:00Z' });
    expect(resolveHandoverPage(description, true)).toMatchObject({ kind: 'offer', atVehicleLimit: true });
  });
});

describe('reading what describe_service_book_transfer answered', () => {
  it('reads the recipient offer with its bike and counts', () => {
    const read = readHandoverDescription({
      status: 'pending',
      viewer: 'recipient',
      bike: { nickname: 'R6', type: 'motorcycle', year: 2019, make: 'Yamaha', model: 'YZF-R6', photo_url: null },
      summary: { entries: 2, sessions: 3 },
      expires_at: '2026-11-01T00:00:00Z',
    });
    expect(read).toEqual({
      status: 'pending',
      viewer: 'recipient',
      bike: { nickname: 'R6', type: 'motorcycle', year: 2019, make: 'Yamaha', model: 'YZF-R6', photo_url: null },
      summary: { ...readHandoverSummary({}), entries: 2, sessions: 3 },
      expires_at: '2026-11-01T00:00:00Z',
    });
  });

  it('treats anything it does not recognise as not found', () => {
    expect(readHandoverDescription(null)).toEqual({ status: 'not_found' });
    expect(readHandoverDescription({ status: 'weird', viewer: 'recipient' })).toEqual({ status: 'not_found' });
    expect(readHandoverDescription({ status: 'pending', viewer: 'robot' })).toEqual({ status: 'not_found' });
    expect(readHandoverDescription({ status: 'pending', viewer: 'recipient' })).toEqual({ status: 'pending', viewer: 'recipient' });
  });

  it('reads every count as a non-negative whole number', () => {
    expect(readHandoverSummary({ entries: -3, sessions: 2.7, laps: 'many', attachment_bytes: null })).toMatchObject({ entries: 0, sessions: 2, laps: 0, attachment_bytes: 0 });
  });
});

describe('what comes with the bike', () => {
  it('says it in one line per kind, nothing for a kind the bike has none of', () => {
    expect(describeHandoverSummary(summary)).toEqual([
      'The service book: 12 service entries, 6 items with intervals, 3 readings, 25 receipts and photos (about 13 MB).',
      '1 entry removed by an owner: counted, not shown.',
      'Track sessions on this bike: 30 track sessions, 240 lap times, 4 photos, 9 outcome notes.',
      "The owner's word on the schedule: 2 sessions the owner weighted and 1 snooze or adjustment.",
    ]);
    expect(describeHandoverSummary(readHandoverSummary({ entries: 1, sessions: 1 }))).toEqual([
      'The service book: 1 service entry.',
      'Track sessions on this bike: 1 track session.',
    ]);
  });

  it('sizes the receipts honestly at the small end', () => {
    expect(describeHandoverSummary({ ...summary, attachments: 1, attachment_bytes: 20_000 })[0]).toContain('1 receipt or photo (under 0.1 MB)');
    expect(describeHandoverSummary({ ...summary, attachments: 2, attachment_bytes: 1.5 * 1024 * 1024 })[0]).toContain('(about 1.5 MB)');
  });
});

describe('a refused accept', () => {
  it('is worded by the code the database answered', () => {
    expect(describeAcceptRefusal('TT404')).toBe('This handover link is not valid any more.');
    expect(describeAcceptRefusal('TT403')).toContain('different email address');
    expect(describeAcceptRefusal('TT402')).toBe(getFreePlanLimitMessage('vehicles'));
    expect(describeAcceptRefusal('TT410')).toBe('This bike was handed over already.');
    expect(describeAcceptRefusal('TT409')).toBe('The handover could not be completed. Try again.');
    expect(describeAcceptRefusal(undefined)).toBe('The handover could not be completed. Try again.');
  });
});

describe('the token in the link', () => {
  it('is looked up only in the shape the link carries', () => {
    expect(isHandoverTokenShape('a'.repeat(43))).toBe(true);
    expect(isHandoverTokenShape('short')).toBe(false);
    expect(isHandoverTokenShape('has space '.repeat(5))).toBe(false);
    expect(isHandoverTokenShape(null)).toBe(false);
  });
});
