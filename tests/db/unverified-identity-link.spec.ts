import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { createTestAdminClient } from '@/tests/e2e/helpers/supabase';
import {
  createThrowawayRider,
  deleteThrowawayRider,
  type ThrowawayRider,
} from '@/tests/e2e/helpers/throwaway-rider';
import { anonClient } from '@/tests/db/helpers/rider';
import { runAsAuthAdmin } from '@/tests/db/helpers/auth-database';

/**
 * An external sign-in whose provider has not verified the email never joins an
 * existing account, and never starts one (20261004002700).
 *
 * GoTrue links a Google sign-in into the account that already holds its email
 * address, and with "Confirm email" off it does that whatever the provider's
 * `email_verified` claim says - so an unverified Google address for a rider's
 * email was handed a session on that rider's account. Linking is GoTrue
 * inserting one row into `auth.identities` with the existing user's id, and
 * that insert is where the gate sits. A new account is the same insert as its
 * first identity, and is refused too: an unverified sign-in that created an
 * account for an address would have its real owner's later verified sign-in
 * linked into it.
 *
 * Each case writes that row exactly as GoTrue does - as `supabase_auth_admin`,
 * onto a rider GoTrue itself created through the admin API - because a real
 * Google round trip cannot run here. The whole OAuth flow was walked once by
 * hand against a stub issuer, before and after the migration; the pull request
 * that added this carries that run.
 */

let rider: ThrowawayRider | null = null;

test.afterEach(async () => {
  await deleteThrowawayRider(rider);
  rider = null;
});

