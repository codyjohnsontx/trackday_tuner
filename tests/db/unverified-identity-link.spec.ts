import { randomUUID } from 'node:crypto';
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
 * existing account (20261004002700).
 *
 * GoTrue links a Google sign-in into the account that already holds its email
 * address, and with "Confirm email" off it does that whatever the provider's
 * `email_verified` claim says - so an unverified Google address for a rider's
 * email was handed a session on that rider's account. Linking is GoTrue
 * inserting one row into `auth.identities` with the existing user's id, and
 * that insert is where the gate sits.
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
function linkIdentity(userId: string, email: string, verified: unknown, provider = 'google') {
  const sub = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  return runAsAuthAdmin(`
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values ('${sub}', '${userId}', '${googleIdentityData(email, verified, sub)}'::jsonb, '${provider}', now(), now(), now());
  `);
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
    expect(result.stderr).toContain('refusing to link an unverified google email into an existing account');
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

test('a new account from an unverified Google sign-in is not blocked - there is nothing for it to join', async () => {
  // GoTrue's CreateAccount: the user row, then its first identity, in one transaction.
  const userId = randomUUID();
  const email = `unverified-new-${randomUUID()}@example.com`;
  const sub = `${Date.now()}`;
  const result = runAsAuthAdmin(`
    insert into auth.users (instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values ('00000000-0000-0000-0000-000000000000', '${userId}', 'authenticated', 'authenticated', '${email}',
            '{"provider":"google","providers":["google"]}', '{}', now(), now());
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values ('${sub}', '${userId}', '${googleIdentityData(email, false, sub)}'::jsonb, 'google', now(), now(), now());
  `);

  try {
    expect(result.ok, result.stderr).toBe(true);
    // Read back in SQL: a user row written by hand lacks the empty-string token
    // columns GoTrue's own loader expects, so the admin API cannot read it.
    expect(runAsAuthAdmin(`select provider from auth.identities where user_id = '${userId}';`).stdout).toBe('google');
  } finally {
    runAsAuthAdmin(`delete from auth.users where id = '${userId}';`);
  }
});
