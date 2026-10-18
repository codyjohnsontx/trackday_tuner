import { describe, expect, it, vi } from 'vitest';
import {
  copyHandoverObjects,
  HANDOVER_ACCEPT_ATTEMPTS,
  HANDOVER_COPY_BATCH,
  objectCopiesOf,
  photoUrlsOf,
  readAcceptedHandover,
  readPreparedHandover,
  takeOverServiceBook,
  type HandoverStorage,
  type PreparedHandover,
} from '@/lib/service-book-transfer-accept';

/**
 * The orchestration between the two database functions, proven on fakes: what
 * is copied where, that a copy already there counts as done, that a TT409
 * from accept runs the three steps again and nothing else does, and that a
 * handover that will not complete takes its public-bucket copies back. The
 * functions themselves are proven in tests/db/service-book-transfer.spec.ts
 * and the walk in tests/e2e/service-book-handover.spec.ts.
 */

const TOKEN = 'a'.repeat(43);

function prepared(partial: Partial<PreparedHandover> = {}): PreparedHandover {
  return {
    accepted: false,
    vehicle_id: 'new-vehicle',
    book_id: 'new-book',
    attachments: [
      { attachment_id: 'a1', from_object: 'old-book/a1.jpg', to_object: 'new-book/n1.jpg', from_thumb: 'old-book/a1.thumb.jpg', to_thumb: 'new-book/n1.thumb.jpg' },
      { attachment_id: 'a2', from_object: 'old-book/a2.pdf', to_object: 'new-book/n2.pdf', from_thumb: null, to_thumb: null },
    ],
    session_photos: [{ session_id: 'ns1', from_path: 'seller/s1.jpg', to_path: 'buyer/ns1.jpg' }],
    vehicle_photo: { from_path: 'seller/v.jpg', to_path: 'buyer/nv.jpg' },
    ...partial,
  };
}

interface FakeStorage extends HandoverStorage {
  copied: { bucket: string; from: string; to: string }[];
  removed: { bucket: string; paths: string[] }[];
  /** How many copies were in flight at once, at the most. */
  peak: number;
}

function fakeStorage(answer: (bucket: string, to: string) => { message: string; statusCode?: string } | null = () => null): FakeStorage {
  let inFlight = 0;
  const storage: FakeStorage = {
    copied: [],
    removed: [],
    peak: 0,
    from(bucket: string) {
      return {
        async copy(from: string, to: string) {
          inFlight += 1;
          storage.peak = Math.max(storage.peak, inFlight);
          await new Promise((resolve) => setTimeout(resolve, 1));
          inFlight -= 1;
          storage.copied.push({ bucket, from, to });
          return { error: answer(bucket, to) };
        },
        async remove(paths: string[]) {
          storage.removed.push({ bucket, paths });
          return { error: null };
        },
        getPublicUrl(path: string) {
          return { data: { publicUrl: `https://stack.test/storage/v1/object/public/${bucket}/${path}` } };
        },
      };
    },
  };
  return storage;
}

type RpcAnswer = { data: unknown; error: { code?: string; message: string } | null };

/** A rider client whose two RPCs answer from queues, in call order. */
function fakeRider(prepares: RpcAnswer[], accepts: RpcAnswer[]) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  return {
    calls,
    rpc: vi.fn(async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      const queue = name === 'prepare_service_book_transfer_accept' ? prepares : accepts;
      const next = queue.shift();
      if (!next) throw new Error(`no answer queued for ${name}`);
      return next;
    }),
  } as unknown as Parameters<typeof takeOverServiceBook>[0]['rider'] & { calls: typeof calls };
}

const acceptedResult = { vehicle_id: 'new-vehicle', book_id: 'new-book', entries: 2, sessions: 1, attachments: 2 };

