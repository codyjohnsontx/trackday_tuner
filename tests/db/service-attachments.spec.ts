import { expect, test } from '@playwright/test';
import { resolveUserAccess } from '@/lib/access';
import { FREE_PLAN_ATTACHMENT_MAX_BYTES, PRO_ATTACHMENT_MAX_BYTES, getFreePlanLimit } from '@/lib/plans';
import { ATTACHMENT_THUMB_MAX_BYTES } from '@/lib/service-book/attachments';
import { createTestAdminClient } from '@/tests/e2e/helpers/supabase';
import { createThrowawayRider, deleteThrowawayRider, type ThrowawayRider } from '@/tests/e2e/helpers/throwaway-rider';
import { runAsPostgres } from '@/tests/db/helpers/auth-database';
import { anonClient, createVehicle, signIn, type Client } from '@/tests/db/helpers/rider';
import type { Profile } from '@/types';

/**
 * Receipt and photo attachments on a service book entry (20261014000400), on a
 * real database and a real storage API:
 *
 * - the free allowance is 25 per bike, the number lib/plans.ts prints, and two
 *   reserves racing for the last slot leave exactly 25 (the 26th is TT402);
 * - the per-file size is 10 MB free and 25 MB Pro, the numbers lib/plans.ts
 *   prints, both at reserve and against what storage actually holds, and a
 *   thumbnail is a JPEG of at most 1 MB;
 * - Pro is exactly `resolveUserAccess`;
 * - another rider, nobody and the service role cannot reserve or confirm, and a
 *   rider cannot write the table directly;
 * - a reservation a day old can no longer be confirmed, and one nobody
 *   confirms is swept after a day;
 * - the object sweep is handed every object a day old that no ready attachment
 *   names, and nothing else, and only the service role may ask;
 * - the bucket is private: nobody reads an object without a signed URL.
 *
 * Part of `npm run test:db`, which CI runs on every pull request against a
 * local stack built from supabase/migrations - see playwright.db.config.ts.
 */

const CAP = getFreePlanLimit('attachments');
const BUCKET = 'service-book';

type Kind = 'receipt' | 'invoice' | 'photo';
type Mime = 'image/jpeg' | 'application/pdf';

interface Reserved {
  id: string;
  object_path: string;
  thumb_path: string | null;
}

/** The smallest JPEG every decoder accepts, as storage only reads its bytes. */
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');

