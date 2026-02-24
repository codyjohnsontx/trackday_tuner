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
import { createTrack } from '@/lib/actions/tracks';

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
});