describe('what a prepared handover copies', () => {
  it('names every file and thumbnail, every session photo and the bike photo, in its bucket', () => {
    expect(objectCopiesOf(prepared())).toEqual([
      { bucket: 'service-book', from: 'old-book/a1.jpg', to: 'new-book/n1.jpg' },
      { bucket: 'service-book', from: 'old-book/a1.thumb.jpg', to: 'new-book/n1.thumb.jpg' },
      { bucket: 'service-book', from: 'old-book/a2.pdf', to: 'new-book/n2.pdf' },
      { bucket: 'session-photos', from: 'seller/s1.jpg', to: 'buyer/ns1.jpg' },
      { bucket: 'vehicle-photos', from: 'seller/v.jpg', to: 'buyer/nv.jpg' },
    ]);
  });

  it('tells accept the public URLs of the copies, keyed by the new session id', () => {
    expect(photoUrlsOf(fakeStorage(), prepared())).toEqual({
      vehicle: 'https://stack.test/storage/v1/object/public/vehicle-photos/buyer/nv.jpg',
      sessions: { ns1: 'https://stack.test/storage/v1/object/public/session-photos/buyer/ns1.jpg' },
    });
    expect(photoUrlsOf(fakeStorage(), prepared({ vehicle_photo: null, session_photos: [] }))).toEqual({ vehicle: null, sessions: {} });
  });

  it('reads what prepare answered and refuses a shape it cannot read', () => {
    expect(readPreparedHandover(prepared())).toEqual(prepared());
    expect(readPreparedHandover({ accepted: true, vehicle_id: 'v', book_id: 'b', attachments: [], session_photos: [], vehicle_photo: null })).toMatchObject({ accepted: true });
    expect(readPreparedHandover(null)).toBeNull();
    expect(readPreparedHandover({ accepted: false, vehicle_id: 'v', book_id: 'b', attachments: [{ attachment_id: 'a' }] })).toBeNull();
    expect(readAcceptedHandover(acceptedResult)).toEqual({ vehicleId: 'new-vehicle', bookId: 'new-book', entries: 2, sessions: 1, attachments: 2 });
    expect(readAcceptedHandover({ entries: 2 })).toBeNull();
  });
});

describe('copying the objects', () => {
  it('runs them ten at a time and reports none when every copy lands', async () => {
    const storage = fakeStorage();
    const copies = Array.from({ length: 25 }, (_, index) => ({ bucket: 'service-book' as const, from: `old/${index}`, to: `new/${index}` }));
    expect(await copyHandoverObjects(storage, copies)).toEqual([]);
    expect(storage.copied).toHaveLength(25);
    expect(storage.peak).toBe(HANDOVER_COPY_BATCH);
  });

  it('counts a copy whose destination is already there as done, so a retry skips what landed', async () => {
    const storage = fakeStorage((_bucket, to) => (to === 'new/1' ? { message: 'The resource already exists', statusCode: '409' } : null));
    const copies = [
      { bucket: 'service-book' as const, from: 'old/1', to: 'new/1' },
      { bucket: 'service-book' as const, from: 'old/2', to: 'new/2' },
    ];
    expect(await copyHandoverObjects(storage, copies)).toEqual([]);
  });

  it('reports the copies that failed and still runs the batches after them', async () => {
    const storage = fakeStorage((_bucket, to) => (to === 'new/3' ? { message: 'Object not found', statusCode: '404' } : null));
    const copies = Array.from({ length: 12 }, (_, index) => ({ bucket: 'service-book' as const, from: `old/${index}`, to: `new/${index}` }));
    const failed = await copyHandoverObjects(storage, copies);
    expect(failed).toEqual([{ copy: copies[3], message: 'Object not found' }]);
    expect(storage.copied).toHaveLength(12);
  });
});

