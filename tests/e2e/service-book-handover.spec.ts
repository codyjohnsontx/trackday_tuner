import { createHash } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { defaultFieldLayout } from '@/lib/service-book/fields';
import { signInWith } from '@/tests/e2e/helpers/auth';
import { gotoPage } from '@/tests/e2e/helpers/navigation';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { createThrowawayRider, deleteThrowawayRider, type ThrowawayRider } from '@/tests/e2e/helpers/throwaway-rider';
import type { Database } from '@/types/supabase';

/**
 * The seller's side of handing a bike to a buyer (owner, PQ2; TQ4, TQ6), as
 * one rider against a stack built from the repository:
 *
 * - the book page links the handover screen, which counts what goes over off
 *   the book's own rows and warns about receipts in one line;
 * - the link is made only once the buyer's email and the bike's nickname are
 *   typed, is shown once, and is `/transfer/<token>` with only the token's
 *   SHA-256 stored (the same shape as a share link);
 * - the pending state then shows on the book, the garage card and the
 *   handover screen itself, with Cancel and no second form;
 * - Cancel withdraws it everywhere, the row reads cancelled, and the screen
 *   offers a new link;
 * - once a buyer accepts (run here as the buyer's client would, since
 *   `vehicles.sold_at` is written by accept alone), the seller's garage reads
 *   Sold, the bike leaves the free vehicle count, the book is the seller's
 *   read-only copy with no save on any of its screens, and the new-session
 *   picker no longer offers the bike (owner, TQ3).
 *
 * The buyer's own screens - opening the link and accepting - are its own spec.
 */

const NICKNAME = 'Handover Test R6';
const BUYER_EMAIL = 'buyer-of-the-r6@example.com';

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function riderClient() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

interface Prepared {
  attachments: { from_object: string; to_object: string; from_thumb: string | null; to_thumb: string | null }[];
  session_photos: { session_id: string; from_path: string; to_path: string }[];
  vehicle_photo: { from_path: string; to_path: string } | null;
}

/**
 * The buyer's accept, as the buyer's client runs it: prepare names the storage
 * objects, the server copies them, accept copies the rows and marks the
 * seller's bike sold. Only accept writes `vehicles.sold_at` - the pin keeps it
 * from every API role, the service role included - so this is the one way to
 * put a seller's screens into the Sold state.
 */
async function acceptAsBuyer(buyer: ThrowawayRider, token: string) {
  const admin = createTestAdminClient();
  const client = riderClient();
  const signedIn = await client.auth.signInWithPassword({ email: buyer.email, password: buyer.password });
  expect(signedIn.error, signedIn.error?.message).toBeNull();
  const prepared = await client.rpc('prepare_service_book_transfer_accept', { p_token: token });
  expect(prepared.error, prepared.error?.message).toBeNull();
  const plan = prepared.data as unknown as Prepared;
  for (const attachment of plan.attachments) {
    expect((await admin.storage.from('service-book').copy(attachment.from_object, attachment.to_object)).error).toBeNull();
    if (attachment.from_thumb && attachment.to_thumb) {
      expect((await admin.storage.from('service-book').copy(attachment.from_thumb, attachment.to_thumb)).error).toBeNull();
    }
  }
  const sessions: Record<string, string> = {};
  for (const photo of plan.session_photos) {
    expect((await admin.storage.from('session-photos').copy(photo.from_path, photo.to_path)).error).toBeNull();
    sessions[photo.session_id] = admin.storage.from('session-photos').getPublicUrl(photo.to_path).data.publicUrl;
  }
  let vehicle: string | null = null;
  if (plan.vehicle_photo) {
    expect((await admin.storage.from('vehicle-photos').copy(plan.vehicle_photo.from_path, plan.vehicle_photo.to_path)).error).toBeNull();
    vehicle = admin.storage.from('vehicle-photos').getPublicUrl(plan.vehicle_photo.to_path).data.publicUrl;
  }
  const accepted = await client.rpc('accept_service_book_transfer', { p_token: token, p_photo_urls: { vehicle, sessions } });
  expect(accepted.error, accepted.error?.message).toBeNull();
}