function googleIdentityData(email: string, verified: unknown, sub: string): string {
  const data: Record<string, unknown> = {
    iss: 'https://accounts.google.com',
    sub,
    email,
    name: 'Test Rider',
    provider_id: sub,
  };
  if (verified !== undefined) data.email_verified = verified;
  return JSON.stringify(data).replace(/'/g, "''");
}

/** The insert GoTrue makes when it links `provider` into the rider's account. */
function linkIdentitySql(userId: string, email: string, verified: unknown, provider = 'google'): string {
  const sub = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  return `
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values ('${sub}', '${userId}', '${googleIdentityData(email, verified, sub)}'::jsonb, '${provider}', now(), now(), now());
  `;
}

function linkIdentity(userId: string, email: string, verified: unknown, provider = 'google') {
  return runAsAuthAdmin(linkIdentitySql(userId, email, verified, provider));
}

/** The runbook's precheck for the hosted paste, as a person would run it in the SQL editor. */
function runbookPrecheck(): string {
  const marker = '-- hosted-unverified-identity-link-precheck';
  const runbook = readFileSync(path.join(process.cwd(), 'docs/beta-runbook.md'), 'utf8');
  const start = runbook.indexOf(marker);
  if (start === -1) throw new Error(`docs/beta-runbook.md has no block opening with ${marker}`);
  const end = runbook.indexOf('\n```', start);
  if (end === -1) throw new Error(`the block opening with ${marker} never closes`);
  return runbook.slice(start, end);
}

/**
 * `unverified_identities_already_present` before and after `sql`, read in the same
 * transaction so nothing else on the stack moves it in between.
 */
function precheckCountAround(sql: string): [number, number] {
  const precheck = runbookPrecheck();
  const result = runAsAuthAdmin(`${precheck}\n${sql}\n${precheck}`);
  expect(result.ok, result.stderr).toBe(true);
  const counts = result.stdout
    .split('\n')
    .filter((line) => line.includes('|'))
    .map((line) => Number(line.split('|').at(-1)));
  expect(counts).toHaveLength(2);
  return [counts[0], counts[1]];
}

async function providersOf(userId: string): Promise<string[]> {
  const { data, error } = await createTestAdminClient().auth.admin.getUserById(userId);
  expect(error, error?.message).toBeNull();
  return (data.user!.identities ?? []).map((identity) => identity.provider).sort();
}

test.describe('linking an external identity into an existing account', () => {
  test('refuses a Google identity whose email is unverified, and leaves the account as it was', async () => {
    rider = await createThrowawayRider('unverified-link');

    const result = linkIdentity(rider.id, rider.email, false);

    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('refusing an unverified google email');
    expect(await providersOf(rider.id)).toEqual(['email']);

    // The rider's own way in still works and still lands on their account.
    const { data, error } = await anonClient().auth.signInWithPassword({ email: rider.email, password: rider.password });
    expect(error, error?.message).toBeNull();
    expect(data.user!.id).toBe(rider.id);
  });

  test('refuses one that carries no email_verified claim at all', async () => {
    rider = await createThrowawayRider('unverified-link');

    const result = linkIdentity(rider.id, rider.email, undefined);

    expect(result.ok).toBe(false);
    expect(await providersOf(rider.id)).toEqual(['email']);
  });

  test('refuses an unverified identity from any external provider, not only Google', async () => {
    rider = await createThrowawayRider('unverified-link');

    const result = linkIdentity(rider.id, rider.email, 'false', 'apple');

    expect(result.ok).toBe(false);
    expect(await providersOf(rider.id)).toEqual(['email']);
  });

  test('still links a Google identity whose email is verified', async () => {
    rider = await createThrowawayRider('unverified-link');

    const result = linkIdentity(rider.id, rider.email, true);

    expect(result.ok, result.stderr).toBe(true);
    expect(await providersOf(rider.id)).toEqual(['email', 'google']);
  });

  test('accepts the claim sent as the string "true", the way Apple sends it', async () => {
    rider = await createThrowawayRider('unverified-link');

    const result = linkIdentity(rider.id, rider.email, 'true', 'apple');

    expect(result.ok, result.stderr).toBe(true);
    expect(await providersOf(rider.id)).toEqual(['apple', 'email']);
  });
});

/** GoTrue's CreateAccount: the user row, then its first identity, in one transaction. */
function createAccountWithIdentity(userId: string, email: string, verified: unknown) {
  const sub = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  return runAsAuthAdmin(`
    insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', '${userId}', 'authenticated', 'authenticated', '${email}',
            '{"provider":"google","providers":["google"]}', '{}', now(), now());
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values ('${sub}', '${userId}', '${googleIdentityData(email, verified, sub)}'::jsonb, 'google', now(), now(), now());
  `);
}

test.describe('a new account from an external sign-in', () => {
  // Read back in SQL: a user row written by hand lacks the empty-string token
  // columns GoTrue's own loader expects, so the admin API cannot read it.
  test('is refused when its email is unverified, so no account ever holds that address', async () => {
    const userId = randomUUID();

    try {
      const result = createAccountWithIdentity(userId, `unverified-new-${randomUUID()}@example.com`, false);

      expect(result.ok).toBe(false);
      expect(result.stderr).toContain('refusing an unverified google email');
      expect(runAsAuthAdmin(`select count(*) from auth.users where id = '${userId}';`).stdout).toBe('0');
    } finally {
      runAsAuthAdmin(`delete from auth.users where id = '${userId}';`);
    }
  });

  test('is created when its email is verified', async () => {
    const userId = randomUUID();

    try {
      const result = createAccountWithIdentity(userId, `verified-new-${randomUUID()}@example.com`, true);

      expect(result.ok, result.stderr).toBe(true);
      expect(runAsAuthAdmin(`select provider from auth.identities where user_id = '${userId}';`).stdout).toBe('google');
    } finally {
      runAsAuthAdmin(`delete from auth.users where id = '${userId}';`);
    }
  });
});

test.describe("the runbook's precheck for identities stored before the gate existed", () => {
  test('counts an unverified Google identity linked beside an existing sign-in', async () => {
    rider = await createThrowawayRider('unverified-link');
    expect(linkIdentity(rider.id, rider.email, true).ok).toBe(true);

    // The gate reads inserts only, so turning the claim false afterwards leaves
    // the row a hosted project could hold from before the trigger was applied.
    const [before, after] = precheckCountAround(`
      update auth.identities
         set identity_data = jsonb_set(identity_data, '{email_verified}', 'false')
       where user_id = '${rider.id}' and provider = 'google';
    `);

    expect(after - before).toBe(1);
  });

  test('does not count a verified one', async () => {
    rider = await createThrowawayRider('unverified-link');

    const [before, after] = precheckCountAround(linkIdentitySql(rider.id, rider.email, true));

    expect(after).toBe(before);
  });
});
