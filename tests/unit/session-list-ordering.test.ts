// A track day puts every session on one `date`, so ordering on that column alone
// leaves the whole day tied and the tie broken by whatever the planner emits. In
// practice that was insertion order, which read as the day backwards: the rider's
// 8:40 AM warm-up sat at the top of their history and the dashboard's three-row
// "Recent" list showed the three oldest sessions of the day while the one they had
// just finished was nowhere on it.
//
// The ordering itself lives in SQL, so this file evaluates the recorded `.order()`
// calls against a scrambled row set and asserts the emitted order matches
// `compareSessionsDesc` - the comparator the demo path, the previous-session lookup
// and the comparison page all already share.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })),
}));

vi.mock('@/lib/auth', () => ({
  getRealUser: vi.fn(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}));

vi.mock('@/lib/actions/vehicles', () => ({
  getUserProfile: vi.fn(),
}));

import { getRealUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getSessions } from '@/lib/actions/sessions';
import { compareSessionsDesc } from '@/lib/session-compare';
import type { Session } from '@/types';

const repoRoot = path.resolve(__dirname, '../..');

interface OrderCall {
  column: string;
  ascending: boolean;
  nullsFirst: boolean;
}

/**
 * Postgres `ORDER BY` over already-fetched rows: each recorded `.order()` is applied
 * in turn, NULLs land where the call said they should, and ties keep input order
 * because `Array.prototype.sort` is stable. That last detail is the whole point -
 * it is what reproduces the real planner handing back a track day in insertion
 * order when nothing breaks the tie.
 */
function applyOrdering<T extends Record<string, unknown>>(rows: T[], orders: OrderCall[]): T[] {
  return [...rows].sort((a, b) => {
    for (const { column, ascending, nullsFirst } of orders) {
      const left = a[column] as string | null;
      const right = b[column] as string | null;
      if (left == null && right == null) continue;
      if (left == null) return nullsFirst ? -1 : 1;
      if (right == null) return nullsFirst ? 1 : -1;
      const comparison = left.localeCompare(right);
      if (comparison !== 0) return ascending ? comparison : -comparison;
    }
    return 0;
  });
}

function session(overrides: Partial<Session> & Pick<Session, 'id' | 'date'>): Session {
  return {
    user_id: 'user-1',
    vehicle_id: 'veh-1',
    track_id: null,
    track_name: 'MSR Cresson 1.7',
    start_time: null,
    session_number: null,
    conditions: 'sunny',
    tires: {
      front: { brand: '', compound: '', pressure: '33' },
      rear: { brand: '', compound: '', pressure: '26' },
      condition: 'hot',
    },
    suspension: {
      front: { preload: '', compression: '', rebound: '', direction: 'clicks' },
      rear: { preload: '', compression: '', rebound: '', direction: 'clicks' },
    },
    alignment: null,
    enabled_modules: null,
    extra_modules: null,
    notes: null,
    created_at: `${overrides.date}T00:00:00Z`,
    updated_at: `${overrides.date}T00:00:00Z`,
    ...overrides,
  } as Session;
}

/**
 * Rows are seeded in the order a rider creates them - session 1 first - so a query
 * that fails to break the same-date tie hands the day back ascending, exactly as the
 * live database did.
 */
function createSupabaseStub(rows: Session[]) {
  const orders: OrderCall[] = [];
  let rowLimit: number | null = null;

  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.order = vi.fn((column: string, options?: { ascending?: boolean; nullsFirst?: boolean }) => {
    const ascending = options?.ascending ?? true;
    orders.push({
      column,
      ascending,
      // PostgREST mirrors SQL: descending defaults to NULLS FIRST.
      nullsFirst: options?.nullsFirst ?? !ascending,
    });
    return query;
  });
  query.limit = vi.fn((value: number) => {
    rowLimit = value;
    return query;
  });
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
    const ordered = applyOrdering(rows, orders);
    const data = rowLimit === null ? ordered : ordered.slice(0, rowLimit);
    return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
  };

  return { from: vi.fn(() => query) };
}

function labelsOf(sessions: Session[]): string[] {
  return sessions.map((row) => row.id);
}

