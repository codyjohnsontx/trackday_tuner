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
import { createSagEntry } from '@/lib/actions/sag';

type QueryResponse = {
  single?: { data?: unknown; error?: { message: string } | null };
};

function createQuery(response: QueryResponse = {}) {
  const single = response.single ?? { data: null, error: null };
  const query: Record<string, unknown> = {};

  query.insert = vi.fn(() => query);
  query.select = vi.fn(() => query);
  query.single = vi.fn(async () => single);

  return query;
}

describe('sag actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns auth error while logged out', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    const result = await createSagEntry({ front_l0: 120 });

    expect(result).toEqual({ ok: false, error: 'Not authenticated.' });
  });

  it('requires at least one measurement value', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

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
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);

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
});
