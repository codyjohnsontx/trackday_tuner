import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
}));

vi.mock('@/lib/auth', () => ({
  getAuthenticatedUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

import { cookies } from 'next/headers';
import { getAuthenticatedUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getSessionChangeRecords } from '@/lib/actions/session-changes';
import { DEMO_COOKIE_NAME } from '@/lib/demo/mode';
import type { SessionChange } from '@/types';

type QueryResponse = {
  base?: { data?: unknown; error?: { message: string } | null };
};

function createQuery(response: QueryResponse = {}) {
  const base = response.base ?? { data: null, error: null };
  const query: Record<string, unknown> = {};

  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve(base).then(onFulfilled, onRejected);

  return query;
}

function makeRecord(overrides: Partial<SessionChange>): SessionChange {
  return {
    id: 'change-1',
    user_id: 'user-1',
    session_id: 'session-1',
    vehicle_id: 'veh-1',
    reference_kind: 'previous',
    reference_session_id: 'session-0',
    reference_label: 'MSR Cresson 1.7 · May 18, 2026 · Session 3',
    reference_date: '2026-05-18',
    changes: [],
    created_at: '2026-05-18T19:45:00.000Z',
    updated_at: '2026-05-18T19:45:00.000Z',
    ...overrides,
  };
}

describe('session change actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => undefined) } as never);
  });

  it('returns demo change records without calling Supabase', async () => {
    vi.mocked(cookies).mockResolvedValue({ get: vi.fn(() => ({ value: '1', name: DEMO_COOKIE_NAME })) } as never);

    const result = await getSessionChangeRecords('demo-session-4');

    expect(result.map((record) => record.reference_kind)).toEqual(['previous', 'baseline']);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('returns an empty list when logged out', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue(null);

    await expect(getSessionChangeRecords('session-1')).resolves.toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
  });

  it('swallows query errors and returns an empty list', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    const query = createQuery({ base: { data: null, error: { message: 'boom' } } });
    const from = vi.fn().mockReturnValue(query);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    await expect(getSessionChangeRecords('session-1')).resolves.toEqual([]);
  });

  it('sorts previous before baseline for the authenticated user', async () => {
    vi.mocked(getAuthenticatedUser).mockResolvedValue({ id: 'user-1' } as never);
    const records = [
      makeRecord({ id: 'change-baseline', reference_kind: 'baseline' }),
      makeRecord({ id: 'change-previous', reference_kind: 'previous' }),
    ];
    const query = createQuery({ base: { data: records, error: null } });
    const from = vi.fn().mockReturnValue(query);
    vi.mocked(createClient).mockResolvedValue({ from } as never);

    const result = await getSessionChangeRecords('session-1');

    expect(from).toHaveBeenCalledWith('session_changes');
    expect(query.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(query.eq).toHaveBeenCalledWith('session_id', 'session-1');
    expect(result.map((record) => record.reference_kind)).toEqual(['previous', 'baseline']);
  });
});
