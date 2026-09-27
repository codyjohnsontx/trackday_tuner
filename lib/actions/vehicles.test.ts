import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getRealUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/monitoring/report-error', () => ({
  reportError: vi.fn(),
}));

import { revalidatePath } from 'next/cache';
import { getRealUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { reportError } from '@/lib/monitoring/report-error';
import { createVehicle, deleteVehicle, getVehicleDeletionCounts, updateVehicle } from '@/lib/actions/vehicles';
import {
  VEHICLE_DELETE_COUNT_CHANGED_AFTER_PHOTOS_MESSAGE,
  VEHICLE_DELETE_COUNT_CHANGED_MESSAGE,
  VEHICLE_DELETE_COUNT_FAILED_MESSAGE,
  VEHICLE_DELETE_FAILED_AFTER_PHOTOS_MESSAGE,
  VEHICLE_DELETE_FAILED_MESSAGE,
  VEHICLE_DELETE_NOT_FOUND_MESSAGE,
  VEHICLE_DELETE_SESSION_PHOTOS_FAILED_MESSAGE,
} from '@/lib/vehicle-delete';
import { STORAGE_REMOVE_BATCH_LIMIT } from '@/lib/storage-photo-removal';

type QueryResponse = {
  base?: { data?: unknown; error?: { message: string; code?: string } | null; count?: number | null };
  single?: { data?: unknown; error?: { message: string } | null };
};

function createQuery(response: QueryResponse = {}) {
  const base = response.base ?? { data: null, error: null, count: null };
  const single = response.single ?? { data: null, error: null };
  const query: Record<string, unknown> = {};

  query.select = vi.fn(() => query);
  query.insert = vi.fn(() => query);
  query.update = vi.fn(() => query);
  query.delete = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.range = vi.fn(() => query);
  query.single = vi.fn(async () => single);
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(base).then(onFulfilled, onRejected);

  return query;
}

type StorageRemove = ReturnType<typeof vi.fn>;
type RpcResponse = { data: unknown; error: { message: string; code?: string } | null };

/**
 * A client whose `from(table)` hands out that table's queries in call order.
 * `rpc` answers the guarded delete; `events` records Storage removals and the
 * delete in the order they happened, so "photos first" is asserted.
 */
function clientFor(
  tables: Record<string, ReturnType<typeof createQuery>[]>,
  storageRemove: StorageRemove = vi.fn(async (paths: string[]) => ({
    data: paths.map((name) => ({ name })),
    error: null,
  })),
  rpcResponse: RpcResponse = { data: { id: 'veh-1', photo_url: null }, error: null },
) {
  const from = vi.fn((table: string) => {
    const next = tables[table]?.shift();
    if (!next) throw new Error(`unexpected query on ${table}`);
    return next;
  });
  lastEvents = [];
  const remove = vi.fn(async (paths: string[]) => {
    lastEvents.push(`remove ${paths.length}`);
    return storageRemove(paths);
  });
  const storageFrom = vi.fn((bucket: string) => {
    lastEvents.push(`storage ${bucket}`);
    return { remove };
  });
  const rpc = vi.fn(async () => {
    lastEvents.push('delete vehicle');
    return rpcResponse;
  });
  vi.mocked(createClient).mockResolvedValue({ from, rpc, storage: { from: storageFrom } } as never);
  lastStorageFrom = storageFrom;
  lastRemove = remove;
  lastRpc = rpc;
  return from;
}

let lastStorageFrom: ReturnType<typeof vi.fn>;
let lastRemove: ReturnType<typeof vi.fn>;
let lastRpc: ReturnType<typeof vi.fn>;
let lastEvents: string[] = [];

function baselineCount(count: number) {
  return createQuery({ base: { data: null, error: null, count } });
}

function aiRecords(recommendations = 0, memories = 0) {
  return {
    ai_recommendations: [baselineCount(recommendations)],
    race_engineer_memory: [baselineCount(memories)],
  };
}

function sessionIdPage(count: number, offset = 0) {
  return createQuery({
    base: { data: Array.from({ length: count }, (_, index) => ({ id: `sess-${offset + index}` })), error: null },
  });
}

const SUPABASE_URL = 'https://project.supabase.co';

const sessionPhoto = (object: string) => `${SUPABASE_URL}/storage/v1/object/public/session-photos/${object}`;

/** A page of sessions each carrying its own photo, as the count reads them. */
function photoSessionPage(count: number, offset = 0) {
  return createQuery({
    base: {
      data: Array.from({ length: count }, (_, index) => ({
        id: `sess-${offset + index}`,
        photo_url: sessionPhoto(`user-1/sess-${offset + index}.jpg`),
      })),
      error: null,
    },
  });
}

function lapCounts(batches: number) {
  return Array.from({ length: batches }, () => createQuery({ base: { data: null, error: null, count: 0 } }));
}

describe('vehicles actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
  });

  it('returns auth error when creating vehicle while logged out', async () => {
    vi.mocked(getRealUser).mockResolvedValue(null);

    const result = await createVehicle({ nickname: 'Bike', type: 'motorcycle' });

    expect(result).toEqual({ ok: false, error: 'Not authenticated.' });
  });

  it('enforces free tier vehicle limit', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    const profileQuery = createQuery({
      single: { data: { id: 'user-1', tier: 'free' }, error: null },
    });
    const countQuery = createQuery({
      base: { count: 1, data: null, error: null },
    });

    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('profiles');
        return profileQuery;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('vehicles');
        return countQuery;
      });

    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await createVehicle({ nickname: 'Second Bike', type: 'motorcycle' });

    expect(result).toEqual({
      ok: false,
      error: 'Free plan is limited to 1 vehicle. Upgrade to Pro for unlimited vehicles.',
    });
  });

  it('creates vehicle and revalidates garage path', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    const profileQuery = createQuery({
      single: { data: { id: 'user-1', tier: 'pro' }, error: null },
    });
    const insertQuery = createQuery({
      single: {
        data: { id: 'veh-1', nickname: 'R6', type: 'motorcycle', user_id: 'user-1' },
        error: null,
      },
    });

    const from = vi
      .fn()
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('profiles');
        return profileQuery;
      })
      .mockImplementationOnce((table: string) => {
        expect(table).toBe('vehicles');
        return insertQuery;
      });

    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await createVehicle({
      nickname: 'R6',
      type: 'motorcycle',
      year: 2024,
      make: 'Yamaha',
    });

    expect(result.ok).toBe(true);
    expect(insertQuery.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      nickname: 'R6',
      type: 'motorcycle',
      year: 2024,
      make: 'Yamaha',
      model: null,
      photo_url: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/garage');
  });

  it('validates year on update before database call', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    const result = await updateVehicle('veh-1', { year: 1700 });

    expect(result).toEqual({ ok: false, error: 'Please enter a valid year.' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('counts the sessions and laps a vehicle delete would take', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const sessions = sessionIdPage(2);
    const laps = createQuery({ base: { data: null, error: null, count: 7 } });
    const records = aiRecords(4, 1);
    const recommendations = records.ai_recommendations[0];
    const memory = records.race_engineer_memory[0];
    clientFor({ sessions: [sessions], session_laps: [laps], vehicle_baselines: [baselineCount(1)], ...records });

    const result = await getVehicleDeletionCounts('veh-1');

    expect(result).toEqual({
      ok: true,
      data: { sessionCount: 2, lapCount: 7, hasBaseline: true, recommendationCount: 4, hasRaceEngineerMemory: true },
    });
    expect(recommendations.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(recommendations.eq).toHaveBeenCalledWith('vehicle_id', 'veh-1');
    expect(memory.eq).toHaveBeenCalledWith('vehicle_id', 'veh-1');
    expect(sessions.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(sessions.eq).toHaveBeenCalledWith('vehicle_id', 'veh-1');
    expect(laps.in).toHaveBeenCalledWith('session_id', ['sess-0', 'sess-1']);
  });

  it('pages past the row limit rather than undercounting a long history', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const lapBatches = Array.from({ length: 11 }, () => createQuery({ base: { data: null, error: null, count: 3 } }));
    clientFor({
      sessions: [sessionIdPage(1000), sessionIdPage(1, 1000)],
      session_laps: lapBatches,
      vehicle_baselines: [baselineCount(0)],
      ...aiRecords(),
    });

    const result = await getVehicleDeletionCounts('veh-1');

    expect(result).toEqual({
      ok: true,
      data: { sessionCount: 1001, lapCount: 33, hasBaseline: false, recommendationCount: 0, hasRaceEngineerMemory: false },
    });
  });

  it('reports a failed count instead of claiming the bike has no sessions', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor({ sessions: [createQuery({ base: { data: null, error: { message: 'boom', code: '500' } } })] });

    const result = await getVehicleDeletionCounts('veh-1');

    expect(result).toEqual({ ok: false, error: VEHICLE_DELETE_COUNT_FAILED_MESSAGE });
    expect(reportError).toHaveBeenCalled();
  });

  it('reports a failed Race Engineer count instead of leaving it out of the confirmation', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor({
      sessions: [sessionIdPage(0)],
      vehicle_baselines: [baselineCount(0)],
      ai_recommendations: [createQuery({ base: { data: null, error: { message: 'boom', code: '500' } } })],
    });

    const result = await getVehicleDeletionCounts('veh-1');

    expect(result).toEqual({ ok: false, error: VEHICLE_DELETE_COUNT_FAILED_MESSAGE });
    expect(reportError).toHaveBeenCalled();
  });

  it('deletes the vehicle when the session count still matches and refreshes every list', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor({
      sessions: [sessionIdPage(2)],
      session_laps: [createQuery({ base: { data: null, error: null, count: 5 } })],
      vehicle_baselines: [baselineCount(0)],
      ...aiRecords(),
    });

    const result = await deleteVehicle('veh-1', 2);

    expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: false } });
    expect(lastRpc).toHaveBeenCalledWith('delete_vehicle_if_sessions_unchanged', {
      p_vehicle_id: 'veh-1',
      p_expected_sessions: [
        { id: 'sess-0', photo_url: null },
        { id: 'sess-1', photo_url: null },
      ],
    });
    expect(lastEvents).toEqual(['delete vehicle', 'storage session-photos', 'remove 2']);
    expect(lastRemove).toHaveBeenCalledWith(['user-1/sess-0.jpg', 'user-1/sess-1.jpg']);
    for (const path of ['/garage', '/dashboard', '/sessions', '/sessions/new', '/tracks']) {
      expect(revalidatePath).toHaveBeenCalledWith(path);
    }
  });

  it('removes every session photo first, then deletes the bike against the sessions it read', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor({
      sessions: [
        createQuery({
          base: {
            data: [
              { id: 'sess-1', photo_url: sessionPhoto('user-1/sess-1.jpg') },
              { id: 'sess-2', photo_url: null },
            ],
            error: null,
          },
        }),
      ],
      session_laps: lapCounts(1),
      vehicle_baselines: [baselineCount(0)],
      ...aiRecords(),
    });

    const result = await deleteVehicle('veh-1', 2);

    expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: false } });
    expect(lastRemove).toHaveBeenNthCalledWith(1, ['user-1/sess-1.jpg']);
    expect(lastEvents).toEqual([
      'storage session-photos',
      'remove 1',
      'delete vehicle',
      'storage session-photos',
      'remove 2',
    ]);
    expect(lastRpc).toHaveBeenCalledWith('delete_vehicle_if_sessions_unchanged', {
      p_vehicle_id: 'veh-1',
      p_expected_sessions: [
        { id: 'sess-1', photo_url: sessionPhoto('user-1/sess-1.jpg') },
        { id: 'sess-2', photo_url: null },
      ],
    });
    expect(reportError).not.toHaveBeenCalled();
  });

  describe('a phone uploading to a session photo path while the bike is deleted', () => {
    // The bucket as Storage holds it: `remove` deletes what is there and reports
    // it, and the phone's upload lands while the guarded delete runs.
    function bucketWith(objects: string[]) {
      const bucket = new Set(objects);
      const remove = vi.fn(async (paths: string[]) => ({
        data: paths.filter((path) => bucket.delete(path)).map((name) => ({ name })),
        error: null,
      }));
      return { bucket, remove };
    }

    function uploadDuringDelete(bucket: Set<string>, object: string) {
      lastRpc.mockImplementationOnce(async () => {
        lastEvents.push('delete vehicle');
        bucket.add(object);
        return { data: { id: 'veh-1', photo_url: null }, error: null };
      });
    }

    it('removes a replacement uploaded under the same URL after the first removal', async () => {
      vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
      const { bucket, remove } = bucketWith(['user-1/sess-0.jpg']);
      clientFor(
        {
          sessions: [photoSessionPage(1)],
          session_laps: lapCounts(1),
          vehicle_baselines: [baselineCount(0)],
          ...aiRecords(),
        },
        remove,
      );
      uploadDuringDelete(bucket, 'user-1/sess-0.jpg');

      const result = await deleteVehicle('veh-1', 1);

      expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: false } });
      expect(bucket.size).toBe(0);
      expect(reportError).not.toHaveBeenCalled();
    });

    it('removes a first photo uploaded to a session that had none when it was read', async () => {
      vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
      const { bucket, remove } = bucketWith([]);
      clientFor(
        {
          sessions: [sessionIdPage(1)],
          session_laps: lapCounts(1),
          vehicle_baselines: [baselineCount(0)],
          ...aiRecords(),
        },
        remove,
      );
      uploadDuringDelete(bucket, 'user-1/sess-0.jpg');

      const result = await deleteVehicle('veh-1', 1);

      expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: false } });
      expect(bucket.size).toBe(0);
      expect(reportError).not.toHaveBeenCalled();
    });

    it('keeps the delete and says so when the removal after it fails', async () => {
      vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
      clientFor(
        {
          sessions: [sessionIdPage(1)],
          session_laps: lapCounts(1),
          vehicle_baselines: [baselineCount(0)],
          ...aiRecords(),
        },
        vi.fn(async () => ({ data: null, error: { message: 'storage down' } })),
      );

      const result = await deleteVehicle('veh-1', 1);

      expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: true } });
      expect(lastEvents).toEqual(['delete vehicle', 'storage session-photos', 'remove 1']);
      expect(reportError).toHaveBeenCalledWith(
        'session-photo-delete',
        expect.any(Error),
        expect.objectContaining({ bucket: 'session-photos', object: 'user-1/sess-0.jpg', vehicleId: 'veh-1' }),
      );
      expect(revalidatePath).toHaveBeenCalledWith('/garage');
    });
  });

  it('keeps the bike and every session when storage refuses to remove a session photo', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor(
      {
        sessions: [photoSessionPage(2)],
        session_laps: lapCounts(1),
        vehicle_baselines: [baselineCount(0)],
        ...aiRecords(),
      },
      vi.fn(async () => ({ data: null, error: { message: 'storage down' } })),
    );

    const result = await deleteVehicle('veh-1', 2);

    expect(result).toEqual({ ok: false, error: VEHICLE_DELETE_SESSION_PHOTOS_FAILED_MESSAGE });
    expect(lastRpc).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      'session-photo-delete',
      expect.any(Error),
      expect.objectContaining({ bucket: 'session-photos', object: 'user-1/sess-0.jpg', vehicleId: 'veh-1' }),
    );
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('sends a long history in batches of at most the Storage cap before deleting', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const total = STORAGE_REMOVE_BATCH_LIMIT + 1;
    clientFor({
      sessions: [photoSessionPage(1000), photoSessionPage(1, 1000)],
      session_laps: lapCounts(Math.ceil(total / 100)),
      vehicle_baselines: [baselineCount(0)],
      ...aiRecords(),
    });

    const result = await deleteVehicle('veh-1', total);

    expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: false } });
    expect(lastEvents).toEqual([
      'storage session-photos',
      `remove ${STORAGE_REMOVE_BATCH_LIMIT}`,
      'storage session-photos',
      'remove 1',
      'delete vehicle',
      'storage session-photos',
      `remove ${STORAGE_REMOVE_BATCH_LIMIT}`,
      'storage session-photos',
      'remove 1',
    ]);
    const [, args] = lastRpc.mock.calls[0] as unknown as [string, { p_expected_sessions: unknown[] }];
    expect(args.p_expected_sessions).toHaveLength(total);
  });

  it('keeps the bike when any one batch of session photos fails', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const total = STORAGE_REMOVE_BATCH_LIMIT + 1;
    clientFor(
      {
        sessions: [photoSessionPage(1000), photoSessionPage(1, 1000)],
        session_laps: lapCounts(Math.ceil(total / 100)),
        vehicle_baselines: [baselineCount(0)],
        ...aiRecords(),
      },
      vi.fn(async (paths: string[]) =>
        paths.length === 1
          ? { data: null, error: { message: 'storage down' } }
          : { data: paths.map((name) => ({ name })), error: null },
      ),
    );

    const result = await deleteVehicle('veh-1', total);

    expect(result).toEqual({ ok: false, error: VEHICLE_DELETE_SESSION_PHOTOS_FAILED_MESSAGE });
    expect(lastRemove).toHaveBeenCalledTimes(2);
    expect(lastRpc).not.toHaveBeenCalled();
  });

  it('keeps the bike when a session reached it after the photos were removed', async () => {
    // The guarded delete locks the bike and its sessions and compares them with
    // what was read; a session synced in between comes back as TT409.
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor(
      {
        sessions: [photoSessionPage(1)],
        session_laps: lapCounts(1),
        vehicle_baselines: [baselineCount(0)],
        ...aiRecords(),
      },
      undefined,
      { data: null, error: { message: 'the sessions on this vehicle changed since they were read', code: 'TT409' } },
    );

    const result = await deleteVehicle('veh-1', 1);

    expect(result).toEqual({ ok: false, error: VEHICLE_DELETE_COUNT_CHANGED_AFTER_PHOTOS_MESSAGE });
    expect(lastEvents).toEqual(['storage session-photos', 'remove 1', 'delete vehicle']);
    expect(reportError).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('refuses when a session was logged on the bike after the rider read the count', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor({
      sessions: [sessionIdPage(3)],
      session_laps: [createQuery({ base: { data: null, error: null, count: 5 } })],
      vehicle_baselines: [baselineCount(0)],
      ...aiRecords(),
    });

    const result = await deleteVehicle('veh-1', 2);

    expect(result).toEqual({ ok: false, error: VEHICLE_DELETE_COUNT_CHANGED_MESSAGE });
    expect(lastStorageFrom).not.toHaveBeenCalled();
    expect(lastRpc).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("removes the bike's own photo from the public bucket once the row is gone", async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor(
      { sessions: [sessionIdPage(0)], vehicle_baselines: [baselineCount(0)], ...aiRecords() },
      undefined,
      {
        data: {
          id: 'veh-1',
          photo_url: `${SUPABASE_URL}/storage/v1/object/public/vehicle-photos/user-1/1700_my%20bike.jpg`,
        },
        error: null,
      },
    );

    const result = await deleteVehicle('veh-1', 0);

    expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: false } });
    expect(lastEvents).toEqual(['delete vehicle', 'storage vehicle-photos', 'remove 1']);
    expect(lastRemove).toHaveBeenCalledWith(['user-1/1700_my bike.jpg']);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("leaves another rider's photo alone when the bike's URL names one", async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    const foreign = `${SUPABASE_URL}/storage/v1/object/public/vehicle-photos/user-2/theirs.jpg`;
    clientFor(
      { sessions: [sessionIdPage(0)], vehicle_baselines: [baselineCount(0)], ...aiRecords() },
      undefined,
      { data: { id: 'veh-1', photo_url: foreign }, error: null },
    );

    const result = await deleteVehicle('veh-1', 0);

    expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: false } });
    expect(lastRemove).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalledWith(
      'vehicle-photo-delete',
      expect.any(Error),
      expect.objectContaining({ photoUrl: foreign, vehicleId: 'veh-1' }),
    );
  });

  it("keeps the delete and reports the bike's own photo when storage refuses to remove it", async () => {
    // The bike's own photo is unchanged by the session-photo ordering: it is
    // still removed after the row, and a failure is reported, not undone.
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor(
      { sessions: [sessionIdPage(0)], vehicle_baselines: [baselineCount(0)], ...aiRecords() },
      vi.fn(async () => ({ data: null, error: { message: 'storage down' } })),
      {
        data: { id: 'veh-1', photo_url: `${SUPABASE_URL}/storage/v1/object/public/vehicle-photos/user-1/1700.jpg` },
        error: null,
      },
    );

    const result = await deleteVehicle('veh-1', 0);

    expect(result).toEqual({ ok: true, data: { sessionPhotoCleanupFailed: false } });
    expect(reportError).toHaveBeenCalledWith(
      'vehicle-photo-delete',
      expect.any(Error),
      expect.objectContaining({ bucket: 'vehicle-photos', object: 'user-1/1700.jpg', vehicleId: 'veh-1' }),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/garage');
  });

  it('reports a failure when the delete matched no vehicle', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor(
      { sessions: [sessionIdPage(0)], vehicle_baselines: [baselineCount(0)], ...aiRecords() },
      undefined,
      { data: null, error: null },
    );

    const result = await deleteVehicle('someone-elses-vehicle', 0);

    expect(result).toEqual({ ok: false, error: VEHICLE_DELETE_NOT_FOUND_MESSAGE });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('does not tell the rider nothing was removed once session photos are gone and the delete fails', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor(
      {
        sessions: [photoSessionPage(1)],
        session_laps: lapCounts(1),
        vehicle_baselines: [baselineCount(0)],
        ...aiRecords(),
      },
      undefined,
      { data: null, error: { message: 'Delete failed', code: '42501' } },
    );

    const result = await deleteVehicle('veh-1', 1);

    expect(result).toEqual({ ok: false, error: VEHICLE_DELETE_FAILED_AFTER_PHOTOS_MESSAGE });
    expect(lastEvents).toEqual(['storage session-photos', 'remove 1', 'delete vehicle']);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('tells the rider nothing was removed when the database refuses the delete', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
    clientFor(
      { sessions: [sessionIdPage(0)], vehicle_baselines: [baselineCount(0)], ...aiRecords() },
      undefined,
      { data: null, error: { message: 'Delete failed', code: '42501' } },
    );

    const result = await deleteVehicle('veh-1', 0);

    expect(result).toEqual({ ok: false, error: VEHICLE_DELETE_FAILED_MESSAGE });
    expect(reportError).toHaveBeenCalledWith(
      'vehicle-delete',
      expect.any(Error),
      expect.objectContaining({ reason: '42501', table: 'vehicles' }),
    );
  });
});
