import { randomUUID } from 'node:crypto';
import { createHash, randomBytes } from 'node:crypto';
import { test, expect, type Browser, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { defaultFieldLayout } from '@/lib/service-book/fields';
import { getFreePlanLimit } from '@/lib/plans';
import { signInWith } from '@/tests/e2e/helpers/auth';
import { gotoPage } from '@/tests/e2e/helpers/navigation';
import { createTestAdminClient, expectRows, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { createThrowawayRider, deleteThrowawayRider, type ThrowawayRider } from '@/tests/e2e/helpers/throwaway-rider';
import type { Database } from '@/types/supabase';

/**
 * A seller hands a bike to a buyer (owner, PQ2; TQ1 to TQ8), as two riders in
 * two browser contexts - and a third who was sent nothing - against a stack
 * built from the repository:
 *
 * - the seller makes the handover link (through `create_service_book_transfer`,
 *   as the seller's screen of PR 9b calls it);
 * - the buyer opens it signed out, is sent to sign in and lands back on it;
 * - a rider signed in with another address is refused, and shown no address;
 * - the buyer sees the bike and the counts, accepts, and lands on the new book
 *   reading the seller's entry as "Logged by a previous owner, handed over on
 *   <date>" with its receipt thumbnail actually rendering (the lesson of the
 *   vehicle-photo spec: an `<img>` in the document is not a picture);
 * - the copied entry opens read-only, remove-only; the buyer logs an entry of
 *   their own, which counts toward their cap while the copies do not;
 * - the seller's bike is sold and their book shows the old entry unchanged and
 *   nothing of the buyer's.
 *
 * The seller's bike carries the free plan's full allowance of receipts, so the
 * accept copies 25 files and 25 thumbnails plus a session photo and the bike
 * photo, and the spec records the wall time of the copy and the object count as
 * an annotation and on the console - the number the plan asked to be measured.
 *
 * It needs the `service-book`, `session-photos` and `vehicle-photos` buckets,
 * which `supabase start` / `db reset` seed from supabase/config.toml (TESTING.md).
 */

const NICKNAME = 'Handover Test R6';
const SELLER_NOTE = 'Motul 300V, torqued to spec';
const REMOVED_NOTE = 'removed-entry-note-that-must-not-cross';
const BUYER_NOTE = 'buyer-logged-entry-that-must-not-cross';
const ATTACHMENT_CAP = getFreePlanLimit('attachments');

/** A real 1x1 JPEG, so the browser has an image to decode. */
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=',
  'base64',
);

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function riderClient() {
  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function signedInClient(rider: ThrowawayRider) {
  const client = riderClient();
  const signedIn = await client.auth.signInWithPassword({ email: rider.email, password: rider.password });
  expect(signedIn.error, signedIn.error?.message).toBeNull();
  return client;
}

/** The seller's bike: a photo, a book at the receipt allowance, a removed entry and a session with a photo. */
async function plantSellersBike(seller: ThrowawayRider) {
  const admin = createTestAdminClient();
  const vehicleId = randomUUID();
  const vehiclePhotoPath = `${seller.id}/${vehicleId}.jpg`;
  expect((await admin.storage.from('vehicle-photos').upload(vehiclePhotoPath, JPEG, { contentType: 'image/jpeg' })).error).toBeNull();
  const vehicle = await admin
    .from('vehicles')
    .insert({
      id: vehicleId,
      user_id: seller.id,
      nickname: NICKNAME,
      type: 'motorcycle',
      year: 2019,
      make: 'Yamaha',
      model: 'YZF-R6',
      photo_url: admin.storage.from('vehicle-photos').getPublicUrl(vehiclePhotoPath).data.publicUrl,
    })
    .select('id')
    .single();
  expect(vehicle.error, vehicle.error?.message).toBeNull();

  const book = await admin.from('service_books').insert({ vehicle_id: vehicleId, owner_time_zone: 'America/Chicago' }).select('id').single();
  expect(book.error, book.error?.message).toBeNull();
  const bookId = book.data!.id;
  const fields = await admin.from('service_book_fields').insert(defaultFieldLayout().map((field) => ({ ...field, book_id: bookId })));
  expect(fields.error, fields.error?.message).toBeNull();

  const sessionId = randomUUID();
  const sessionPhotoPath = `${seller.id}/${sessionId}.jpg`;
  expect((await admin.storage.from('session-photos').upload(sessionPhotoPath, JPEG, { contentType: 'image/jpeg' })).error).toBeNull();
  const session = await admin.from('sessions').insert({
    id: sessionId,
    user_id: seller.id,
    vehicle_id: vehicleId,
    date: today(),
    conditions: 'sunny',
    tires: {} as Database['public']['Tables']['sessions']['Insert']['tires'],
    suspension: {} as Database['public']['Tables']['sessions']['Insert']['suspension'],
    notes: 'Front pushing in turn 5.',
    photo_url: admin.storage.from('session-photos').getPublicUrl(sessionPhotoPath).data.publicUrl,
  });
  expect(session.error, session.error?.message).toBeNull();

  // The entries are the seller's own, saved the way the form saves them.
  const asSeller = await signedInClient(seller);
  const save = (label: string, notes: string) =>
    asSeller.rpc('save_service_entry', {
      p_book_id: bookId,
      p_entry_id: null,
      p_entry: { service_date: today(), notes },
      p_items: [{ item_id: null, label }],
      p_parts: null,
    });
  const kept = await save('Oil change', SELLER_NOTE);
  expect(kept.error, kept.error?.message).toBeNull();
  const entryId = kept.data as string;
  const removed = await save('Chain adjust', REMOVED_NOTE);
  expect(removed.error, removed.error?.message).toBeNull();
  const removal = await asSeller.from('service_entries').update({ deleted_at: new Date().toISOString() }).eq('id', removed.data as string);
  expect(removal.error, removal.error?.message).toBeNull();

  // The full free allowance of receipts, each a real JPEG with its thumbnail
  // where the upload flow stores them, so accept has every object to verify.
  const attachmentIds: string[] = [];
  for (let index = 0; index < ATTACHMENT_CAP; index += 1) {
    const attachmentId = randomUUID();
    const objectPath = `${bookId}/${attachmentId}.jpg`;
    const thumbPath = `${bookId}/${attachmentId}.thumb.jpg`;
    expect((await admin.storage.from('service-book').upload(objectPath, JPEG, { contentType: 'image/jpeg' })).error).toBeNull();
    expect((await admin.storage.from('service-book').upload(thumbPath, JPEG, { contentType: 'image/jpeg' })).error).toBeNull();
    const row = await admin.from('service_attachments').insert({
      id: attachmentId,
      book_id: bookId,
      entry_id: entryId,
      kind: 'receipt',
      object_path: objectPath,
      thumb_path: thumbPath,
      mime: 'image/jpeg',
      bytes: JPEG.length,
      status: 'ready',
      uploaded_at: new Date().toISOString(),
      created_by: seller.id,
    });
    expect(row.error, row.error?.message).toBeNull();
    attachmentIds.push(attachmentId);
  }

  return { vehicleId, bookId, entryId, sessionId, attachmentIds, asSeller };
}

/** The handover link, made as the seller's screen makes it: a raw token in the link, its SHA-256 on the row. */
async function makeHandover(asSeller: ReturnType<typeof riderClient>, bookId: string, buyerEmail: string) {
  const raw = randomBytes(32).toString('base64url');
  const created = await asSeller.rpc('create_service_book_transfer', {
    p_book_id: bookId,
    p_to_email: buyerEmail,
    p_token_hash: createHash('sha256').update(raw).digest('hex'),
    p_handover_hours: 42.5,
    p_handover_distance: null,
    p_time_zone: 'America/Chicago',
  });
  expect(created.error, created.error?.message).toBeNull();
  return { raw, path: `/transfer/${raw}` };
}

/** Signs in through the real form and waits to land on `expected` rather than the dashboard. */
async function signInLandingOn(page: Page, rider: ThrowawayRider, expected: RegExp) {
  const form = page.locator('form');
  const emailField = form.getByLabel('Email');
  const passwordField = form.getByLabel('Password');
  await expect(async () => {
    await emailField.fill(rider.email);
    await passwordField.fill(rider.password);
    await expect(emailField).toHaveValue(rider.email);
    await expect(passwordField).toHaveValue(rider.password);
  }).toPass({ timeout: 10_000 });
  await form.getByRole('button', { name: /^Sign In$/ }).click();
  await expect(page).toHaveURL(expected, { timeout: 20_000 });
}

async function riderContext(browser: Browser, timezoneId: string) {
  return browser.newContext({ timezoneId });
}

test.describe('handing a bike to a buyer', () => {
  test.describe.configure({ timeout: 240_000 });
  test.skip(!hasServiceRole(), 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  test.use({ timezoneId: 'America/Chicago' });

  let seller: ThrowawayRider | null = null;
  let buyer: ThrowawayRider | null = null;
  let stranger: ThrowawayRider | null = null;

  test.beforeEach(async () => {
    [seller, buyer, stranger] = await Promise.all([createThrowawayRider('seller'), createThrowawayRider('buyer'), createThrowawayRider('stranger')]);
  });

  test.afterEach(async () => {
    await Promise.all([deleteThrowawayRider(seller), deleteThrowawayRider(buyer), deleteThrowawayRider(stranger)]);
    seller = buyer = stranger = null;
  });

  test('the buyer signs in from the link, accepts, and the two copies part ways', async ({ page, browser }, testInfo) => {
    const admin = createTestAdminClient();
    const bike = await plantSellersBike(seller!);
    const link = await makeHandover(bike.asSeller, bike.bookId, buyer!.email);

    // Signed out: nothing about the bike, and a way to sign in that comes back here.
    const buying = await riderContext(browser, 'Europe/London');
    const buyerPage = await buying.newPage();
    try {
      const opened = await buyerPage.goto(link.path);
      expect(opened?.status()).toBe(200);
      expect(opened?.headers()['x-robots-tag']).toContain('noindex');
      await expect(buyerPage.getByTestId('handover-sign-in')).toBeVisible();
      expect(await buyerPage.content()).not.toContain(NICKNAME);
      await buyerPage.getByTestId('handover-sign-in-link').click();
      await expect(buyerPage).toHaveURL(/\/login\?next=/);
      await signInLandingOn(buyerPage, buyer!, new RegExp(`${link.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));

      // The offer: the bike, what comes with it, and Accept.
      await expect(buyerPage.getByTestId('handover-bike-nickname')).toHaveText(NICKNAME);
      const lines = await buyerPage.getByTestId('handover-summary-line').allTextContents();
      expect(lines[0]).toContain('1 service entry');
      expect(lines[0]).toContain(`${ATTACHMENT_CAP} receipts and photos`);
      expect(lines).toContain('1 entry removed by an owner: counted, not shown.');
      expect(lines.some((line) => line.startsWith('Track sessions on this bike: 1 track session'))).toBe(true);
      expect(await buyerPage.content()).not.toContain(seller!.email);

      // The wrong account, meanwhile, is refused and shown no address.
      const strange = await riderContext(browser, 'Europe/London');
      try {
        const strangerPage = await strange.newPage();
        await signInWith(strangerPage, stranger!.email, stranger!.password);
        await gotoPage(strangerPage, link.path);
        await expect(strangerPage.getByTestId('handover-wrong-account')).toBeVisible();
        const html = await strangerPage.content();
        expect(html).not.toContain(buyer!.email);
        expect(html).not.toContain(NICKNAME);
      } finally {
        await strange.close();
      }

      // Accept, timed: the copy is 25 receipts and their thumbnails, the session
      // photo and the bike photo, through the storage API ten at a time.
      const objectsToCopy = ATTACHMENT_CAP * 2 + 2;
      const started = Date.now();
      await buyerPage.getByTestId('handover-accept').click();
      await expect(buyerPage).toHaveURL(/\/garage\/[0-9a-f-]{36}\/book$/, { timeout: 120_000 });
      const copyMs = Date.now() - started;
      const record = `handover accept: ${objectsToCopy} objects copied in ${copyMs} ms (${ATTACHMENT_CAP} receipts with thumbnails, 1 session photo, 1 bike photo)`;
      testInfo.annotations.push({ type: 'handover-timing', description: record });
      console.log(`[service-book-handover] ${record}`);

      const newVehicleId = /\/garage\/([0-9a-f-]{36})\/book$/.exec(buyerPage.url())![1];
      expect(newVehicleId).not.toBe(bike.vehicleId);

      // The new book: the banner, the seller's entry labelled as theirs, the removed count.
      await expect(buyerPage.locator('#received-book-banner')).toContainText('Handed over to you on');
      await expect(buyerPage.locator('#received-book-banner')).toContainText('1 entry and 1 session from before then are here now');
      const rows = buyerPage.getByTestId('service-entry-row');
      await expect(rows).toHaveCount(1);
      const labels = rows.getByRole('list', { name: 'History' }).getByRole('listitem');
      await expect(labels.first()).toBeVisible();
      const labelTexts = await labels.allTextContents();
      expect(labelTexts.some((text) => /^Logged by a previous owner, handed over on \d/.test(text))).toBe(true);
      expect(labelTexts).toContain('Receipt attached when logged');
      await expect(buyerPage.getByTestId('received-removed-entries')).toHaveText('1 entry removed by an owner');
      expect(await buyerPage.content()).not.toContain(REMOVED_NOTE);

      // The copied entry opens read-only and remove-only, with its receipt actually rendering.
      // Opened by its link rather than a click: a client navigation into the
      // entry page under `next start` is not reliable enough to hang a walk on
      // (CLAUDE.md, "Load the browser Supabase client lazily").
      const entryHref = await rows.getAttribute('href');
      expect(entryHref).toMatch(/\/book\/entries\/[0-9a-f-]{36}$/);
      await gotoPage(buyerPage, entryHref!);
      // The note shows in the read-only details and in each revision's snapshot.
      await expect(buyerPage.getByRole('paragraph').filter({ hasText: SELLER_NOTE })).toBeVisible();
      expect(await buyerPage.locator('form').count()).toBe(0);
      await expect(buyerPage.getByRole('button', { name: 'Hold to remove' })).toBeVisible();
      await expect(buyerPage.getByText('This entry came with the bike, so it can be removed but not edited.', { exact: false })).toBeVisible();
      const tiles = buyerPage.getByRole('list', { name: 'Attachments' }).locator('img');
      await expect(tiles).toHaveCount(ATTACHMENT_CAP);
      const thumbSrc = await tiles.first().getAttribute('src');
      expect(thumbSrc).toContain('/storage/v1/object/sign/service-book/');
      const thumb = await fetch(thumbSrc!);
      expect(thumb.status).toBe(200);
      expect(thumb.headers.get('content-type')).toBe('image/jpeg');
      await expect.poll(() => tiles.first().evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);

      // The buyer logs an entry of their own; the copies count toward no cap.
      const asBuyer = await signedInClient(buyer!);
      const newBook = expectRows(await admin.from('service_books').select('id, transferred_at').eq('vehicle_id', newVehicleId), 'the new book');
      expect(newBook[0].transferred_at).not.toBeNull();
      const own = await asBuyer.rpc('save_service_entry', {
        p_book_id: newBook[0].id,
        p_entry_id: null,
        p_entry: { service_date: today(), notes: BUYER_NOTE },
        p_items: [{ item_id: null, label: 'Brake fluid' }],
        p_parts: null,
      });
      expect(own.error, own.error?.message).toBeNull();
      const reserved = await asBuyer.rpc('reserve_service_attachment', {
        p_book_id: newBook[0].id,
        p_entry_id: own.data as string,
        p_kind: 'receipt',
        p_mime: 'image/jpeg',
        p_bytes: JPEG.length,
      });
      expect(reserved.error, `the ${ATTACHMENT_CAP} copied receipts must count toward nothing: ${reserved.error?.message}`).toBeNull();

      await gotoPage(buyerPage, `/garage/${newVehicleId}/book`);
      await expect(buyerPage.getByTestId('service-entry-row')).toHaveCount(2);
      // The buyer's own entry is theirs, so the banner still counts only what came with the bike.
      await expect(buyerPage.locator('#received-book-banner')).toContainText('1 entry and 1 session from before then are here now');
    } finally {
      await buying.close();
    }

    // The seller: sold, and their copy unchanged - the old entry, not the buyer's.
    const sold = expectRows(await admin.from('vehicles').select('sold_at').eq('id', bike.vehicleId), "the seller's bike");
    expect(sold[0].sold_at).not.toBeNull();
    await signInWith(page, seller!.email, seller!.password);
    await gotoPage(page, `/garage/${bike.vehicleId}/book`);
    const sellerRows = page.getByTestId('service-entry-row');
    await expect(sellerRows).toHaveCount(1);
    await expect(sellerRows.first()).toContainText('Oil change');
    const sellerHtml = await page.content();
    expect(sellerHtml).not.toContain(BUYER_NOTE);
    expect(sellerHtml).not.toContain('Handed over to you');
    const sellerEntries = expectRows(await admin.from('service_entries').select('id, notes').eq('book_id', bike.bookId), "the seller's entries");
    expect(sellerEntries.map((entry) => entry.notes).sort()).toEqual([SELLER_NOTE, REMOVED_NOTE].sort());
    const buyerSessions = expectRows(await admin.from('sessions').select('id, copied_from_session_id').eq('user_id', buyer!.id), "the buyer's sessions");
    expect(buyerSessions).toEqual([{ id: expect.any(String), copied_from_session_id: bike.sessionId }]);
    expect(buyerSessions[0].id).not.toBe(bike.sessionId);
  });

  test('a link that was accepted, cancelled or never existed answers the same way to anyone but its buyer', async ({ page, browser }) => {
    const bike = await plantSellersBike(seller!);
    const link = await makeHandover(bike.asSeller, bike.bookId, buyer!.email);

    // The seller opening their own link is told it is for the buyer.
    await signInWith(page, seller!.email, seller!.password);
    await gotoPage(page, link.path);
    await expect(page.getByTestId('handover-own-link')).toBeVisible();

    const cancelled = await bike.asSeller.rpc('cancel_service_book_transfer', {
      p_transfer_id: (await createTestAdminClient().from('service_book_transfers').select('id').eq('book_id', bike.bookId).single()).data!.id,
    });
    expect(cancelled.error, cancelled.error?.message).toBeNull();

    const buying = await riderContext(browser, 'Europe/London');
    try {
      const buyerPage = await buying.newPage();
      await signInWith(buyerPage, buyer!.email, buyer!.password);
      await gotoPage(buyerPage, link.path);
      await expect(buyerPage.getByTestId('handover-invalid')).toBeVisible();
      expect(await buyerPage.content()).not.toContain(NICKNAME);
      await gotoPage(buyerPage, `/transfer/${randomBytes(32).toString('base64url')}`);
      await expect(buyerPage.getByTestId('handover-invalid')).toBeVisible();
      expect((await buyerPage.goto('/transfer/not-a-token'))?.status()).toBe(404);
    } finally {
      await buying.close();
    }
  });
});
