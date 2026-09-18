import { randomUUID } from 'node:crypto';
import { expect } from '@playwright/test';
import { createTestAdminClient } from '@/tests/e2e/helpers/supabase';

export interface ThrowawayRider {
  id: string;
  email: string;
  password: string;
}

/**
 * A confirmed rider of the calling test's own.
 *
 * The shared E2E account is signed into by six device projects at once, so a
 * spec that counts rows or deletes them cannot share it. Deleting the user
 * afterwards cascades every vehicle, session and lap it owns.
 */
export async function createThrowawayRider(label: string): Promise<ThrowawayRider> {
  const email = `${label}-${randomUUID()}@example.com`;
  const password = `pw-${randomUUID()}`;
  const { data, error } = await createTestAdminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  expect(error, error?.message).toBeNull();
  return { id: data.user!.id, email, password };
}

export async function deleteThrowawayRider(rider: ThrowawayRider | null): Promise<void> {
  if (!rider) return;
  await createTestAdminClient().auth.admin.deleteUser(rider.id);
}