async function plantBook(rider: ThrowawayRider) {
  const admin = createTestAdminClient();
  const vehicle = await admin
    .from('vehicles')
    .insert({ user_id: rider.id, nickname: NICKNAME, type: 'motorcycle', year: 2019, make: 'Yamaha', model: 'YZF-R6' })
    .select('id')
    .single();
  expect(vehicle.error, vehicle.error?.message).toBeNull();
  const vehicleId = vehicle.data!.id;
  const book = await admin.from('service_books').insert({ vehicle_id: vehicleId }).select('id').single();
  expect(book.error, book.error?.message).toBeNull();
  const bookId = book.data!.id;
  const fields = await admin.from('service_book_fields').insert(defaultFieldLayout().map((field) => ({ ...field, book_id: bookId })));
  expect(fields.error, fields.error?.message).toBeNull();
  const session = await admin.from('sessions').insert({
    user_id: rider.id,
    vehicle_id: vehicleId,
    date: today(),
    conditions: 'sunny',
    tires: {} as Database['public']['Tables']['sessions']['Insert']['tires'],
    suspension: {} as Database['public']['Tables']['sessions']['Insert']['suspension'],
  });
  expect(session.error, session.error?.message).toBeNull();

  // The entry is the rider's own, saved the way the form saves it.
  const client = riderClient();
  const signedIn = await client.auth.signInWithPassword({ email: rider.email, password: rider.password });
  expect(signedIn.error, signedIn.error?.message).toBeNull();
  const saved = await client.rpc('save_service_entry', {
    p_book_id: bookId,
    p_entry_id: null,
    p_entry: { service_date: today(), notes: 'Motul 300V' },
    p_items: [{ item_id: null, label: 'Oil change' }],
    p_parts: null,
  });
  expect(saved.error, saved.error?.message).toBeNull();

  // A receipt on it, stored where the upload flow stores one, so the screen has something to warn about.
  const attachmentId = crypto.randomUUID();
  const objectPath = `${bookId}/${attachmentId}.pdf`;
  const stored = await admin.storage.from('service-book').upload(objectPath, PDF, { contentType: 'application/pdf' });
  expect(stored.error, stored.error?.message).toBeNull();
  const row = await admin.from('service_attachments').insert({
    id: attachmentId,
    book_id: bookId,
    entry_id: saved.data as string,
    kind: 'receipt',
    object_path: objectPath,
    mime: 'application/pdf',
    bytes: PDF.length,
    status: 'ready',
    uploaded_at: new Date().toISOString(),
    created_by: rider.id,
  });
  expect(row.error, row.error?.message).toBeNull();

  return { vehicleId, bookId };
}

