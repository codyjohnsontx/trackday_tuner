import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/monitoring/report-error', () => ({ reportError: vi.fn() }));

import { reportError } from '@/lib/monitoring/report-error';
import {
  ownedPublicObjectPath,
  removeOwnedPhotos,
  STORAGE_REMOVE_BATCH_LIMIT,
} from '@/lib/storage-photo-removal';

describe('ownedPublicObjectPath', () => {
  const owner = { supabaseUrl: 'https://project.supabase.co', ownerId: 'user-1', bucket: 'vehicle-photos' };

  it('reads the object name out of the public URL the form stored', () => {
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/vehicle-photos/user-1/1700.jpg',
        owner,
      ),
    ).toBe('user-1/1700.jpg');
  });

  it('decodes the name the object was uploaded under', () => {
    expect(
      ownedPublicObjectPath(
        'http://127.0.0.1:54321/storage/v1/object/public/vehicle-photos/user-1/1700_my%20bike%20%232.jpg',
        { supabaseUrl: 'http://127.0.0.1:54321', ownerId: 'user-1', bucket: 'vehicle-photos' },
      ),
    ).toBe('user-1/1700_my bike #2.jpg');
  });

  it('reads a project served under its own path prefix', () => {
    expect(
      ownedPublicObjectPath(
        'https://example.com/supabase/storage/v1/object/public/vehicle-photos/user-1/a.jpg',
        { supabaseUrl: 'https://example.com/supabase', ownerId: 'user-1', bucket: 'vehicle-photos' },
      ),
    ).toBe('user-1/a.jpg');
  });

  it("refuses an object outside this rider's own folder", () => {
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/vehicle-photos/user-2/a.jpg',
        owner,
      ),
    ).toBeNull();
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/vehicle-photos/a.jpg',
        owner,
      ),
    ).toBeNull();
  });

  it('refuses another project, another bucket and another endpoint', () => {
    expect(
      ownedPublicObjectPath(
        'https://other-project.supabase.co/storage/v1/object/public/vehicle-photos/user-1/a.jpg',
        owner,
      ),
    ).toBeNull();
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/other-bucket/user-1/a.jpg',
        owner,
      ),
    ).toBeNull();
    expect(
      ownedPublicObjectPath(
        'https://example.com/anything/storage/v1/object/public/vehicle-photos/user-1/a.jpg',
        owner,
      ),
    ).toBeNull();
  });

  it('reads a session photo only out of the session-photos bucket', () => {
    const session = { ...owner, bucket: 'session-photos' };
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/session-photos/user-1/sess-1.jpg',
        session,
      ),
    ).toBe('user-1/sess-1.jpg');
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/vehicle-photos/user-1/1700.jpg',
        session,
      ),
    ).toBeNull();
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/session-photos/user-2/sess-1.jpg',
        session,
      ),
    ).toBeNull();
  });

  it('answers null rather than guessing at anything else', () => {
    expect(ownedPublicObjectPath(null, owner)).toBeNull();
    expect(ownedPublicObjectPath('', owner)).toBeNull();
    expect(ownedPublicObjectPath('not a url', owner)).toBeNull();
    expect(
      ownedPublicObjectPath(
        'https://project.supabase.co/storage/v1/object/public/vehicle-photos/user-1/a%ZZ.jpg',
        owner,
      ),
    ).toBeNull();
  });
});

describe('removeOwnedPhotos', () => {
  const supabaseUrl = 'https://project.supabase.co';
  const url = (object: string) => `${supabaseUrl}/storage/v1/object/public/session-photos/${object}`;
  const objects = (count: number) => Array.from({ length: count }, (_, index) => `user-1/sess-${index}.jpg`);

  type Remove = (paths: string[]) => Promise<{ data: { name: string }[] | null; error: { message: string } | null }>;

  // A Storage client that records every `remove` call and answers each batch
  // through `answer`, so a test can fail one batch and watch the others.
  function fakeStorage(answer: Remove) {
    const calls: string[][] = [];
    const remove = vi.fn(async (paths: string[]) => {
      calls.push(paths);
      return answer(paths);
    });
    return { calls, client: { storage: { from: () => ({ remove }) } } as never };
  }
  const removesEverything: Remove = async (paths) => ({ data: paths.map((name) => ({ name })), error: null });

  function run(client: never, photoUrls: string[]) {
    return removeOwnedPhotos(client, {
      bucket: 'session-photos',
      photoUrls,
      ownerId: 'user-1',
      event: 'test.remove',
      context: { vehicleId: 'bike-1' },
    });
  }

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl);
    vi.mocked(reportError).mockClear();
  });
  afterEach(() => vi.unstubAllEnvs());

  it('sends one call when everything fits the Storage cap', async () => {
    const { calls, client } = fakeStorage(removesEverything);
    await run(client, objects(STORAGE_REMOVE_BATCH_LIMIT).map(url));

    expect(calls.map((batch) => batch.length)).toEqual([STORAGE_REMOVE_BATCH_LIMIT]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('never names more than the cap in one call, and reaches every object', async () => {
    const all = objects(2 * STORAGE_REMOVE_BATCH_LIMIT + 1);
    const { calls, client } = fakeStorage(removesEverything);
    await run(client, all.map(url));

    expect(calls.map((batch) => batch.length)).toEqual([STORAGE_REMOVE_BATCH_LIMIT, STORAGE_REMOVE_BATCH_LIMIT, 1]);
    expect(calls.flat()).toEqual(all);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('reports only the objects of a batch that errors, and still runs the batches after it', async () => {
    const all = objects(STORAGE_REMOVE_BATCH_LIMIT + 2);
    const { calls, client } = fakeStorage(async (paths) =>
      paths.length === STORAGE_REMOVE_BATCH_LIMIT
        ? { data: null, error: { message: 'storage down' } }
        : removesEverything(paths),
    );
    await run(client, all.map(url));

    expect(calls).toHaveLength(2);
    const reported = vi.mocked(reportError).mock.calls.map(([, , extra]) => (extra as { object: string }).object);
    expect(reported).toEqual(all.slice(0, STORAGE_REMOVE_BATCH_LIMIT));
    expect(vi.mocked(reportError).mock.calls[0][1]).toEqual(new Error('storage down'));
  });

  it('keeps going past a batch whose call throws', async () => {
    const all = objects(STORAGE_REMOVE_BATCH_LIMIT + 1);
    const { calls, client } = fakeStorage(async (paths) => {
      if (paths.length === STORAGE_REMOVE_BATCH_LIMIT) throw new Error('network gone');
      return removesEverything(paths);
    });
    await run(client, all.map(url));

    expect(calls).toHaveLength(2);
    expect(reportError).toHaveBeenCalledTimes(STORAGE_REMOVE_BATCH_LIMIT);
    expect(vi.mocked(reportError).mock.calls[0][1]).toEqual(new Error('network gone'));
  });
});
