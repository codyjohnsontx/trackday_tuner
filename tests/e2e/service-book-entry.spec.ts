import { test, expect, type Page } from '@playwright/test';
import { signInWith } from '@/tests/e2e/helpers/auth';
import { gotoPage } from '@/tests/e2e/helpers/navigation';
import { createTestAdminClient, expectRows, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { createThrowawayRider, deleteThrowawayRider, type ThrowawayRider } from '@/tests/e2e/helpers/throwaway-rider';

/**
 * A rider starts their bike's service book, logs an oil change, edits it, and
 * reads the honest-history labels and the revision list the database kept.
 *
 * What is read back is the words a buyer will read: an entry logged the day of
 * the work says so, an untouched one says "Unedited", and one edit says
 * "Edited once" with a revision list that still holds what was there before.
 * The database is read afterwards, because the page moving on proves nothing
 * about the rows.
 */

const NICKNAME = 'Book Test R6';

async function plantVehicle(riderId: string): Promise<string> {
  const { data, error } = await createTestAdminClient()
    .from('vehicles')
    .insert({ user_id: riderId, nickname: NICKNAME, type: 'motorcycle' })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  return data!.id;
}

/** Controlled inputs drop text typed before React hydrates, so retry until the value sticks. */
async function fillField(page: Page, label: string | RegExp, value: string) {
  const field = page.getByLabel(label);
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value);
  }).toPass({ timeout: 10_000 });
}