describe('getSessions ordering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getRealUser).mockResolvedValue({ id: 'user-1' } as never);
  });

  // Six sessions of one track day, seeded oldest-first the way a rider logs them.
  const trackDay = [
    session({ id: 's1', date: '2026-08-04', start_time: '08:40:00' }),
    session({ id: 's2', date: '2026-08-04', start_time: '10:10:00' }),
    session({ id: 's3', date: '2026-08-04', start_time: '11:30:00' }),
    session({ id: 's4', date: '2026-08-04', start_time: '13:00:00' }),
    session({ id: 's5', date: '2026-08-04', start_time: '14:20:00' }),
    session({ id: 's6', date: '2026-08-04', start_time: '15:40:00' }),
  ];

  it('lists a track day newest first', async () => {
    vi.mocked(createClient).mockResolvedValue(createSupabaseStub(trackDay) as never);

    expect(labelsOf(await getSessions())).toEqual(['s6', 's5', 's4', 's3', 's2', 's1']);
  });

  it('agrees with the shared comparator every other surface sorts by', async () => {
    vi.mocked(createClient).mockResolvedValue(createSupabaseStub(trackDay) as never);

    expect(labelsOf(await getSessions())).toEqual(labelsOf([...trackDay].sort(compareSessionsDesc)));
  });

  it('gives the dashboard the three most recent sessions, not the three oldest', async () => {
    vi.mocked(createClient).mockResolvedValue(createSupabaseStub(trackDay) as never);

    // The dashboard's "Recent Sessions" panel: getSessions(undefined, 3).
    expect(labelsOf(await getSessions(undefined, 3))).toEqual(['s6', 's5', 's4']);
  });

  it('sorts a session with no start time to the end of its own day', async () => {
    // compareSessionsDesc reads a missing start time as 00:00:00, so descending it
    // belongs last within the date - which is NULLS LAST, not PostgREST's default.
    const rows = [
      session({ id: 'no-time', date: '2026-08-04', start_time: null }),
      session({ id: 'morning', date: '2026-08-04', start_time: '08:40:00' }),
      session({ id: 'afternoon', date: '2026-08-04', start_time: '15:40:00' }),
    ];
    vi.mocked(createClient).mockResolvedValue(createSupabaseStub(rows) as never);

    const ordered = labelsOf(await getSessions());
    expect(ordered).toEqual(['afternoon', 'morning', 'no-time']);
    expect(ordered).toEqual(labelsOf([...rows].sort(compareSessionsDesc)));
  });

  it('falls back to created_at when date and start time both tie', async () => {
    const rows = [
      session({
        id: 'logged-first',
        date: '2026-08-04',
        start_time: '08:40:00',
        created_at: '2026-08-04T09:00:00Z',
      }),
      session({
        id: 'logged-second',
        date: '2026-08-04',
        start_time: '08:40:00',
        created_at: '2026-08-04T09:30:00Z',
      }),
    ];
    vi.mocked(createClient).mockResolvedValue(createSupabaseStub(rows) as never);

    const ordered = labelsOf(await getSessions());
    expect(ordered).toEqual(['logged-second', 'logged-first']);
    expect(ordered).toEqual(labelsOf([...rows].sort(compareSessionsDesc)));
  });

  it('still puts a newer day above an older one', async () => {
    const rows = [
      session({ id: 'may', date: '2026-05-18', start_time: '15:40:00' }),
      session({ id: 'august', date: '2026-08-04', start_time: '08:40:00' }),
    ];
    vi.mocked(createClient).mockResolvedValue(createSupabaseStub(rows) as never);

    expect(labelsOf(await getSessions())).toEqual(['august', 'may']);
  });
});

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectFiles(full, out);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('source guard', () => {
  // Each `.from('sessions')` chain, cut at the next statement boundary. Only the
  // queries selecting whole rows are in scope: those become a list a rider reads,
  // where two same-date rows in the wrong order is the visible defect. A query
  // pulling a single column (lib/actions/beta.ts counts distinct days) has no order
  // to get wrong.
  const sessionRowQueries = [
    ...collectFiles(path.join(repoRoot, 'lib')),
    ...collectFiles(path.join(repoRoot, 'app')),
  ].flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    return source
      .split(/\.from\(\s*['"]sessions['"]\s*\)/)
      .slice(1)
      .map((rest) => rest.split(/;|\.from\(/)[0])
      .filter((chain) => /\.select\(\s*['"]\*['"]\s*\)/.test(chain))
      .map((chain) => ({ file: path.relative(repoRoot, file), chain }));
  });

  it('finds the session row queries to check', () => {
    expect(sessionRowQueries.length).toBeGreaterThan(2);
  });

  it('has no session row query ordering on date without breaking the same-day tie', () => {
    const offenders = sessionRowQueries
      .filter(({ chain }) => /\.order\(\s*['"]date['"]/.test(chain))
      .filter(({ chain }) => !/\.order\(\s*['"]start_time['"]/.test(chain))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });
});
