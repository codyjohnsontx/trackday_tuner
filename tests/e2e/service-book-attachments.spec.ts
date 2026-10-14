import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { getFreePlanLimit } from '@/lib/plans';
import { defaultFieldLayout } from '@/lib/service-book/fields';
import { signInWith } from '@/tests/e2e/helpers/auth';
import { gotoPage } from '@/tests/e2e/helpers/navigation';
import { createTestAdminClient, hasServiceRole } from '@/tests/e2e/helpers/supabase';
import { createThrowawayRider, deleteThrowawayRider, type ThrowawayRider } from '@/tests/e2e/helpers/throwaway-rider';
import type { Database } from '@/types/supabase';

/**
 * A rider attaches a receipt photo and a PDF invoice to a service book entry
 * through the real form, against a stack built from the repository, and the
 * attachment is checked where it lives rather than on the page alone:
 *
 * - the photo was resized in the browser and stored as a JPEG with a
 *   thumbnail, in the private `service-book` bucket;
 * - the page reads it through a signed URL that opens, while the same object's
 *   path answers nobody without one;
 * - the entry reads "Receipt attached when logged" and is still "Unedited",
 *   because an attachment is not an edit;
 * - at the free plan's 25 per bike the uploader is replaced by the notice, and
 *   an upload refused at the 26th slot shows the same notice.
 *
 * It needs the `service-book` bucket, which `supabase start` / `db reset` seed
 * from supabase/config.toml (TESTING.md).
 */

const NICKNAME = 'Receipt Test R1';
const CAP = getFreePlanLimit('attachments');

/** A 64x48 PNG, so the browser has a real image to decode and re-encode. */
async function pngOf(page: import('@playwright/test').Page): Promise<Buffer> {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 48;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#c0392b';
    context.fillRect(0, 0, 64, 48);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  return Buffer.from(base64, 'base64');
}

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
);

async function plantEntry(rider: ThrowawayRider): Promise<{ vehicleId: string; bookId: string; entryId: string }> {
  const admin = createTestAdminClient();
  const vehicle = await admin.from('vehicles').insert({ user_id: rider.id, nickname: NICKNAME, type: 'motorcycle' }).select('id').single();
  expect(vehicle.error, vehicle.error?.message).toBeNull();
  const book = await admin.from('service_books').insert({ vehicle_id: vehicle.data!.id }).select('id').single();
  expect(book.error, book.error?.message).toBeNull();
  const fields = await admin.from('service_book_fields').insert(defaultFieldLayout().map((field) => ({ ...field, book_id: book.data!.id })));
  expect(fields.error, fields.error?.message).toBeNull();

  // The entry is the rider's own, saved the way the form saves it.
  const riderClient = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const signedIn = await riderClient.auth.signInWithPassword({ email: rider.email, password: rider.password });
  expect(signedIn.error, signedIn.error?.message).toBeNull();
  const entry = await riderClient.rpc('save_service_entry', {
    p_book_id: book.data!.id,
    p_entry_id: null,
    p_entry: { service_date: new Date().toISOString().slice(0, 10) },
    p_items: [{ item_id: null, label: 'Oil change' }],
    p_parts: null,
  });
  expect(entry.error, entry.error?.message).toBeNull();
  return { vehicleId: vehicle.data!.id, bookId: book.data!.id, entryId: entry.data as string };
}

/** Confirmed attachments with no objects behind them, to fill the allowance. */
async function plantAttachments(bookId: string, entryId: string, riderId: string, count: number) {
  if (count <= 0) return;
  const rows = Array.from({ length: count }, (_, index) => ({
    book_id: bookId,
    entry_id: entryId,
    kind: 'photo' as const,
    object_path: `${bookId}/planted-${Date.now()}-${index}.pdf`,
    mime: 'application/pdf' as const,
    bytes: 1,
    status: 'ready' as const,
    uploaded_at: new Date().toISOString(),
    created_by: riderId,
  }));
  const planted = await createTestAdminClient().from('service_attachments').insert(rows);
  expect(planted.error, planted.error?.message).toBeNull();
}

