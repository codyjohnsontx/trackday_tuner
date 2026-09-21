import { test, expect, type Page } from '@playwright/test';
import { signInWith } from '@/tests/e2e/helpers/auth';
import { gotoPage } from '@/tests/e2e/helpers/navigation';
import { createTestAdminClient, expectRows, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { EMPTY_SUSPENSION, EMPTY_TIRES } from '@/tests/e2e/helpers/session-fixtures';
import {
  createThrowawayRider,
  deleteThrowawayRider,
  type ThrowawayRider,
} from '@/tests/e2e/helpers/throwaway-rider';

/**
 * A free rider sells their bike and needs the garage slot back.
 *
 * `deleteVehicle` had no caller, so the free plan's one-vehicle cap was a wall.
 * Deleting a bike deletes every session on it through the foreign-key cascade,
 * so the confirmation states the sessions and laps in the rider's own numbers
 * and the button stays off until the bike's nickname is typed. The database is
 * read afterwards, because the page moving on proves nothing about the rows.
 */

const NICKNAME = 'Gate Test R6';

async function plantSession(riderId: string, vehicleId: string, date: string): Promise<string> {
  const { data, error } = await createTestAdminClient()
    .from('sessions')
    .insert({
      user_id: riderId,
      vehicle_id: vehicleId,
      track_name: 'PW Vehicle Delete Circuit',
      date,
      conditions: 'sunny' as const,
      tires: EMPTY_TIRES,
      suspension: EMPTY_SUSPENSION,
    })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  return data!.id;
}

async function plantVehicle(riderId: string): Promise<string> {
  const { data, error } = await createTestAdminClient()
    .from('vehicles')
    .insert({ user_id: riderId, nickname: NICKNAME, type: 'motorcycle' })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  return data!.id;
}

async function typeNickname(page: Page, value: string) {
  const field = page.getByLabel(`Type ${NICKNAME} to confirm`);
  // Controlled input: text typed before React hydrates is dropped, so retry
  // until the value is in React's state, not just the DOM.
  await expect(async () => {
    await field.fill('');
    await field.fill(value);
    await expect(field).toHaveValue(value);
  }).toPass({ timeout: 10_000 });
}

test.describe('deleting a vehicle', () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(!hasServiceRole(), 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  let rider: ThrowawayRider | null = null;

  test.beforeEach(async () => {
    rider = await createThrowawayRider('vehicle-delete');
  });

  test.afterEach(async () => {
    await deleteThrowawayRider(rider);
    rider = null;
  });

  test('states the cascade, waits for the nickname, and frees the free-plan slot', async ({ page }) => {
    const vehicleId = await plantVehicle(rider!.id);
    const first = await plantSession(rider!.id, vehicleId, '2019-09-07');
    const second = await plantSession(rider!.id, vehicleId, '2019-09-08');
    const { error: lapError } = await createTestAdminClient()
      .from('session_laps')
      .insert(
        [1, 2, 3].map((lap_number) => ({
          user_id: rider!.id,
          session_id: first,
          lap_number,
          lap_time_ms: 100_000 + lap_number,
        })),
      );
    expect(lapError, lapError?.message).toBeNull();

    await signInWith(page, rider!.email, rider!.password);

    // The free plan's one vehicle is taken, which is why this rider is here.
    await gotoPage(page, '/garage/new');
    await expect(page.getByRole('heading', { name: 'Add Vehicle' })).toHaveCount(0);

    await gotoPage(page, `/garage/${vehicleId}/edit`);
    await expect(
      page.getByText(
        `Deleting ${NICKNAME} also deletes both sessions you logged on it and 3 lap times, with their setups, notes and outcomes. This cannot be undone.`,
      ),
    ).toBeVisible();

    const button = page.getByRole('button', { name: 'Delete vehicle' });
    await expect(button).toBeDisabled();
    await typeNickname(page, 'Gate Test');
    await expect(button).toBeDisabled();
    // A phone keyboard's own capitalisation is not a reason to refuse.
    await typeNickname(page, 'gate test r6');
    await expect(button).toBeEnabled();

    await button.click();
    await expect(page).toHaveURL(/\/garage$/, { timeout: 20_000 });

    const admin = createTestAdminClient();
    expect(expectRows(await admin.from('vehicles').select('id').eq('id', vehicleId), 'vehicle after delete')).toHaveLength(0);
    expect(
      expectRows(await admin.from('sessions').select('id').in('id', [first, second]), 'sessions after delete'),
    ).toHaveLength(0);
    expect(
      expectRows(await admin.from('session_laps').select('id').eq('session_id', first), 'laps after delete'),
    ).toHaveLength(0);

    await gotoPage(page, '/garage/new');
    await expect(page.getByRole('heading', { name: 'Add Vehicle' })).toBeVisible();
  });

  test('refuses when a session was logged after the rider read the count', async ({ page }) => {
    const vehicleId = await plantVehicle(rider!.id);
    await plantSession(rider!.id, vehicleId, '2019-09-07');

    await signInWith(page, rider!.email, rider!.password);
    await gotoPage(page, `/garage/${vehicleId}/edit`);
    await expect(page.getByText(/also deletes the 1 session you logged on it,/)).toBeVisible();

    // Logged from another tab while this confirmation sat open.
    await plantSession(rider!.id, vehicleId, '2019-09-08');

    await typeNickname(page, NICKNAME);
    await page.getByRole('button', { name: 'Delete vehicle' }).click();

    await expect(
      page.getByRole('alert').filter({ hasText: 'The sessions on this vehicle changed since this page loaded' }),
    ).toBeVisible();
    expect(
      expectRows(
        await createTestAdminClient().from('vehicles').select('id').eq('id', vehicleId),
        'vehicle after refused delete',
      ),
    ).toHaveLength(1);
  });

  test('tells the rider when the delete finds no vehicle, and stays put', async ({ page }) => {
    const vehicleId = await plantVehicle(rider!.id);

    await signInWith(page, rider!.email, rider!.password);
    await gotoPage(page, `/garage/${vehicleId}/edit`);
    await expect(page.getByText(/No sessions are logged on it, so nothing else is lost\./)).toBeVisible();

    // Deleted out from under the open page - another tab, another device.
    expect(
      expectRows(
        await createTestAdminClient().from('vehicles').delete().eq('id', vehicleId).select('id'),
        'deleting the vehicle under the open page',
      ),
    ).toHaveLength(1);

    await typeNickname(page, NICKNAME);
    await page.getByRole('button', { name: 'Delete vehicle' }).click();

    await expect(page.getByRole('alert').filter({ hasText: 'This vehicle could not be found.' })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/garage/${vehicleId}/edit$`));
  });
});
