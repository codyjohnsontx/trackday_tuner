import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createTestAdminClient } from '@/tests/e2e/helpers/supabase';
import { createThrowawayRider, deleteThrowawayRider, type ThrowawayRider } from '@/tests/e2e/helpers/throwaway-rider';
import { anonClient, createVehicle, signIn, type Client } from '@/tests/db/helpers/rider';

/**
 * Share links to a service book and the owner's time zone (20261016000500), on
 * a real database:
 *
 * - a rider makes a link for their own book and no other, and the server dates
 *   it, names its maker and zeroes its counters whatever the insert says;
 * - another rider and nobody can neither read nor write a link, and nobody
 *   reaches the table at all;
 * - a revoke is dated by the server and never undone;
 * - `open_service_book_share` answers only for an unrevoked link, counts a page
 *   view and not an attachment tap, holds a link to its rate limit without
 *   counting the refused view, leaves no row behind for a token that opens
 *   nothing, and only the service role may call it;
 * - `owner_time_zone` is the owner's to write, in the shape of a zone name.
 *
 * Part of `npm run test:db` - see playwright.db.config.ts.
 */

function newTokenHash(): string {
  return createHash('sha256').update(randomBytes(32).toString('base64url')).digest('hex');
}

test.describe('service book share links', () => {
  let admin: Client;
  const riders: ThrowawayRider[] = [];

  async function newOwner(label: string) {
    const rider = await createThrowawayRider(`shares-${label}`);
    riders.push(rider);
    const client = await signIn(rider);
    const vehicle = await createVehicle(client, rider.id);
    const book = await client.from('service_books').insert({ vehicle_id: vehicle }).select('id').single();
    expect(book.error, book.error?.message).toBeNull();
    return { rider, client, vehicle, book: book.data!.id };
  }

  async function share(client: Client, book: string, tokenHash = newTokenHash()) {
    const made = await client.from('service_book_shares').insert({ book_id: book, token_hash: tokenHash }).select('*').single();
    expect(made.error, made.error?.message).toBeNull();
    return { row: made.data!, tokenHash };
  }

  function open(tokenHash: string, options: { countView?: boolean; limit?: number } = {}) {
    return admin.rpc('open_service_book_share', {
      p_token_hash: tokenHash,
      p_count_view: options.countView ?? true,
      p_limit: options.limit ?? 120,
      p_window_seconds: 3600,
    });
  }

  test.beforeAll(() => {
    admin = createTestAdminClient();
  });

  test.afterAll(async () => {
    for (const rider of riders) await deleteThrowawayRider(rider);
  });

  test('a rider makes a link for their own book, and the server writes everything but the book and the hash', async () => {
    const { rider, client, book } = await newOwner('make');
    const before = Date.now();
    const { row } = await share(client, book);
    expect(row.created_by).toBe(rider.id);
    expect(row.view_count).toBe(0);
    expect(row.revoked_at).toBeNull();
    expect(Math.abs(Date.parse(row.created_at) - before)).toBeLessThan(60_000);

    // Columns a rider holds no insert on are refused outright.
    const dated = await client
      .from('service_book_shares')
      .insert({ book_id: book, token_hash: newTokenHash(), view_count: 99 } as never)
      .select('id');
    expect(dated.error?.code).toBe('42501');
    const counted = await client.from('service_book_shares').update({ view_count: 99 } as never).eq('id', row.id).select('id');
    expect(counted.error?.code).toBe('42501');
  });

  test('another rider and nobody cannot read or write a link', async () => {
    const owner = await newOwner('owner');
    const other = await newOwner('other');
    const { row } = await share(owner.client, owner.book);

    const read = await other.client.from('service_book_shares').select('id').eq('id', row.id);
    expect(read.error, read.error?.message).toBeNull();
    expect(read.data).toEqual([]);

    const planted = await other.client.from('service_book_shares').insert({ book_id: owner.book, token_hash: newTokenHash() }).select('id');
    expect(planted.error?.code).toBe('42501');

    const revoked = await other.client.from('service_book_shares').update({ revoked_at: new Date().toISOString() }).eq('id', row.id).select('id');
    expect(revoked.error, revoked.error?.message).toBeNull();
    expect(revoked.data).toEqual([]);

    const anonymous = await anonClient().from('service_book_shares').select('id');
    expect(anonymous.error?.code).toBe('42501');
  });

  test('a revoke is dated by the server and never undone', async () => {
    const { client, book } = await newOwner('revoke');
    const { row } = await share(client, book);
    const before = Date.now();

    const revoked = await client.from('service_book_shares').update({ revoked_at: '2000-01-01T00:00:00Z' }).eq('id', row.id).select('revoked_at').single();
    expect(revoked.error, revoked.error?.message).toBeNull();
    const revokedAt = revoked.data!.revoked_at!;
    expect(Math.abs(Date.parse(revokedAt) - before)).toBeLessThan(60_000);

    const restored = await client.from('service_book_shares').update({ revoked_at: null }).eq('id', row.id).select('revoked_at').single();
    expect(restored.error, restored.error?.message).toBeNull();
    expect(restored.data!.revoked_at).toBe(revokedAt);

    const viaService = await admin.from('service_book_shares').update({ revoked_at: null }).eq('id', row.id).select('revoked_at').single();
    expect(viaService.data!.revoked_at).toBe(revokedAt);
  });

  test('opening a link names its book, counts page views only, and stops at a revoke', async () => {
    const { client, book } = await newOwner('open');
    const { row, tokenHash } = await share(client, book);

    const first = await open(tokenHash);
    expect(first.error, first.error?.message).toBeNull();
    expect(first.data).toEqual([{ book_id: book, rate_limited: false }]);
    await open(tokenHash, { countView: false });

    const counted = await admin.from('service_book_shares').select('view_count, last_viewed_at').eq('id', row.id).single();
    expect(counted.data!.view_count).toBe(1);
    expect(counted.data!.last_viewed_at).not.toBeNull();

    await client.from('service_book_shares').update({ revoked_at: new Date().toISOString() }).eq('id', row.id);
    const after = await open(tokenHash);
    expect(after.error, after.error?.message).toBeNull();
    expect(after.data).toEqual([]);
  });

  test('a link is held to its rate limit, and a refused view is not counted', async () => {
    const { client, book } = await newOwner('limit');
    const { row, tokenHash } = await share(client, book);

    expect((await open(tokenHash, { limit: 2 })).data).toEqual([{ book_id: book, rate_limited: false }]);
    expect((await open(tokenHash, { limit: 2, countView: false })).data).toEqual([{ book_id: book, rate_limited: false }]);
    expect((await open(tokenHash, { limit: 2 })).data).toEqual([{ book_id: null, rate_limited: true }]);

    const counted = await admin.from('service_book_shares').select('view_count').eq('id', row.id).single();
    expect(counted.data!.view_count).toBe(1);
  });

  test('a token that opens nothing writes nothing', async () => {
    const guessed = newTokenHash();
    const answer = await open(guessed);
    expect(answer.error, answer.error?.message).toBeNull();
    expect(answer.data).toEqual([]);

    const limits = await admin.from('beta_rate_limits').select('key_hash').eq('key_hash', `service-book-share:${guessed}`);
    expect(limits.error, limits.error?.message).toBeNull();
    expect(limits.data).toEqual([]);
  });

  test('only the service role may open a link', async () => {
    const { client, book } = await newOwner('callers');
    const { tokenHash } = await share(client, book);
    const args = { p_token_hash: tokenHash, p_count_view: true, p_limit: 120, p_window_seconds: 3600 };

    for (const caller of [client, anonClient()]) {
      const refused = await caller.rpc('open_service_book_share', args);
      expect(refused.error?.code).toBe('42501');
    }
  });

  test('the owner records their zone, in the shape of a zone name, on their own book only', async () => {
    const owner = await newOwner('zone');
    const other = await newOwner('zone-other');

    const set = await owner.client.from('service_books').update({ owner_time_zone: 'America/Chicago' }).eq('id', owner.book).select('owner_time_zone').single();
    expect(set.error, set.error?.message).toBeNull();
    expect(set.data!.owner_time_zone).toBe('America/Chicago');

    const malformed = await owner.client.from('service_books').update({ owner_time_zone: "'; drop table x; --" }).eq('id', owner.book).select('id');
    expect(malformed.error?.code).toBe('23514');

    const foreign = await other.client.from('service_books').update({ owner_time_zone: 'UTC' }).eq('id', owner.book).select('id');
    expect(foreign.error, foreign.error?.message).toBeNull();
    expect(foreign.data).toEqual([]);
    const stored = await admin.from('service_books').select('owner_time_zone').eq('id', owner.book).single();
    expect(stored.data!.owner_time_zone).toBe('America/Chicago');
  });
});