test.describe('handing a service book to a buyer', () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(!hasServiceRole(), 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  let rider: ThrowawayRider | null = null;
  let buyer: ThrowawayRider | null = null;

  test.beforeEach(async () => {
    rider = await createThrowawayRider('handover');
  });

  test.afterEach(async () => {
    await deleteThrowawayRider(rider);
    await deleteThrowawayRider(buyer);
    rider = null;
    buyer = null;
  });

  test('the seller makes a link, sees it pending everywhere, and cancels it', async ({ page }) => {
    const admin = createTestAdminClient();
    const { vehicleId, bookId } = await plantBook(rider!);
    await signInWith(page, rider!.email, rider!.password);

    // From the book, to the screen.
    await gotoPage(page, `/garage/${vehicleId}/book`);
    await expect(page.getByTestId('handover-status')).toHaveCount(0);
    await page.getByRole('link', { name: 'Hand over to a buyer' }).click();
    await expect(page.getByRole('heading', { name: 'Hand over to a buyer' })).toBeVisible();

    // The counts come off the book's own rows, and the receipt line warns.
    const goesOver = page.getByTestId('handover-goes-over').getByRole('listitem');
    await expect(goesOver.first()).toContainText('Your service book: 1 entry');
    await expect(goesOver.first()).toContainText('1 receipt or photo');
    await expect(goesOver.nth(1)).toContainText('Your track sessions on this bike: 1 session');
    await expect(page.getByTestId('handover-receipts-warning')).toBeVisible();

    // Nothing is sent until the email and the nickname are typed.
    const submit = page.getByRole('button', { name: 'Make the handover link' });
    await expect(submit).toBeDisabled();
    await page.getByLabel("Buyer's email").fill(BUYER_EMAIL.toUpperCase());
    await expect(submit).toBeDisabled();
    await page.getByLabel(`Type ${NICKNAME} to confirm`).fill(NICKNAME.toLowerCase());
    await expect(submit).toBeEnabled();
    await submit.click();

    // The link, shown once, with only its hash stored.
    const linkField = page.getByTestId('handover-link-url');
    await expect(linkField).toHaveValue(/\/transfer\/[A-Za-z0-9_-]{43}$/);
    const token = (await linkField.inputValue()).split('/transfer/')[1];
    const status = page.getByTestId('handover-status');
    await expect(status).toHaveAttribute('data-state', 'pending');
    await expect(status).toContainText('Handover pending - link expires in 14 days');
    await expect(status).toContainText(`For ${BUYER_EMAIL}`);

    const stored = await admin.from('service_book_transfers').select('status, to_email_normalized, token_hash, expires_at, from_user_id').eq('book_id', bookId).single();
    expect(stored.error, stored.error?.message).toBeNull();
    expect(stored.data).toMatchObject({
      status: 'pending',
      to_email_normalized: BUYER_EMAIL,
      token_hash: createHash('sha256').update(token, 'utf8').digest('hex'),
      from_user_id: rider!.id,
    });
    expect(await page.content()).not.toContain(stored.data!.token_hash);

    // Pending on the garage card, on the book, and on the screen itself - which offers no second form.
    await gotoPage(page, '/garage');
    await expect(page.getByTestId('handover-status')).toHaveAttribute('data-state', 'pending');
    await expect(page.getByTestId('sold-chip')).toHaveCount(0);
    await gotoPage(page, `/garage/${vehicleId}/book/handover`);
    await expect(page.getByTestId('handover-status')).toHaveAttribute('data-state', 'pending');
    await expect(page.getByTestId('handover-form')).toHaveCount(0);
    await gotoPage(page, `/garage/${vehicleId}/book`);
    const bookStatus = page.getByTestId('handover-status');
    await expect(bookStatus).toHaveAttribute('data-state', 'pending');
    // The bike is still the seller's: the book offers every save it did before.
    await expect(page.getByRole('link', { name: '+ Log service' })).toBeVisible();

    // Cancel, and it is gone everywhere.
    await bookStatus.getByRole('button', { name: 'Cancel this handover' }).click();
    await expect(page.getByTestId('handover-status')).toHaveCount(0);
    await expect
      .poll(async () => (await admin.from('service_book_transfers').select('status, cancelled_at').eq('book_id', bookId).single()).data)
      .toMatchObject({ status: 'cancelled' });
    await gotoPage(page, '/garage');
    await expect(page.getByTestId('handover-status')).toHaveCount(0);
    await gotoPage(page, `/garage/${vehicleId}/book/handover`);
    await expect(page.getByTestId('handover-status')).toHaveCount(0);
    await expect(page.getByTestId('handover-form')).toBeVisible();
  });

  test('once the buyer accepts, the seller keeps a read-only copy marked Sold', async ({ page }) => {
    const admin = createTestAdminClient();
    const { vehicleId, bookId } = await plantBook(rider!);
    buyer = await createThrowawayRider('handover-buyer');

    // The seller's link, made as the screen makes it, then accepted as the buyer.
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 11);
    const seller = riderClient();
    expect((await seller.auth.signInWithPassword({ email: rider!.email, password: rider!.password })).error).toBeNull();
    const created = await seller.rpc('create_service_book_transfer', {
      p_book_id: bookId,
      p_to_email: buyer.email,
      p_token_hash: createHash('sha256').update(token, 'utf8').digest('hex'),
      p_handover_hours: 12.5,
      p_handover_distance: null,
      p_time_zone: 'America/Chicago',
    });
    expect(created.error, created.error?.message).toBeNull();
    await acceptAsBuyer(buyer, token);
    const sold = await admin.from('vehicles').select('sold_at').eq('id', vehicleId).single();
    expect(sold.data!.sold_at).not.toBeNull();

    await signInWith(page, rider!.email, rider!.password);

    // The garage: Sold, dated, out of the free count, with Edit and the book still there and no pending line.
    await gotoPage(page, '/garage');
    await expect(page.getByTestId('sold-chip')).toHaveText('Sold');
    await expect(page.getByTestId('sold-line')).toHaveText(/^Sold ?\d{1,2} [A-Z][a-z]{2} \d{4} - history kept$/);
    await expect(page.getByText('Free plan · 0/1 vehicle')).toBeVisible();
    await expect(page.getByRole('link', { name: '+ Add Vehicle' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit →' })).toBeVisible();
    await expect(page.getByTestId('handover-status')).toHaveCount(0);

    // The book: the seller's copy, read-only, with its entry still readable.
    await gotoPage(page, `/garage/${vehicleId}/book`);
    await expect(page.getByTestId('sold-banner')).toContainText(/^SoldHanded over on \d{1,2} [A-Z][a-z]{2} \d{4}\. This is your copy of the history up to then, and it no longer changes\.$/);
    await expect(page.getByTestId('service-entry-row')).toHaveCount(1);
    await expect(page.getByRole('link', { name: '+ Log service' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Hand over to a buyer' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Log a reading' })).toHaveCount(0);
    await expect(page.locator('form')).toHaveCount(0);
    // Its readings carry the closing reading accept wrote.
    await expect(page.getByText('carried over')).toBeVisible();

    // The entry opens read-only; the new-entry, settings and handover screens offer nothing to save.
    await gotoPage(page, (await page.getByTestId('service-entry-row').getAttribute('href'))!);
    await expect(page.getByRole('heading', { name: 'Oil change' })).toBeVisible();
    await expect(page.locator('form')).toHaveCount(0);
    await gotoPage(page, `/garage/${vehicleId}/book/entries/new`);
    await expect(page).toHaveURL(new RegExp(`/garage/${vehicleId}/book$`));
    await gotoPage(page, `/garage/${vehicleId}/book/settings`);
    await expect(page).toHaveURL(new RegExp(`/garage/${vehicleId}/book$`));
    await gotoPage(page, `/garage/${vehicleId}/book/handover`);
    await expect(page.getByTestId('sold-banner')).toBeVisible();
    await expect(page.getByTestId('handover-form')).toHaveCount(0);

    // No new session on it: the only bike is sold, so the picker sends the rider to add the next one.
    await gotoPage(page, '/sessions/new');
    await expect(page).toHaveURL(/\/garage\/new$/);

    // The delete confirmation says what a sold bike's delete reaches.
    await gotoPage(page, `/garage/${vehicleId}/edit`);
    await expect(page.getByText(`You handed ${NICKNAME} over, so this removes only your copy; the new owner's is untouched.`)).toBeVisible();
    await expect(page.getByRole('link', { name: 'Hand over to a buyer' })).toHaveCount(0);
  });
});