function todayHere(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

test.describe('the service book', () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(!hasServiceRole(), 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  let rider: ThrowawayRider | null = null;

  test.beforeEach(async () => {
    rider = await createThrowawayRider('service-book');
  });

  test.afterEach(async () => {
    await deleteThrowawayRider(rider);
    rider = null;
  });

  test('logs an entry, edits it, and reads the labels and the revision list', async ({ page }) => {
    const vehicleId = await plantVehicle(rider!.id);
    await signInWith(page, rider!.email, rider!.password);

    // The garage card links to the book, and a bike with none offers to start one.
    await gotoPage(page, '/garage');
    await page.getByRole('link', { name: 'Service book' }).click();
    await expect(page).toHaveURL(new RegExp(`/garage/${vehicleId}/book$`));
    await expect(page.getByRole('heading', { name: `Start the service book for ${NICKNAME}` })).toBeVisible();
    await page.getByRole('button', { name: 'Start service book' }).click();
    await expect(page.getByText('Engine oil and filter')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('No reading yet')).toBeVisible();

    // The form opens on the rider's own day with nothing pressed for "Done by".
    await page.getByRole('link', { name: '+ Log service' }).click();
    await expect(page).toHaveURL(new RegExp(`/garage/${vehicleId}/book/entries/new$`));
    await expect(page.getByLabel('Service date')).toHaveValue(todayHere());
    const doneBy = page.getByRole('group', { name: 'Done by' });
    for (const label of ['Myself', 'A shop']) {
      await expect(doneBy.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }

    const items = page.getByRole('group', { name: 'Items' });
    await items.getByRole('button', { name: 'Engine oil and filter' }).click();
    await expect(items.getByRole('button', { name: 'Engine oil and filter' })).toHaveAttribute('aria-pressed', 'true');
    await fillField(page, 'Hours', '41.5');
    await doneBy.getByRole('button', { name: 'Myself' }).click();
    await fillField(page, 'Cost ($)', '68.50');
    await page.getByRole('button', { name: '+ Add part' }).click();
    await fillField(page, 'Brand', 'Motul');
    await fillField(page, 'Quantity', '3.4');
    await fillField(page, 'Notes', 'Drained hot, new crush washer.');
    await page.getByRole('button', { name: 'Save entry' }).click();

    await expect(page).toHaveURL(new RegExp(`/garage/${vehicleId}/book$`), { timeout: 20_000 });
    const row = page.getByTestId('service-entry-row').first();
    await expect(row).toContainText('Engine oil and filter');
    await expect(row).toContainText('41.5 h');
    await expect(row.getByText('Logged the day of service')).toBeVisible();
    await expect(row.getByText('Unedited')).toBeVisible();
    // The entry's reading is now the book's usage.
    await expect(page.getByText('Last reading 41.5 h on')).toBeVisible();

    const admin = createTestAdminClient();
    const entries = expectRows(await admin.from('service_entries').select('id, revision, notes, logged_at, service_date').is('deleted_at', null), 'entries after save');
    expect(entries).toHaveLength(1);
    expect(entries[0].revision).toBe(1);
    expect(entries[0].service_date).toBe(todayHere());
    const entryId = entries[0].id;
    expect(expectRows(await admin.from('service_entry_items').select('label').eq('entry_id', entryId), 'items after save')).toEqual([
      { label: 'Engine oil and filter' },
    ]);
    expect(expectRows(await admin.from('service_entry_parts').select('brand, quantity').eq('entry_id', entryId), 'parts after save')).toEqual([
      { brand: 'Motul', quantity: 3.4 },
    ]);
    expect(expectRows(await admin.from('vehicle_readings').select('hours, source').eq('entry_id', entryId), 'reading after save')).toEqual([
      { hours: 41.5, source: 'entry' },
    ]);

    // Edit the notes. The revision list keeps what was there.
    await row.click();
    await expect(page).toHaveURL(new RegExp(`/garage/${vehicleId}/book/entries/${entryId}$`));
    await expect(page.getByTestId('entry-revision')).toHaveCount(1);
    await expect(page.getByTestId('entry-revision').first()).toContainText('Logged');
    await fillField(page, 'Notes', 'Drained hot, new crush washer. Torqued the drain plug to 43 Nm.');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page).toHaveURL(new RegExp(`/garage/${vehicleId}/book$`), { timeout: 20_000 });
    await expect(row.getByText('Edited once, last on')).toBeVisible();
    await expect(row.getByText('Logged the day of service')).toBeVisible();

    await row.click();
    const revisions = page.getByTestId('entry-revision');
    await expect(revisions).toHaveCount(2);
    await expect(revisions.nth(0)).toContainText('Edited');
    await expect(revisions.nth(0)).toContainText('revision 2');
    await expect(revisions.nth(1)).toContainText('Logged');
    await expect(page.getByText('Drained hot, new crush washer.', { exact: true })).toBeVisible();

    const edited = expectRows(await admin.from('service_entries').select('revision').eq('id', entryId), 'entry after edit');
    expect(edited[0].revision).toBe(2);
    expect(
      expectRows(await admin.from('service_entry_revisions').select('revision, kind').eq('entry_id', entryId).order('revision'), 'history after edit'),
    ).toEqual([
      { revision: 1, kind: 'created' },
      { revision: 2, kind: 'edited' },
    ]);
  });

  test('removes an entry from the book and keeps it in the history', async ({ page }) => {
    const vehicleId = await plantVehicle(rider!.id);
    const admin = createTestAdminClient();
    const book = await admin.from('service_books').insert({ vehicle_id: vehicleId }).select('id').single();
    expect(book.error, book.error?.message).toBeNull();
    const entry = await admin
      .from('service_entries')
      .insert({ book_id: book.data!.id, service_date: '2026-09-01', notes: 'Chain cleaned.', logged_by: rider!.id })
      .select('id')
      .single();
    expect(entry.error, entry.error?.message).toBeNull();
    const item = await admin.from('service_entry_items').insert({ entry_id: entry.data!.id, label: 'Chain and sprockets' });
    expect(item.error, item.error?.message).toBeNull();

    await signInWith(page, rider!.email, rider!.password);
    await gotoPage(page, `/garage/${vehicleId}/book/entries/${entry.data!.id}`);
    await expect(page.getByRole('heading', { name: 'Chain and sprockets' })).toBeVisible();

    const remove = page.getByRole('button', { name: 'Hold to remove' });
    await remove.hover();
    await page.mouse.down();
    await page.waitForTimeout(1300);
    await page.mouse.up();

    await expect(page).toHaveURL(new RegExp(`/garage/${vehicleId}/book$`), { timeout: 20_000 });
    await expect(page.getByTestId('service-entry-row')).toHaveCount(0);
    await page.getByRole('link', { name: 'Show removed entries' }).click();
    await expect(page.getByTestId('service-entry-row')).toHaveCount(1);
    await expect(page.getByTestId('service-entry-row').first()).toContainText('Removed');

    const stored = expectRows(await admin.from('service_entries').select('deleted_at').eq('id', entry.data!.id), 'entry after remove');
    expect(stored[0].deleted_at).not.toBeNull();
    expect(
      expectRows(await admin.from('service_entry_revisions').select('kind').eq('entry_id', entry.data!.id).order('revision'), 'history after remove').map(
        ({ kind }) => kind,
      ),
    ).toEqual(['created', 'edited', 'deleted']);
  });
});