describe('taking over the book', () => {
  it('prepares, copies and accepts once when everything lands', async () => {
    const rider = fakeRider([{ data: prepared(), error: null }], [{ data: acceptedResult, error: null }]);
    const storage = fakeStorage();
    const report = vi.fn();

    const outcome = await takeOverServiceBook({ rider, storage, token: TOKEN, report });

    expect(outcome).toEqual({ ok: true, data: { vehicleId: 'new-vehicle', bookId: 'new-book', entries: 2, sessions: 1, attachments: 2 }, attempts: 1, objectsCopied: 5 });
    expect(rider.calls.map((call) => call.name)).toEqual(['prepare_service_book_transfer_accept', 'accept_service_book_transfer']);
    expect(rider.calls[1].args).toEqual({ p_token: TOKEN, p_photo_urls: photoUrlsOf(storage, prepared()) });
    expect(storage.removed).toEqual([]);
    expect(report).not.toHaveBeenCalled();
  });

  it('runs the three steps again on TT409, and gives up after the bounded number of attempts', async () => {
    const stale = { data: null, error: { code: 'TT409', message: 'the bike changed since the handover was prepared' } };
    const rider = fakeRider(
      [{ data: prepared(), error: null }, { data: prepared(), error: null }],
      [stale, { data: acceptedResult, error: null }],
    );
    const outcome = await takeOverServiceBook({ rider, storage: fakeStorage(), token: TOKEN, report: vi.fn() });
    expect(outcome).toMatchObject({ ok: true, attempts: 2 });

    const never = fakeRider(
      Array.from({ length: HANDOVER_ACCEPT_ATTEMPTS }, () => ({ data: prepared(), error: null })),
      Array.from({ length: HANDOVER_ACCEPT_ATTEMPTS }, () => ({ ...stale })),
    );
    const storage = fakeStorage();
    const gaveUp = await takeOverServiceBook({ rider: never, storage, token: TOKEN, report: vi.fn() });
    expect(gaveUp).toEqual({ ok: false, stage: 'accept', code: 'TT409', message: stale.error.message, attempts: HANDOVER_ACCEPT_ATTEMPTS });
    expect(never.calls.filter((call) => call.name === 'prepare_service_book_transfer_accept')).toHaveLength(HANDOVER_ACCEPT_ATTEMPTS);
    // The public-bucket copies are taken back; the private ones are swept.
    expect(storage.removed).toEqual([
      { bucket: 'session-photos', paths: ['buyer/ns1.jpg'] },
      { bucket: 'vehicle-photos', paths: ['buyer/nv.jpg'] },
    ]);
  });

  it('returns any other refusal with its code, without retrying', async () => {
    for (const code of ['TT402', 'TT403', 'TT404', 'TT410']) {
      const rider = fakeRider([{ data: prepared(), error: null }], [{ data: null, error: { code, message: 'refused' } }]);
      const outcome = await takeOverServiceBook({ rider, storage: fakeStorage(), token: TOKEN, report: vi.fn() });
      expect(outcome).toMatchObject({ ok: false, stage: 'accept', code, attempts: 1 });
      expect(rider.calls).toHaveLength(2);
    }
    const refusedEarly = fakeRider([{ data: null, error: { code: 'TT403', message: 'wrong address' } }], []);
    const storage = fakeStorage();
    expect(await takeOverServiceBook({ rider: refusedEarly, storage, token: TOKEN, report: vi.fn() })).toMatchObject({ ok: false, stage: 'prepare', code: 'TT403' });
    expect(storage.copied).toEqual([]);
    expect(storage.removed).toEqual([]);
  });

  it('stops before accept when a copy failed, reporting each failed object', async () => {
    const rider = fakeRider([{ data: prepared(), error: null }], []);
    const storage = fakeStorage((bucket) => (bucket === 'session-photos' ? { message: 'Object not found', statusCode: '404' } : null));
    const report = vi.fn();
    const outcome = await takeOverServiceBook({ rider, storage, token: TOKEN, report });
    expect(outcome).toMatchObject({ ok: false, stage: 'copy', attempts: 1 });
    expect(rider.calls.map((call) => call.name)).toEqual(['prepare_service_book_transfer_accept']);
    expect(report).toHaveBeenCalledWith('service-book-handover-copy', expect.any(Error), expect.objectContaining({ bucket: 'session-photos', from: 'seller/s1.jpg' }));
  });

  it('a handover accepted already copies nothing and answers the first result', async () => {
    const rider = fakeRider(
      [{ data: prepared({ accepted: true, attachments: [], session_photos: [], vehicle_photo: null }), error: null }],
      [{ data: acceptedResult, error: null }],
    );
    const storage = fakeStorage();
    const outcome = await takeOverServiceBook({ rider, storage, token: TOKEN, report: vi.fn() });
    expect(outcome).toMatchObject({ ok: true, objectsCopied: 0 });
    expect(storage.copied).toEqual([]);
    expect(rider.calls[1].args).toEqual({ p_token: TOKEN, p_photo_urls: { vehicle: null, sessions: {} } });
  });

  it('refuses a plan it cannot read rather than copying from it', async () => {
    const rider = fakeRider([{ data: { vehicle_id: 'v' }, error: null }], []);
    const report = vi.fn();
    const outcome = await takeOverServiceBook({ rider, storage: fakeStorage(), token: TOKEN, report });
    expect(outcome).toMatchObject({ ok: false, stage: 'prepare', code: undefined });
    expect(report).toHaveBeenCalledWith('service-book-handover-prepare', expect.any(Error), expect.anything());
  });
});
