import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Signing up while signups are invite-only. An invitation code admits its
 * address, as it always has; a pending, unexpired handover admits the address
 * a seller handed a bike to (owner, 2026-10-19), and nothing else does.
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

const TOKEN = 'h'.repeat(43);
const BUYER = 'buyer@example.com';
const PASSWORD = 'correct-horse';
const tokenHash = (token: string) => createHash('sha256').update(token, 'utf8').digest('hex');
const future = () => new Date(Date.now() + 86_400_000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

function handover(partial: Row = {}): Row {
  return { id: 'transfer-1', token_hash: tokenHash(TOKEN), to_email_normalized: BUYER, status: 'pending', expires_at: future(), ...partial };
}

function signUp(body: Row) {
  return POST(new Request('http://127.0.0.1:3000/api/beta/signup', { method: 'POST', body: JSON.stringify(body) }));
}

beforeEach(() => {
  db.tables = { service_book_transfers: [handover()], beta_invites: [] };
  db.created = [];
  db.upserts = [];
});

describe('POST /api/beta/signup with a handover link', () => {
  it('creates a free account for the address a pending handover was sent to, with no code', async () => {
    const response = await signUp({ email: ' Buyer@Example.com ', password: PASSWORD, handover_token: TOKEN });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(db.created).toEqual([{ email: BUYER }]);
    expect(db.upserts).toEqual([{ table: 'profiles', row: { id: 'user-1', tier: 'free' } }]);
  });

  it.each([
    ['another address', { email: 'someone@example.com' }, {}],
    ['an expired handover', {}, { expires_at: past() }],
    ['a cancelled handover', {}, { status: 'cancelled' }],
    ['an accepted handover', {}, { status: 'accepted' }],
    ['a token no handover holds', { handover_token: 'x'.repeat(43) }, {}],
  ])('refuses %s and creates nothing', async (_case, override, row) => {
    db.tables.service_book_transfers = [handover(row)];
    const response = await signUp({ email: BUYER, password: PASSWORD, handover_token: TOKEN, ...override });

    expect(response.status).toBe(400);
    expect((await response.json()).ok).toBe(false);
    expect(db.created).toEqual([]);
  });

  it('still asks for a code when no handover link came with the request', async () => {
    const response = await signUp({ email: BUYER, password: PASSWORD });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'Enter a valid invitation code.' });
    expect(db.created).toEqual([]);
  });
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

  it('judges a request carrying a code by the code, even beside a handover link', async () => {
    const response = await signUp({ email: BUYER, password: PASSWORD, invite_code: 'WRONG', handover_token: TOKEN });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: 'That invitation is invalid or has expired.' });
    expect(db.created).toEqual([]);
  });
});
