import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/actions/vehicles', () => ({
  getUserProfile: vi.fn(),
}));

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth';
import { getUserProfile } from '@/lib/actions/vehicles';
import { createClient } from '@/lib/supabase/server';
import { createTrack, deleteTrack, getTrack, updateTrack } from '@/lib/actions/tracks';

type QueryResponse = {
  base?: { data?: unknown; error?: { message: string } | null; count?: number | null };
  single?: { data?: unknown; error?: { message: string } | null };
};

function createQuery(response: QueryResponse = {}) {
  const base = response.base ?? { data: null, error: null, count: null };
  const single = response.single ?? { data: null, error: null };
  const query: Record<string, unknown> = {};

  query.eq = vi.fn(() => query);
  query.insert = vi.fn(() => query);
  query.update = vi.fn(() => query);
  query.delete = vi.fn(() => query);
  query.select = vi.fn(() => query);
  query.single = vi.fn(async () => single);
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(base).then(onFulfilled, onRejected);

  return query;
}

describe('tracks actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth error while logged out', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    const result = await createTrack({ name: 'Road Atlanta' });

    expect(result).toEqual({ ok: false, error: 'Not authenticated.' });
  });

  it('validates required track name', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

    const result = await createTrack({ name: '   ' });

    expect(result).toEqual({ ok: false, error: 'Track name is required.' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('creates custom track and revalidates dependent pages', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'pro' } as never);

    const insertQuery = createQuery({
      single: {
        data: {
          id: 'track-1',
          name: 'Road Atlanta',
          location: 'Braselton, GA',
          created_by: 'user-1',
          is_seeded: false,
        },
        error: null,
      },
    });
    const from = vi.fn().mockReturnValue(insertQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await createTrack({
      name: '  Road Atlanta  ',
      location: '  Braselton, GA  ',
    });

    expect(result.ok).toBe(true);
    expect(insertQuery.insert).toHaveBeenCalledWith({
      name: 'Road Atlanta',
      location: 'Braselton, GA',
      is_seeded: false,
      created_by: 'user-1',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/tracks');
    expect(revalidatePath).toHaveBeenCalledWith('/sessions/new');
  });

  it('enforces free tier track limit', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    vi.mocked(getUserProfile).mockResolvedValue({ id: 'user-1', tier: 'free' } as never);

    const countQuery = createQuery({
      base: { data: null, error: null, count: 3 },
    });
    const from = vi.fn().mockReturnValue(countQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await createTrack({ name: 'Any Track' });

    expect(result).toEqual({
      ok: false,
      error: 'Free plan is limited to 3 tracks. Upgrade to Pro for unlimited tracks.',
    });
  });

  it('gets track details for seeded track', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

    const selectQuery = createQuery({
      single: {
        data: { id: 'track-1', is_seeded: true, created_by: null, name: 'Road America', location: null },
        error: null,
      },
    });
    const from = vi.fn().mockReturnValue(selectQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await getTrack('track-1');

    expect(result.ok).toBe(true);
  });

  it('rejects update when user is logged out', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    const result = await updateTrack('track-1', { name: 'Updated' });

    expect(result).toEqual({ ok: false, error: 'Not authenticated.' });
  });

  it('rejects update when name is empty', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

    const result = await updateTrack('track-1', { name: '    ' });

    expect(result).toEqual({ ok: false, error: 'Track name is required.' });
  });

  it('rejects update on seeded tracks', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

    const selectQuery = createQuery({
      single: {
        data: { id: 'track-1', is_seeded: true, created_by: null, name: 'Road America', location: null },
        error: null,
      },
    });
    const from = vi.fn().mockReturnValue(selectQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await updateTrack('track-1', { name: 'Updated Name' });

    expect(result).toEqual({ ok: false, error: 'Global tracks are read-only.' });
  });

  it('updates owned custom tracks', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

    const selectQuery = createQuery({
      single: {
        data: { id: 'track-1', is_seeded: false, created_by: 'user-1', name: 'Old Name', location: null },
        error: null,
      },
    });
    const updateQuery = createQuery({
      single: {
        data: { id: 'track-1', is_seeded: false, created_by: 'user-1', name: 'New Name', location: 'Austin, TX' },
        error: null,
      },
    });
    const from = vi
      .fn()
      .mockImplementationOnce(() => selectQuery)
      .mockImplementationOnce(() => updateQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await updateTrack('track-1', {
      name: '  New Name  ',
      location: ' Austin, TX ',
    });

    expect(result.ok).toBe(true);
    expect(updateQuery.update).toHaveBeenCalledWith({
      name: 'New Name',
      location: 'Austin, TX',
    });
    expect(revalidatePath).toHaveBeenCalledWith('/tracks');
    expect(revalidatePath).toHaveBeenCalledWith('/tracks/track-1');
    expect(revalidatePath).toHaveBeenCalledWith('/sessions/new');
  });

  it('rejects delete on seeded tracks', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

    const selectQuery = createQuery({
      single: {
        data: { id: 'track-1', is_seeded: true, created_by: null, name: 'Road America', location: null },
        error: null,
      },
    });
    const from = vi.fn().mockReturnValue(selectQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await deleteTrack('track-1');

    expect(result).toEqual({ ok: false, error: 'Global tracks are read-only.' });
  });

  it('deletes owned custom tracks', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

    const selectQuery = createQuery({
      single: {
        data: { id: 'track-1', is_seeded: false, created_by: 'user-1', name: 'My Track', location: null },
        error: null,
      },
    });
    const deleteQuery = createQuery({
      base: { data: null, error: null },
    });
    const from = vi
      .fn()
      .mockImplementationOnce(() => selectQuery)
      .mockImplementationOnce(() => deleteQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await deleteTrack('track-1');

    expect(result.ok).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith('/tracks');
    expect(revalidatePath).toHaveBeenCalledWith('/sessions/new');
  });

  it('surfaces delete errors from the database', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

    const selectQuery = createQuery({
      single: {
        data: { id: 'track-1', is_seeded: false, created_by: 'user-1', name: 'My Track', location: null },
        error: null,
      },
    });
    const deleteQuery = createQuery({
      base: { data: null, error: { message: 'Delete failed' } },
    });
    const from = vi
      .fn()
      .mockImplementationOnce(() => selectQuery)
      .mockImplementationOnce(() => deleteQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await deleteTrack('track-1');

    expect(result).toEqual({ ok: false, error: 'Delete failed' });
  });
});