test.describe('service book attachments', () => {
  test.describe.configure({ timeout: 180_000 });
  test.skip(!hasServiceRole(), 'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');

  let rider: ThrowawayRider | null = null;

  test.beforeEach(async () => {
    rider = await createThrowawayRider('attachments');
  });

  test.afterEach(async () => {
    await deleteThrowawayRider(rider);
    rider = null;
  });

  test('uploads a photo and a PDF, reads them through signed URLs, and stops at the free allowance', async ({ page }) => {
    const admin = createTestAdminClient();
    const { vehicleId, bookId, entryId } = await plantEntry(rider!);
    await signInWith(page, rider!.email, rider!.password);
    await gotoPage(page, `/garage/${vehicleId}/book/entries/${entryId}`);

    await expect(page.getByText('Nothing attached yet.')).toBeVisible();
    const kinds = page.getByRole('group', { name: 'What is this file?' });
    for (const label of ['Receipt', 'Invoice', 'Photo']) {
      await expect(kinds.getByRole('button', { name: label })).toHaveAttribute('aria-pressed', 'false');
    }

    // A file with no kind is not uploaded: "receipt" is a claim, and nobody made it.
    await page.getByLabel('Photo or PDF').setInputFiles({ name: 'receipt.png', mimeType: 'image/png', buffer: await pngOf(page) });
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Choose what this file is first.' })).toBeVisible();
    expect((await admin.from('service_attachments').select('id').eq('book_id', bookId)).data).toEqual([]);

    await kinds.getByRole('button', { name: 'Receipt' }).click();
    await page.getByRole('button', { name: 'Upload' }).click();
    const receiptTile = page.getByRole('button', { name: /^View Receipt/ });
    await expect(receiptTile).toBeVisible({ timeout: 30_000 });

    // Stored as the browser re-encoded it: a JPEG and a thumbnail, both in the private bucket.
    const stored = await admin.from('service_attachments').select('*').eq('book_id', bookId);
    expect(stored.data).toHaveLength(1);
    const receipt = stored.data![0];
    expect(receipt).toMatchObject({ entry_id: entryId, kind: 'receipt', mime: 'image/jpeg', status: 'ready' });
    expect(receipt.object_path).toBe(`${bookId}/${receipt.id}.jpg`);
    expect(receipt.thumb_path).toBe(`${bookId}/${receipt.id}.thumb.jpg`);
    const object = await admin.storage.from('service-book').download(receipt.object_path);
    const bytes = Buffer.from(await object.data!.arrayBuffer());
    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(bytes.length).toBe(receipt.bytes);

    // The page reads it through a signed URL, which opens; the same object answers nobody without one.
    const src = await receiptTile.locator('img').getAttribute('src');
    expect(src).toContain('/storage/v1/object/sign/service-book/');
    const signed = await fetch(src!);
    expect(signed.status).toBe(200);
    expect(signed.headers.get('content-type')).toBe('image/jpeg');
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const publicPath = await fetch(`${base}/storage/v1/object/public/service-book/${receipt.object_path}`);
    expect(publicPath.ok).toBe(false);
    const anonPath = await fetch(`${base}/storage/v1/object/service-book/${receipt.object_path}`, {
      headers: { apikey: anonKey, authorization: `Bearer ${anonKey}` },
    });
    expect(anonPath.ok).toBe(false);

    // The viewer shows the full photo, and closes.
    await receiptTile.click();
    const viewer = page.getByRole('dialog', { name: 'Receipt' });
    await expect(viewer.getByRole('img', { name: 'Receipt' })).toBeVisible();
    await viewer.getByRole('button', { name: 'Close' }).click();
    await expect(viewer).toBeHidden();

    // An attachment is evidence about the entry, not an edit of it.
    await expect(page.getByText('Receipt attached when logged')).toBeVisible();
    await expect(page.getByText('Unedited')).toBeVisible();

    // A PDF goes up as it is, with no thumbnail, and opens in a new tab.
    await kinds.getByRole('button', { name: 'Invoice' }).click();
    await page.getByLabel('Photo or PDF').setInputFiles({ name: 'invoice.pdf', mimeType: 'application/pdf', buffer: PDF });
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByRole('link', { name: /^Invoice.*\(PDF, opens in a new tab\)$/ })).toBeVisible({ timeout: 30_000 });
    const invoice = await admin.from('service_attachments').select('mime, thumb_path, bytes').eq('book_id', bookId).eq('kind', 'invoice').single();
    expect(invoice.data).toEqual({ mime: 'application/pdf', thumb_path: null, bytes: PDF.length });

    // At the allowance the uploader is gone and the notice stands in for it.
    await plantAttachments(bookId, entryId, rider!.id, CAP - 2);
    await page.reload();
    await expect(page.getByText('Attachment limit reached')).toBeVisible();
    await expect(page.getByText('Free plan is limited to 25 attachments per bike.', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Upload' })).toHaveCount(0);

    // One slot free as the page loads, taken elsewhere before the rider uploads:
    // the database refuses the 26th and the form shows the same notice.
    const oneOff = await admin.from('service_attachments').select('id').eq('book_id', bookId).like('object_path', '%planted-%').limit(1).single();
    await admin.from('service_attachments').delete().eq('id', oneOff.data!.id);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Upload' })).toBeVisible();
    await plantAttachments(bookId, entryId, rider!.id, 1);
    await kinds.getByRole('button', { name: 'Photo' }).click();
    await page.getByLabel('Photo or PDF').setInputFiles({ name: 'chain.png', mimeType: 'image/png', buffer: await pngOf(page) });
    await page.getByRole('button', { name: 'Upload' }).click();
    await expect(page.getByText('Attachment limit reached')).toBeVisible({ timeout: 30_000 });
    const total = await admin.from('service_attachments').select('id', { count: 'exact', head: true }).eq('book_id', bookId);
    expect(total.count).toBe(CAP);
  });
});