test.describe('service book attachments', () => {
  test.describe.configure({ timeout: 180_000 });

  let admin: Client;
  const riders: ThrowawayRider[] = [];

  async function newRider(label: string) {
    const rider = await createThrowawayRider(`attachments-${label}`);
    riders.push(rider);
    const client = await signIn(rider);
    const vehicle = await createVehicle(client, rider.id);
    const book = await client.from('service_books').insert({ vehicle_id: vehicle }).select('id').single();
    expect(book.error, book.error?.message).toBeNull();
    const entry = await client.rpc('save_service_entry', {
      p_book_id: book.data!.id,
      p_entry_id: null,
      p_entry: { service_date: '2026-10-01' },
      p_items: [{ item_id: null, label: 'Oil change' }],
      p_parts: null,
    });
    expect(entry.error, entry.error?.message).toBeNull();
    return { rider, client, book: book.data!.id, entry: entry.data as string };
  }

  function reserve(client: Client, book: string, entry: string, kind: Kind = 'receipt', mime: Mime = 'image/jpeg', bytes = 1000) {
    return client.rpc('reserve_service_attachment', { p_book_id: book, p_entry_id: entry, p_kind: kind, p_mime: mime, p_bytes: bytes });
  }

  async function count(book: string): Promise<number> {
    const { count: total, error } = await admin.from('service_attachments').select('id', { count: 'exact', head: true }).eq('book_id', book);
    expect(error, error?.message).toBeNull();
    return total ?? 0;
  }

  /** Uploads as the browser does: to a URL the service role signed for the reserved path. */
  async function upload(path: string, body: Buffer, contentType: string) {
    const signed = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
    expect(signed.error, signed.error?.message).toBeNull();
    const sent = await anonClient().storage.from(BUCKET).uploadToSignedUrl(path, signed.data!.token, body, { contentType });
    expect(sent.error, sent.error?.message).toBeNull();
  }

  test.beforeAll(() => {
    admin = createTestAdminClient();
  });

  test.afterAll(async () => {
    for (const rider of riders) await deleteThrowawayRider(rider);
  });

  test('the allowance is the number lib/plans.ts prints, for exactly the riders resolveUserAccess calls free', async () => {
    const { rider, client } = await newRider('allowance');
    const past = '2000-01-01T00:00:00Z';
    const later = '2998-01-01T00:00:00Z';
    const future = '2999-01-01T00:00:00Z';
    const cases: [string, Pick<Profile, 'tier' | 'beta_access_started_at' | 'beta_access_expires_at'> | null][] = [
      ['no profile row', null],
      ['the free tier', { tier: 'free', beta_access_started_at: null, beta_access_expires_at: null }],
      ['Pro', { tier: 'pro', beta_access_started_at: null, beta_access_expires_at: null }],
      ['a beta window that has started', { tier: 'free', beta_access_started_at: past, beta_access_expires_at: future }],
      ['a beta window not yet started', { tier: 'free', beta_access_started_at: later, beta_access_expires_at: future }],
      ['a beta window that has expired', { tier: 'free', beta_access_started_at: null, beta_access_expires_at: past }],
    ];

    for (const [label, fields] of cases) {
      const written = fields
        ? await admin.from('profiles').upsert({ id: rider.id, ...fields }).select('id')
        : await admin.from('profiles').delete().eq('id', rider.id).select('id');
      expect(written.error, `${label}: ${written.error?.message}`).toBeNull();
      const profile = await admin.from('profiles').select('*').eq('id', rider.id).maybeSingle();
      const pro = resolveUserAccess(profile.data as Profile | null).hasProAccess;

      const allowance = await client.rpc('service_attachment_allowance').single();
      expect(allowance.error, `${label}: ${allowance.error?.message}`).toBeNull();
      expect(allowance.data, label).toEqual(
        pro ? { max_count: null, max_bytes: PRO_ATTACHMENT_MAX_BYTES } : { max_count: CAP, max_bytes: FREE_PLAN_ATTACHMENT_MAX_BYTES },
      );
    }
  });

  test('two reserves racing for the last free slot leave exactly the cap, and the 26th is TT402', async () => {
    const { client, book, entry } = await newRider('cap-race');
    for (let index = 0; index < CAP - 1; index += 1) {
      const reserved = await reserve(client, book, entry);
      expect(reserved.error, reserved.error?.message).toBeNull();
    }
    expect(await count(book)).toBe(CAP - 1);

    const results = await Promise.all([reserve(client, book, entry, 'photo'), reserve(client, book, entry, 'invoice')]);

    expect(results.map((result) => result.error?.code ?? 'reserved').sort()).toEqual(['TT402', 'reserved']);
    expect(await count(book)).toBe(CAP);
    expect((await reserve(client, book, entry)).error?.code).toBe('TT402');
    expect(await count(book)).toBe(CAP);

    // A reservation older than a day no longer holds its slot.
    const { data: oldest } = await admin.from('service_attachments').select('id').eq('book_id', book).limit(1).single();
    const aged = await admin
      .from('service_attachments')
      .update({ created_at: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() })
      .eq('id', oldest!.id)
      .select('id');
    expect(aged.data).toHaveLength(1);
    const freed = await reserve(client, book, entry);
    expect(freed.error, freed.error?.message).toBeNull();
  });

  test('a Pro rider is not counted, and each plan is held to its own file size', async () => {
    const { rider, client, book, entry } = await newRider('sizes');

    expect((await reserve(client, book, entry, 'receipt', 'application/pdf', FREE_PLAN_ATTACHMENT_MAX_BYTES)).error).toBeNull();
    expect((await reserve(client, book, entry, 'receipt', 'application/pdf', FREE_PLAN_ATTACHMENT_MAX_BYTES + 1)).error?.code).toBe('TT413');

    const upgraded = await admin.from('profiles').update({ tier: 'pro' }).eq('id', rider.id).select('id');
    expect(upgraded.data).toHaveLength(1);
    expect((await reserve(client, book, entry, 'receipt', 'application/pdf', PRO_ATTACHMENT_MAX_BYTES)).error).toBeNull();
    expect((await reserve(client, book, entry, 'receipt', 'application/pdf', PRO_ATTACHMENT_MAX_BYTES + 1)).error?.code).toBe('TT413');
    for (let index = 0; index < CAP; index += 1) {
      expect((await reserve(client, book, entry)).error).toBeNull();
    }
    expect(await count(book)).toBe(CAP + 2);
  });

  test('refuses another rider, nobody, the service role and a direct write', async () => {
    const owner = await newRider('owner');
    const other = await newRider('other');

    expect((await reserve(other.client, owner.book, owner.entry)).error?.code).toBe('TT404');
    // Their own book, someone else's entry: the entry has to be of that book.
    expect((await reserve(other.client, other.book, owner.entry)).error?.code).toBe('TT404');
    expect((await reserve(anonClient(), owner.book, owner.entry)).error?.code).toBe('42501');
    expect((await reserve(admin, owner.book, owner.entry)).error?.code).toBe('42501');

    const reserved = await reserve(owner.client, owner.book, owner.entry);
    expect(reserved.error, reserved.error?.message).toBeNull();
    const id = (reserved.data as unknown as Reserved).id;
    expect((await other.client.rpc('confirm_service_attachment', { p_attachment_id: id })).error?.code).toBe('TT404');
    expect((await anonClient().rpc('confirm_service_attachment', { p_attachment_id: id })).error?.code).toBe('42501');

    const seen = await other.client.from('service_attachments').select('id').eq('id', id);
    expect(seen.error, seen.error?.message).toBeNull();
    expect(seen.data).toEqual([]);

    const planted = await owner.client.from('service_attachments').insert({
      book_id: owner.book,
      entry_id: owner.entry,
      kind: 'receipt',
      object_path: `${owner.book}/planted.jpg`,
      mime: 'image/jpeg',
      bytes: 1,
      status: 'ready',
      uploaded_at: new Date().toISOString(),
      created_by: owner.rider.id,
    });
    expect(planted.error?.code).toBe('42501');
    const flipped = await owner.client.from('service_attachments').update({ status: 'ready', uploaded_at: new Date().toISOString() }).eq('id', id).select('id');
    expect(flipped.error?.code).toBe('42501');

    // A removed entry takes no new attachment.
    const removed = await owner.client.from('service_entries').update({ deleted_at: new Date().toISOString() }).eq('id', owner.entry).select('id');
    expect(removed.data).toHaveLength(1);
    expect((await reserve(owner.client, owner.book, owner.entry)).error?.code).toBe('TT404');
  });

  test('confirms only what storage holds, at its stored size, and keeps the bucket private', async () => {
    const { client, book, entry } = await newRider('confirm');
    const reserved = await reserve(client, book, entry, 'receipt', 'image/jpeg', 999_999);
    expect(reserved.error, reserved.error?.message).toBeNull();
    const row = reserved.data as unknown as Reserved;
    expect(row.object_path).toBe(`${book}/${row.id}.jpg`);
    expect(row.thumb_path).toBe(`${book}/${row.id}.thumb.jpg`);

    const confirm = () => client.rpc('confirm_service_attachment', { p_attachment_id: row.id });
    expect((await confirm()).error?.code).toBe('TT404');
    await upload(row.object_path, JPEG, 'image/jpeg');
    // The thumbnail has to arrive too.
    expect((await confirm()).error?.code).toBe('TT404');
    await upload(row.thumb_path!, JPEG, 'image/jpeg');

    const confirmed = await confirm();
    expect(confirmed.error, confirmed.error?.message).toBeNull();
    expect(confirmed.data).toMatchObject({ id: row.id, status: 'ready', bytes: JPEG.length });
    const stored = await admin.from('service_attachments').select('status, bytes, uploaded_at').eq('id', row.id).single();
    expect(stored.data!.status).toBe('ready');
    expect(stored.data!.bytes).toBe(JPEG.length);
    expect(stored.data!.uploaded_at).not.toBeNull();

    // A rider cannot read, list or write the bucket themselves; only a signed URL opens an object.
    expect((await client.storage.from(BUCKET).download(row.object_path)).error).not.toBeNull();
    expect((await anonClient().storage.from(BUCKET).download(row.object_path)).error).not.toBeNull();
    const listed = await client.storage.from(BUCKET).list(book);
    expect(listed.data ?? []).toEqual([]);
    expect((await client.storage.from(BUCKET).upload(`${book}/mine.jpg`, JPEG, { contentType: 'image/jpeg' })).error).not.toBeNull();
    const publicUrl = admin.storage.from(BUCKET).getPublicUrl(row.object_path).data.publicUrl;
    expect((await fetch(publicUrl)).ok).toBe(false);
    const signed = await admin.storage.from(BUCKET).createSignedUrl(row.object_path, 60);
    const opened = await fetch(signed.data!.signedUrl);
    expect(opened.ok).toBe(true);
    expect(Buffer.from(await opened.arrayBuffer()).equals(JPEG)).toBe(true);
  });

  test('refuses an upload of another type, or larger than the plan keeps', async () => {
    const { client, book, entry } = await newRider('confirm-refusals');

    const pdf = (await reserve(client, book, entry, 'invoice', 'application/pdf', 100)).data as unknown as Reserved;
    expect(pdf.thumb_path).toBeNull();
    await upload(pdf.object_path, JPEG, 'image/jpeg');
    expect((await client.rpc('confirm_service_attachment', { p_attachment_id: pdf.id })).error?.code).toBe('22023');

    // Declared small, uploaded large: the stored object is what is measured.
    const big = (await reserve(client, book, entry, 'invoice', 'application/pdf', 100)).data as unknown as Reserved;
    await upload(big.object_path, Buffer.alloc(FREE_PLAN_ATTACHMENT_MAX_BYTES + 1, 0x25), 'application/pdf');
    expect((await client.rpc('confirm_service_attachment', { p_attachment_id: big.id })).error?.code).toBe('TT413');

    const states = await admin.from('service_attachments').select('status').in('id', [pdf.id, big.id]);
    expect(states.data!.map((state) => state.status)).toEqual(['pending', 'pending']);
  });

  test('refuses a thumbnail that is not a JPEG of at most 1 MB', async () => {
    const { client, book, entry } = await newRider('confirm-thumbs');

    const wrongType = (await reserve(client, book, entry)).data as unknown as Reserved;
    await upload(wrongType.object_path, JPEG, 'image/jpeg');
    await upload(wrongType.thumb_path!, JPEG, 'application/pdf');
    expect((await client.rpc('confirm_service_attachment', { p_attachment_id: wrongType.id })).error?.code).toBe('22023');

    const tooLarge = (await reserve(client, book, entry)).data as unknown as Reserved;
    await upload(tooLarge.object_path, JPEG, 'image/jpeg');
    await upload(tooLarge.thumb_path!, Buffer.alloc(ATTACHMENT_THUMB_MAX_BYTES + 1, 0x25), 'image/jpeg');
    expect((await client.rpc('confirm_service_attachment', { p_attachment_id: tooLarge.id })).error?.code).toBe('22023');

    const states = await admin.from('service_attachments').select('status').in('id', [wrongType.id, tooLarge.id]);
    expect(states.data!.map((state) => state.status)).toEqual(['pending', 'pending']);
  });

  test('hands the object sweep every object a day old that no ready attachment names, and only the service role', async () => {
    const { client, book, entry } = await newRider('orphans');
    const kept = (await reserve(client, book, entry)).data as unknown as Reserved;
    await upload(kept.object_path, JPEG, 'image/jpeg');
    await upload(kept.thumb_path!, JPEG, 'image/jpeg');
    expect((await client.rpc('confirm_service_attachment', { p_attachment_id: kept.id })).error).toBeNull();
    const abandoned = (await reserve(client, book, entry, 'invoice', 'application/pdf', 100)).data as unknown as Reserved;
    await upload(abandoned.object_path, JPEG, 'application/pdf');
    const fresh = (await reserve(client, book, entry, 'invoice', 'application/pdf', 100)).data as unknown as Reserved;
    await upload(fresh.object_path, JPEG, 'application/pdf');

    const aged = [kept.object_path, kept.thumb_path!, abandoned.object_path].map((name) => `'${name}'`).join(', ');
    const backdated = runAsPostgres(
      `update storage.objects set created_at = now() - interval '25 hours' where bucket_id = '${BUCKET}' and name in (${aged});`,
    );
    expect(backdated.ok, backdated.stderr).toBe(true);

    const listed = await admin.rpc('service_attachment_orphan_objects', { p_limit: 1000 });
    expect(listed.error, listed.error?.message).toBeNull();
    const names = (listed.data as { name: string }[]).map((object) => object.name);
    expect(names).toContain(abandoned.object_path);
    expect(names).not.toContain(kept.object_path);
    expect(names).not.toContain(kept.thumb_path);
    expect(names).not.toContain(fresh.object_path);

    expect((await client.rpc('service_attachment_orphan_objects', { p_limit: 1000 })).error?.code).toBe('42501');
    expect((await anonClient().rpc('service_attachment_orphan_objects', { p_limit: 1000 })).error?.code).toBe('42501');
  });

  test('refuses to confirm a reservation the allowance no longer counts', async () => {
    const { client, book, entry } = await newRider('confirm-expired');
    const row = (await reserve(client, book, entry)).data as unknown as Reserved;
    await upload(row.object_path, JPEG, 'image/jpeg');
    await upload(row.thumb_path!, JPEG, 'image/jpeg');

    const dayAndAnHourAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const aged = await admin.from('service_attachments').update({ created_at: dayAndAnHourAgo }).eq('id', row.id).select('id');
    expect(aged.data).toHaveLength(1);

    expect((await client.rpc('confirm_service_attachment', { p_attachment_id: row.id })).error?.code).toBe('TT404');
    const stored = await admin.from('service_attachments').select('status').eq('id', row.id).single();
    expect(stored.data!.status).toBe('pending');
  });

  test('the sweep deletes reservations nobody confirmed within a day, and nothing else', async () => {
    const { client, book, entry } = await newRider('sweep');
    const stale = (await reserve(client, book, entry)).data as unknown as Reserved;
    const fresh = (await reserve(client, book, entry)).data as unknown as Reserved;
    const kept = (await reserve(client, book, entry)).data as unknown as Reserved;
    await upload(kept.object_path, JPEG, 'image/jpeg');
    await upload(kept.thumb_path!, JPEG, 'image/jpeg');
    expect((await client.rpc('confirm_service_attachment', { p_attachment_id: kept.id })).error).toBeNull();

    const dayAndAnHourAgo = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const aged = await admin.from('service_attachments').update({ created_at: dayAndAnHourAgo }).in('id', [stale.id, kept.id]).select('id');
    expect(aged.data).toHaveLength(2);

    // Only the job may run it.
    expect((await client.rpc('purge_stale_service_attachments')).error?.code).toBe('42501');
    const swept = await admin.rpc('purge_stale_service_attachments');
    expect(swept.error, swept.error?.message).toBeNull();
    expect(swept.data).toBeGreaterThanOrEqual(1);

    const left = await admin.from('service_attachments').select('id').eq('book_id', book);
    expect(left.data!.map((row) => row.id).sort()).toEqual([fresh.id, kept.id].sort());
  });
});
