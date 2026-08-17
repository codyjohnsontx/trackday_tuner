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

import { revalidatePath } from 'next/cache';
import { getRealUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createSagEntry, deleteSagEntry } from '@/lib/actions/sag';

type QueryResponse = {
  single?: { data?: unknown; error?: { message: string } | null };
  /** Resolved when the query is awaited without `.single()`, as a delete is. */
  base?: { data?: unknown; error?: { message: string } | null };
};

function createQuery(response: QueryResponse = {}) {
  const single = response.single ?? { data: null, error: null };
  const base = response.base ?? { data: null, error: null };
  const query: Record<string, unknown> = {};

  query.insert = vi.fn(() => query);
  query.delete = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.select = vi.fn(() => query);
  query.single = vi.fn(async () => single);
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(base).then(onFulfilled, onRejected);

  return query;
}

describe('sag actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth error while logged out', async () => {
    vi.mocked(getRealUser).mockResolvedValue(null);

    const result = await createSagEntry({ front_l0: 120 });

    expect(result).toEqual({ ok: false, error: 'Not authenticated.' });
  });

  it('requires at least one measurement value', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    const result = await createSagEntry({
      label: 'Baseline',
      notes: 'No values yet',
    });

    expect(result).toEqual({
      ok: false,
      error: 'Enter at least one suspension measurement.',
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it('inserts sanitized values and revalidates sag page', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    const insertQuery = createQuery({
      single: {
        data: { id: 'sag-1', user_id: 'user-1', front_l0: 120.3 },
        error: null,
      },
    });
    const from = vi.fn().mockReturnValue(insertQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await createSagEntry({
      label: '  Baseline  ',
      notes: '  Initial setup  ',
      front_l0: 120.3,
      rear_l1: 90.1,
    });

    expect(result.ok).toBe(true);
    expect(insertQuery.insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      label: 'Baseline',
      notes: 'Initial setup',
      front_l0: 120.3,
      front_l1: null,
      front_l2: null,
      rear_l0: null,
      rear_l1: 90.1,
      rear_l2: null,
      front_travel_mm: null,
      rear_travel_mm: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith('/sag');
  });

  it('deletes only the rider\'s own entry', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    const deleteQuery = createQuery({ base: { data: [{ id: 'sag-1' }], error: null } });
    const from = vi.fn().mockReturnValue(deleteQuery);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await deleteSagEntry('sag-1');

    expect(result.ok).toBe(true);
    expect(deleteQuery.delete).toHaveBeenCalled();
    expect(deleteQuery.eq).toHaveBeenCalledWith('id', 'sag-1');
    expect(deleteQuery.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(revalidatePath).toHaveBeenCalledWith('/sag');
  });

  it('does not report success when nothing was deleted', async () => {
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);

    // RLS hides another rider's row, so the delete succeeds against zero rows.
    const deleteQuery = createQuery({ base: { data: [], error: null } });
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn().mockReturnValue(deleteQuery) } as never);

    expect(await deleteSagEntry('someone-elses')).toEqual({
      ok: false,
      error: 'Sag entry not found.',
    });
  });

  it('returns auth error when deleting while logged out', async () => {
    vi.mocked(getRealUser).mockResolvedValue(null);

    expect(await deleteSagEntry('sag-1')).toEqual({ ok: false, error: 'Not authenticated.' });
  });
});
