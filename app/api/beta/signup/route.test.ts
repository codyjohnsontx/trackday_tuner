import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Signing up while signups are invite-only: an invitation code admits its
 * address, and nothing else does - a handover link included (owner, TQ11: a
 * seller holds both the link and the buyer's address, so they prove nothing).
 *
 * The admin client is a fake that holds rows and applies the filters a query
 * names, so a refusal here is the row the query could not find rather than an
 * answer scripted per test.
 */

process.env.BETA_INVITE_SECRET = 'test-invite-secret';

vi.mock('@/lib/env.server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env.server')>()),
  isBetaInviteOnly: () => true,
}));

type Row = Record<string, unknown>;

const db: { tables: Record<string, Row[]>; created: { email: string }[]; upserts: { table: string; row: Row }[] } = {
  tables: {},
  created: [],
  upserts: [],
};

function query(table: string) {
  const filters: ((row: Row) => boolean)[] = [];
  let patch: Row | null = null;
  const matched = () => (db.tables[table] ?? []).filter((row) => filters.every((keep) => keep(row)));
  const builder = {
    select: () => builder,
    eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
    gt: (column: string, value: string) => (filters.push((row) => String(row[column]) > value), builder),
    update: (values: Row) => ((patch = values), builder),
    maybeSingle: async () => {
      const rows = matched();
      if (patch) for (const row of rows) Object.assign(row, patch);
      return { data: rows[0] ?? null, error: null };
    },
    upsert: async (row: Row) => (db.upserts.push({ table, row }), { error: null }),
    insert: async () => ({ error: null }),
  };
  return builder;
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => query(table),
    auth: {
      admin: {
        createUser: async ({ email }: { email: string }) => {
          db.created.push({ email });
          return { data: { user: { id: `user-${db.created.length}` } }, error: null };
        },
        deleteUser: async () => ({ error: null }),
      },
    },
  }),
}));

const { POST } = await import('@/app/api/beta/signup/route');
const { hashBetaInviteCode } = await import('@/lib/beta');

const BUYER = 'buyer@example.com';
const PASSWORD = 'correct-horse';
const future = () => new Date(Date.now() + 86_400_000).toISOString();

function signUp(body: Row) {
  return POST(new Request('http://127.0.0.1:3000/api/beta/signup', { method: 'POST', body: JSON.stringify(body) }));
}

beforeEach(() => {
  db.tables = { beta_invites: [] };
  db.created = [];
  db.upserts = [];
});

describe('POST /api/beta/signup with an invitation code', () => {
  function invite(partial: Row = {}): Row {
    return {
      id: 'invite-1',
      code_hash: hashBetaInviteCode('JOIN-ME'),
      email_normalized: BUYER,
      status: 'active',
      expires_at: future(),
      cohort: 'founding',
      waitlist_id: null,
      ...partial,
    };
  }

  it('redeems the invitation and starts the beta window, as before', async () => {
    db.tables.beta_invites = [invite()];
    const response = await signUp({ email: BUYER, password: PASSWORD, invite_code: 'JOIN-ME' });

    expect(response.status).toBe(200);
    expect(db.tables.beta_invites[0]).toMatchObject({ status: 'redeemed', redeemed_by: 'user-1' });
    expect(db.upserts[0]).toMatchObject({ table: 'profiles', row: { id: 'user-1', tier: 'free', beta_cohort: 'founding' } });
  });

  it('refuses a code that is not the invitation\'s', async () => {
    db.tables.beta_invites = [invite()];
    const response = await signUp({ email: BUYER, password: PASSWORD, invite_code: 'WRONG' });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'That invitation is invalid or has expired.' });
    expect(db.created).toEqual([]);
  });

  it('asks for a code when a handover link is sent instead of one', async () => {
    const response = await signUp({ email: BUYER, password: PASSWORD, handover_token: 'h'.repeat(43) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'Enter a valid invitation code.' });
    expect(db.created).toEqual([]);
  });
});
