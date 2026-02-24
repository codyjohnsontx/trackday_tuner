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

import { revalidatePath } from 'next/cache';
import { getAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createVehicle, deleteVehicle, updateVehicle } from '@/lib/actions/vehicles';

type QueryResponse = {
  base?: { data?: unknown; error?: { message: string } | null; count?: number | null };
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
  query.single = vi.fn(async () => single);
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(base).then(onFulfilled, onRejected);

  return query;
}

describe('vehicles actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth error when creating vehicle while logged out', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    const result = await createVehicle({ nickname: 'Bike', type: 'motorcycle' });

    expect(result).toEqual({ ok: false, error: 'Not authenticated.' });
  });

  it('enforces free tier vehicle limit', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

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
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

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
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

    const result = await updateVehicle('veh-1', { year: 1700 });

    expect(result).toEqual({ ok: false, error: 'Please enter a valid year.' });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('surfaces delete errors from the database', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

    const deleteQuery = createQuery({
      base: { data: null, error: { message: 'Delete failed' } },
    });
    const from = vi.fn().mockReturnValue(deleteQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await deleteVehicle('veh-1');

    expect(result).toEqual({ ok: false, error: 'Delete failed' });
  });
});
