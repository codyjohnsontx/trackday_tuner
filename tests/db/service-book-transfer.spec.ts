import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getFreePlanLimit } from '@/lib/plans';
import { createTestAdminClient } from '@/tests/e2e/helpers/supabase';
import { createThrowawayRider, deleteThrowawayRider, type ThrowawayRider } from '@/tests/e2e/helpers/throwaway-rider';
import { runAsPostgres, startAsPostgres } from '@/tests/db/helpers/auth-database';
import { anonClient, createVehicle, signIn, type Client } from '@/tests/db/helpers/rider';
import type { Json } from '@/types/supabase';

/**
 * Handing a bike to a buyer (20261017000600), as two throwaway riders - and a
 * third who is neither - against a real database and a real storage API.
 *
 * The owner's rule (PQ2): the buyer gets a copy of the bike's sessions and
 * notes as they stand when they accept, the seller keeps theirs, and nothing
 * either adds afterwards reaches the other. With the owner's answers of
 * 2026-10-17: copies count toward no free cap (TQ1), the previous owner's
 * entries are remove-only for the buyer (TQ2), the seller's copy is read-only
 * and leaves their vehicle count (TQ3), one pending link per bike for fourteen
 * days (TQ4), no baseline (TQ5), receipts copied as uploaded (TQ6).
 *
 * The storage copies the server makes between prepare and accept are made here
 * with the service role, through the same `copy` the route will call.
 *
 * Part of `npm run test:db`, which CI runs on every pull request against a
 * local stack built from supabase/migrations - see playwright.db.config.ts.
 */

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const PDF = Buffer.from('%PDF-1.4\n%receipt\n');
const SESSION_CAP = getFreePlanLimit('sessions');
const ATTACHMENT_CAP = getFreePlanLimit('attachments');

interface Prepared {
  accepted: boolean;
  vehicle_id: string;
  book_id: string;
  attachments: { attachment_id: string; from_object: string; to_object: string; from_thumb: string | null; to_thumb: string | null }[];
  session_photos: { session_id: string; from_path: string; to_path: string }[];
  vehicle_photo: { from_path: string; to_path: string } | null;
}

interface Accepted {
  vehicle_id: string;
  book_id: string;
  entries: number;
  sessions: number;
  attachments: number;
}

interface Bike {
  rider: ThrowawayRider;
  client: Client;
  vehicle: string;
  book: string;
}

function token(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url');
  return { raw, hash: createHash('sha256').update(raw).digest('hex') };
}

function sessionFields(vehicleId: string, trackName = 'Road America', trackId: string | null = null): Json {
  const end = { brand: 'Pirelli', compound: 'SC1', pressure: '31' };
  const shock = { preload: '6', compression: '12', rebound: '10', direction: 'out' };
  return {
    vehicle_id: vehicleId,
    track_id: trackId,
    track_name: trackName,
    date: '2026-09-27',
    start_time: '09:40',
    conditions: 'sunny',
    tires: { front: end, rear: end, condition: 'scrubbed' },
    suspension: { front: shock, rear: shock },
    notes: 'Front pushing in turn 5.',
  };
}

test.describe('handing a service book to a buyer', () => {
  test.describe.configure({ timeout: 240_000 });

  let admin: Client;
  const riders: ThrowawayRider[] = [];

  async function rider(label: string, pro = false): Promise<{ rider: ThrowawayRider; client: Client }> {
    const made = await createThrowawayRider(`transfer-${label}`);
    riders.push(made);
    if (pro) {
      const upgraded = await admin.from('profiles').upsert({ id: made.id, tier: 'pro' }).select('id');
      expect(upgraded.error, upgraded.error?.message).toBeNull();
    }
    return { rider: made, client: await signIn(made) };
  }

  async function bike(label: string, pro = false): Promise<Bike> {
    const { rider: made, client } = await rider(label, pro);
    const vehicle = await createVehicle(client, made.id);
    const book = await client.from('service_books').insert({ vehicle_id: vehicle }).select('id').single();
    expect(book.error, book.error?.message).toBeNull();
    return { rider: made, client, vehicle, book: book.data!.id };
  }

  async function entry(client: Client, book: string, fields: Record<string, unknown> = {}, items: Json = [{ item_id: null, label: 'Oil change' }], parts: Json = null, entryId: string | null = null) {
    const saved = await client.rpc('save_service_entry', {
      p_book_id: book,
      p_entry_id: entryId,
      p_entry: { service_date: '2026-09-01', ...fields } as Json,
      p_items: items,
      p_parts: parts,
    });
    expect(saved.error, saved.error?.message).toBeNull();
    return saved.data as string;
  }

  async function session(client: Client, vehicle: string, trackName?: string, trackId?: string | null): Promise<string> {
    const id = randomUUID();
    const created = await client.rpc('create_session_with_laps', {
      p_session_id: id,
      p_session: sessionFields(vehicle, trackName, trackId ?? null),
      p_laps: [
        { lap_number: 1, lap_time_ms: 142_300, included: true },
        { lap_number: 2, lap_time_ms: 139_800, included: true },
      ],
      p_environment: { ambient_temperature_c: 21, humidity_percent: 40, weather_condition: 'dry' },
    });
    expect(created.error, created.error?.message).toBeNull();
    return id;
  }

  /** A receipt as the browser adds one: reserve, upload to the minted paths, confirm. */
  async function receipt(client: Client, book: string, entryId: string, mime: 'image/jpeg' | 'application/pdf' = 'application/pdf') {
    const reserved = await client.rpc('reserve_service_attachment', {
      p_book_id: book,
      p_entry_id: entryId,
      p_kind: 'receipt',
      p_mime: mime,
      p_bytes: 100,
    });
    expect(reserved.error, reserved.error?.message).toBeNull();
    const row = reserved.data as unknown as { id: string; object_path: string; thumb_path: string | null };
    await upload('service-book', row.object_path, mime === 'image/jpeg' ? JPEG : PDF, mime);
    if (row.thumb_path) await upload('service-book', row.thumb_path, JPEG, 'image/jpeg');
    const confirmed = await client.rpc('confirm_service_attachment', { p_attachment_id: row.id });
    expect(confirmed.error, confirmed.error?.message).toBeNull();
    return row.id;
  }

  async function upload(bucket: string, path: string, body: Buffer, contentType: string) {
    const sent = await admin.storage.from(bucket).upload(path, body, { contentType, upsert: true });
    expect(sent.error, `${bucket}/${path}: ${sent.error?.message}`).toBeNull();
  }

  function publicUrl(bucket: string, path: string): string {
    return admin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  async function hand(seller: Bike, to: string, overrides: Partial<{ hours: number | null; distance: number | null }> = {}) {
    const link = token();
    const created = await seller.client.rpc('create_service_book_transfer', {
      p_book_id: seller.book,
      p_to_email: to,
      p_token_hash: link.hash,
      p_handover_hours: overrides.hours ?? null,
      p_handover_distance: overrides.distance ?? null,
      p_time_zone: 'America/Chicago',
    });
    expect(created.error, created.error?.message).toBeNull();
    return { ...link, id: created.data as string };
  }

  async function prepare(client: Client, raw: string): Promise<Prepared> {
    const prepared = await client.rpc('prepare_service_book_transfer_accept', { p_token: raw });
    expect(prepared.error, prepared.error?.message).toBeNull();
    return prepared.data as unknown as Prepared;
  }

  /** What the server does between prepare and accept: every storage copy, then the photo URLs. */
  async function copyObjects(prepared: Prepared): Promise<Json> {
    for (const attachment of prepared.attachments) {
      expect((await admin.storage.from('service-book').copy(attachment.from_object, attachment.to_object)).error).toBeNull();
      if (attachment.from_thumb && attachment.to_thumb) {
        expect((await admin.storage.from('service-book').copy(attachment.from_thumb, attachment.to_thumb)).error).toBeNull();
      }
    }
    const sessions: Record<string, string> = {};
    for (const photo of prepared.session_photos) {
      expect((await admin.storage.from('session-photos').copy(photo.from_path, photo.to_path)).error).toBeNull();
      sessions[photo.session_id] = publicUrl('session-photos', photo.to_path);
    }
    let vehicle: string | null = null;
    if (prepared.vehicle_photo) {
      const { from_path, to_path } = prepared.vehicle_photo;
      expect((await admin.storage.from('vehicle-photos').copy(from_path, to_path)).error).toBeNull();
      vehicle = publicUrl('vehicle-photos', to_path);
    }
    return { vehicle, sessions };
  }

  async function takeOver(client: Client, raw: string): Promise<Accepted> {
    const urls = await copyObjects(await prepare(client, raw));
    const accepted = await client.rpc('accept_service_book_transfer', { p_token: raw, p_photo_urls: urls });
    expect(accepted.error, accepted.error?.message).toBeNull();
    return accepted.data as unknown as Accepted;
  }

  /** Every row describing a bike, read past RLS, keyed by table and in a stable order. */
  async function record(vehicle: string, book: string): Promise<Record<string, Record<string, unknown>[]>> {
    const sessions = await admin.from('sessions').select('*').eq('vehicle_id', vehicle).order('id');
    const sessionIds = (sessions.data ?? []).map((row) => row.id);
    const entries = await admin.from('service_entries').select('*').eq('book_id', book).order('id');
    const entryIds = (entries.data ?? []).map((row) => row.id);
    const reads = {
      vehicles: admin.from('vehicles').select('*').eq('id', vehicle),
      service_books: admin.from('service_books').select('*').eq('id', book),
      service_book_fields: admin.from('service_book_fields').select('*').eq('book_id', book).order('id'),
      service_items: admin.from('service_items').select('*').eq('book_id', book).order('id'),
      service_entry_items: admin.from('service_entry_items').select('*').in('entry_id', entryIds).order('id'),
      service_entry_parts: admin.from('service_entry_parts').select('*').in('entry_id', entryIds).order('id'),
      service_entry_revisions: admin.from('service_entry_revisions').select('*').in('entry_id', entryIds).order('id'),
      vehicle_readings: admin.from('vehicle_readings').select('*').eq('book_id', book).order('id'),
      service_attachments: admin.from('service_attachments').select('*').eq('book_id', book).order('id'),
      session_usage_weights: admin.from('session_usage_weights').select('*').eq('book_id', book).order('id'),
      service_due_overrides: admin.from('service_due_overrides').select('*').eq('book_id', book).order('id'),
      session_laps: admin.from('session_laps').select('*').in('session_id', sessionIds).order('id'),
      session_environment: admin.from('session_environment').select('*').in('session_id', sessionIds).order('id'),
      telemetry_summaries: admin.from('telemetry_summaries').select('*').in('session_id', sessionIds).order('id'),
      session_feedback: admin.from('session_feedback').select('*').in('session_id', sessionIds).order('id'),
      session_changes: admin.from('session_changes').select('*').in('session_id', sessionIds).order('id'),
    };
    const out: Record<string, Record<string, unknown>[]> = {
      sessions: sessions.data as Record<string, unknown>[],
      service_entries: entries.data as Record<string, unknown>[],
    };
    for (const [table, read] of Object.entries(reads)) {
      const { data, error } = await read;
      expect(error, `${table}: ${error?.message}`).toBeNull();
      out[table] = data as Record<string, unknown>[];
    }
    return out;
  }

  /** A bike with something in every table the copy reads, and a removed entry it must not. */
  async function fullBike(label: string) {
    const seller = await bike(label);
    const { client, rider: me, vehicle, book } = seller;

    // A photo of the bike, where the garage form puts it.
    await upload('vehicle-photos', `${me.id}/${vehicle}.jpg`, JPEG, 'image/jpeg');
    expect((await client.from('vehicles').update({ photo_url: publicUrl('vehicle-photos', `${me.id}/${vehicle}.jpg`) }).eq('id', vehicle)).error).toBeNull();

    const field = await client.from('service_book_fields').insert({ book_id: book, label: 'Oil brand', field_type: 'text' }).select('id').single();
    expect(field.error, field.error?.message).toBeNull();
    const items = await client
      .from('service_items')
      .insert([
        { book_id: book, name: 'Engine oil', interval_hours: 15 },
        { book_id: book, name: 'Old chain', archived_at: '2026-06-01T00:00:00Z' },
      ])
      .select('id, name');
    expect(items.error, items.error?.message).toBeNull();
    const oil = items.data!.find((item) => item.name === 'Engine oil')!.id;
    const chain = items.data!.find((item) => item.name === 'Old chain')!.id;

    // Edited twice: revisions 1 (created), 2 and 3 (edited).
    const edited = await entry(client, book, { reading_hours: 40, notes: 'first', custom_fields: { [field.data!.id]: 'Motul' } }, [{ item_id: oil }], [{ brand: 'Motul', part_number: '7100', quantity: 4 }]);
    // The second edit links the part to the item it was for, which the save form does not.
    const entryItem = await client.from('service_entry_items').select('id').eq('entry_id', edited).single();
    const linked = await client.from('service_entry_parts').update({ entry_item_id: entryItem.data!.id }).eq('entry_id', edited).select('id');
    expect(linked.data).toHaveLength(1);
    await entry(client, book, { reading_hours: 41, notes: 'third', custom_fields: { [field.data!.id]: 'Motul' } }, [{ item_id: oil }], [{ brand: 'Motul', part_number: '7100', quantity: 4 }], edited);
    const plain = await entry(client, book, { service_date: '2026-07-01' }, [{ item_id: chain }]);
    const removed = await entry(client, book, { service_date: '2026-05-01', notes: 'the seller took this back' });
    await receipt(client, book, removed);
    expect((await client.from('service_entries').update({ deleted_at: new Date().toISOString() }).eq('id', removed).select('id')).data).toHaveLength(1);

    const first = await client.from('vehicle_readings').insert({ book_id: book, reading_date: '2026-08-01', hours: 30 }).select('id').single();
    expect(first.error, first.error?.message).toBeNull();
    const corrected = await client.from('vehicle_readings').insert({ book_id: book, reading_date: '2026-08-01', hours: 31, supersedes_id: first.data!.id });
    expect(corrected.error, corrected.error?.message).toBeNull();

    const jpeg = await receipt(client, book, edited, 'image/jpeg');
    const pdf = await receipt(client, book, plain);

    // One session at a seeded circuit with a layout, one at the seller's own track, one with a photo.
    const layout = await admin.from('track_layouts').select('id, track_id').limit(1).single();
    const seeded = await session(client, vehicle, 'Seeded circuit', layout.data!.track_id);
    expect((await client.from('sessions').update({ layout_id: layout.data!.id }).eq('id', seeded)).error).toBeNull();
    const own = await client.from('tracks').insert({ name: `My track ${randomUUID()}`, created_by: me.id }).select('id').single();
    expect(own.error, own.error?.message).toBeNull();
    const custom = await session(client, vehicle, 'My track', own.data!.id);
    const photographed = await session(client, vehicle);
    await upload('session-photos', `${me.id}/${photographed}.jpg`, JPEG, 'image/jpeg');
    expect((await client.from('sessions').update({ photo_url: publicUrl('session-photos', `${me.id}/${photographed}.jpg`) }).eq('id', photographed)).error).toBeNull();

    // The laps already wrote each session's summary; the copy carries what a rider adds to it.
    expect((await client.from('telemetry_summaries').update({ summary: 'quick' }).eq('session_id', seeded).select('id')).data).toHaveLength(1);
    expect((await client.from('session_feedback').insert({ user_id: me.id, session_id: custom, vehicle_id: vehicle, outcome: 'better', notes: 'felt planted', reference_session_id: seeded })).error).toBeNull();
    expect((await client.from('session_changes').insert({ user_id: me.id, session_id: custom, vehicle_id: vehicle, reference_kind: 'previous', reference_session_id: seeded, reference_label: 'previous', changes: [] })).error).toBeNull();
    expect((await client.from('session_usage_weights').insert({ book_id: book, session_id: seeded, weight: 2 })).error).toBeNull();
    expect((await client.from('service_due_overrides').insert({ book_id: book, item_id: oil, kind: 'snooze', until_date: '2026-12-01' })).error).toBeNull();

    return { seller, field: field.data!.id, oil, chain, edited, plain, removed, jpeg, pdf, seeded, custom, photographed, ownTrack: own.data!.id };
  }

  test.beforeAll(() => {
    admin = createTestAdminClient();
  });

  test.afterAll(async () => {
    for (const made of riders) await deleteThrowawayRider(made);
  });

  test.describe('one handover of a bike with everything on it', () => {
    test.describe.configure({ mode: 'serial' });

    let bikeAtSale: Awaited<ReturnType<typeof fullBike>>;
    let buyer: { rider: ThrowawayRider; client: Client };
    let link: { raw: string; hash: string; id: string };
    let before: Awaited<ReturnType<typeof record>>;
    let accepted: Accepted;

    test.beforeAll(async () => {
      bikeAtSale = await fullBike('full');
      buyer = await rider('full-buyer');
      link = await hand(bikeAtSale.seller, `  ${buyer.rider.email.toUpperCase()} `, { hours: 52.5 });
      before = await record(bikeAtSale.seller.vehicle, bikeAtSale.seller.book);
      accepted = await takeOver(buyer.client, link.raw);
    });

    test('copies every row of the bike, under new ids, and leaves the seller\'s as they were but sold', async () => {
      const seller = bikeAtSale.seller;
      const after = await record(seller.vehicle, seller.book);
      const copy = await record(accepted.vehicle_id, accepted.book_id);

      // The seller's rows are what they were, but for the sale, the reading that
      // closed it and the zone the handover named, which now labels both copies.
      const sold = after.vehicles[0].sold_at as string | null;
      expect(sold).not.toBeNull();
      expect(before.service_books[0].owner_time_zone).toBeNull();
      expect(after.service_books[0].owner_time_zone).toBe('America/Chicago');
      expect({
        ...after,
        vehicles: [{ ...after.vehicles[0], sold_at: null, updated_at: null }],
        service_books: [{ ...after.service_books[0], owner_time_zone: null, updated_at: null }],
        vehicle_readings: after.vehicle_readings.filter((r) => r.source !== 'transfer'),
      }).toEqual({
        ...before,
        vehicles: [{ ...before.vehicles[0], updated_at: null }],
        service_books: [{ ...before.service_books[0], updated_at: null }],
      });
      const closing = after.vehicle_readings.filter((r) => r.source === 'transfer');
      expect(closing).toHaveLength(1);
      expect(Number(closing[0].hours)).toBe(52.5);

      const live = (rows: Record<string, unknown>[]) => rows.filter((row) => row.deleted_at === null);
      const liveIds = new Set(live(before.service_entries).map((row) => row.id));
      const expected: Record<string, number> = {
        vehicles: 1,
        service_books: 1,
        service_book_fields: before.service_book_fields.length,
        service_items: before.service_items.length,
        service_entries: liveIds.size,
        service_entry_items: before.service_entry_items.filter((row) => liveIds.has(row.entry_id)).length,
        service_entry_parts: before.service_entry_parts.filter((row) => liveIds.has(row.entry_id)).length,
        // The seller's history plus one `transferred` revision per entry.
        service_entry_revisions: before.service_entry_revisions.filter((row) => liveIds.has(row.entry_id)).length + liveIds.size,
        // Their rider readings, the entries' own and the opening reading at handover.
        vehicle_readings: before.vehicle_readings.filter((row) => row.source !== 'entry' || liveIds.has(row.entry_id)).length + 1,
        service_attachments: before.service_attachments.filter((row) => liveIds.has(row.entry_id) && row.status === 'ready').length,
        session_usage_weights: before.session_usage_weights.length,
        service_due_overrides: before.service_due_overrides.length,
        sessions: before.sessions.length,
        session_laps: before.session_laps.length,
        session_environment: before.session_environment.length,
        telemetry_summaries: before.telemetry_summaries.length,
        session_feedback: before.session_feedback.length,
        session_changes: before.session_changes.length,
      };
      for (const [table, count] of Object.entries(expected)) {
        expect(copy[table], table).toHaveLength(count);
        expect(count, `${table} has rows in the fixture`).toBeGreaterThan(0);
        const sellerIds = new Set(after[table].map((row) => row.id));
        for (const row of copy[table]) expect(sellerIds.has(row.id), `${table} reuses an id`).toBe(false);
      }
      expect(accepted).toMatchObject({ entries: liveIds.size, sessions: before.sessions.length, attachments: 2 });

      // Every copied row is the buyer's.
      expect(copy.vehicles[0]).toMatchObject({ user_id: buyer.rider.id, nickname: 'Test bike', make: 'Yamaha', sold_at: null });
      for (const table of ['sessions', 'session_laps', 'session_environment', 'telemetry_summaries', 'session_feedback', 'session_changes']) {
        for (const row of copy[table]) expect(row.user_id, table).toBe(buyer.rider.id);
      }
      expect(copy.service_books[0]).toMatchObject({
        transferred_from_book_id: seller.book,
        transferred_removed_entry_count: 1,
        owner_time_zone: 'America/Chicago',
      });
      expect(copy.service_books[0].transferred_at).not.toBeNull();

      // Not copied: the removed entry's content and its receipt.
      expect(copy.service_entries.map((row) => row.notes)).not.toContain('the seller took this back');

      // A seeded circuit and its layout come over; the seller's own track only as a name.
      const bySource = new Map(copy.sessions.map((row) => [row.copied_from_session_id as string, row]));
      const seededBefore = before.sessions.find((row) => row.id === bikeAtSale.seeded)!;
      expect(bySource.get(bikeAtSale.seeded)).toMatchObject({ track_id: seededBefore.track_id, layout_id: seededBefore.layout_id });
      expect(bySource.get(bikeAtSale.custom)).toMatchObject({ track_id: null, track_name: 'My track' });

      // The outcome keeps its reference to the copied session and drops any recommendation.
      expect(copy.session_feedback[0]).toMatchObject({ reference_session_id: bySource.get(bikeAtSale.seeded)!.id, recommendation_id: null });

      // Photos: the buyer's copies, in the buyer's folder, at URLs that open.
      const photo = bySource.get(bikeAtSale.photographed)!.photo_url as string;
      expect(photo).toContain(`/session-photos/${buyer.rider.id}/`);
      expect((await fetch(photo)).ok).toBe(true);
      expect(copy.vehicles[0].photo_url as string).toContain(`/vehicle-photos/${buyer.rider.id}/${accepted.vehicle_id}`);
      expect((await fetch(copy.vehicles[0].photo_url as string)).ok).toBe(true);
    });

    test('carries the history honestly: the seller\'s revisions, dates and author, then one `transferred` revision', async () => {
      const after = await record(bikeAtSale.seller.vehicle, bikeAtSale.seller.book);
      const copy = await record(accepted.vehicle_id, accepted.book_id);
      const source = after.service_entries.find((row) => row.id === bikeAtSale.edited)!;
      const copied = copy.service_entries.find((row) => row.copied_from_entry_id === bikeAtSale.edited)!;

      expect(source.revision).toBe(3);
      expect(copied.revision).toBe(4);
      for (const column of ['logged_at', 'logged_by', 'origin', 'service_date', 'notes', 'created_at']) {
        expect(copied[column], column).toEqual(source[column]);
      }
      const theirs = after.service_entry_revisions.filter((row) => row.entry_id === source.id).sort((a, b) => Number(a.revision) - Number(b.revision));
      const ours = copy.service_entry_revisions.filter((row) => row.entry_id === copied.id).sort((a, b) => Number(a.revision) - Number(b.revision));
      expect(ours.map((row) => row.kind)).toEqual(['created', 'edited', 'edited', 'transferred']);
      for (const [index, revision] of theirs.entries()) {
        expect(ours[index]).toMatchObject({
          revision: revision.revision,
          kind: revision.kind,
          snapshot: revision.snapshot,
          changed_at: revision.changed_at,
          changed_by: revision.changed_by,
        });
      }
      expect(ours[3].changed_by).toBe(buyer.rider.id);

      // The entry's reading is dated when the seller logged it.
      const reading = copy.vehicle_readings.find((row) => row.entry_id === copied.id)!;
      expect(reading).toMatchObject({ source: 'entry', read_at: source.logged_at });

      // Custom values are keyed by the buyer's field ids.
      const field = copy.service_book_fields.find((row) => row.label === 'Oil brand')!;
      expect(copied.custom_fields).toEqual({ [field.id as string]: 'Motul' });

      // A copied item names the buyer's copy of the item, and a part its copied item.
      const item = copy.service_items.find((row) => row.name === 'Engine oil')!;
      const entryItem = copy.service_entry_items.find((row) => row.entry_id === copied.id)!;
      expect(entryItem.item_id).toBe(item.id);
      expect(copy.service_entry_parts.find((row) => row.entry_id === copied.id)!.entry_item_id).toBe(entryItem.id);

      // A correction still supersedes its copied reading.
      const rider = copy.vehicle_readings.filter((row) => row.source === 'rider');
      expect(rider).toHaveLength(2);
      const correction = rider.find((row) => row.supersedes_id !== null)!;
      expect(rider.map((row) => row.id)).toContain(correction.supersedes_id);

      // A copied receipt: ready, the seller's upload date and author, its files in the buyer's book.
      const theirReceipt = after.service_attachments.find((row) => row.id === bikeAtSale.jpeg)!;
      const ourReceipt = copy.service_attachments.find((row) => row.copied_from_attachment_id === bikeAtSale.jpeg)!;
      expect(ourReceipt).toMatchObject({
        status: 'ready',
        entry_id: copied.id,
        uploaded_at: theirReceipt.uploaded_at,
        created_by: theirReceipt.created_by,
        bytes: theirReceipt.bytes,
        object_path: `${accepted.book_id}/${ourReceipt.id}.jpg`,
        thumb_path: `${accepted.book_id}/${ourReceipt.id}.thumb.jpg`,
      });
      const signed = await admin.storage.from('service-book').createSignedUrl(ourReceipt.object_path as string, 60);
      expect(Buffer.from(await (await fetch(signed.data!.signedUrl)).arrayBuffer()).equals(JPEG)).toBe(true);
    });

    test('a second accept returns the same bike and writes nothing', async () => {
      const copyBefore = await record(accepted.vehicle_id, accepted.book_id);
      const again = await buyer.client.rpc('accept_service_book_transfer', { p_token: link.raw, p_photo_urls: {} });
      expect(again.error, again.error?.message).toBeNull();
      expect(again.data).toEqual(accepted);
      const prepared = await prepare(buyer.client, link.raw);
      expect(prepared).toMatchObject({ accepted: true, vehicle_id: accepted.vehicle_id, attachments: [] });
      const vehicles = await admin.from('vehicles').select('id').eq('user_id', buyer.rider.id);
      expect(vehicles.data).toHaveLength(1);
      expect(await record(accepted.vehicle_id, accepted.book_id)).toEqual(copyBefore);
    });

    test('severs the two copies: what either adds afterwards, and what anyone else sees', async () => {
      const seller = bikeAtSale.seller;
      const sellerBefore = await record(seller.vehicle, seller.book);

      // The buyer logs on their bike; copies count toward nothing, so a free buyer can.
      await entry(buyer.client, accepted.book_id, { notes: 'after the sale' });
      expect((await buyer.client.from('vehicle_readings').insert({ book_id: accepted.book_id, reading_date: '2026-10-17', hours: 60 })).error).toBeNull();
      const buyerSession = await session(buyer.client, accepted.vehicle_id);

      expect(await record(seller.vehicle, seller.book)).toEqual(sellerBefore);

      const third = await rider('full-third');
      const reads = async (client: Client, vehicle: string, book: string) => {
        const counts = await Promise.all([
          client.from('vehicles').select('id').eq('id', vehicle),
          client.from('service_books').select('id').eq('id', book),
          client.from('service_entries').select('id').eq('book_id', book),
          client.from('vehicle_readings').select('id').eq('book_id', book),
          client.from('service_attachments').select('id').eq('book_id', book),
          client.from('sessions').select('id').eq('vehicle_id', vehicle),
        ]);
        for (const { error } of counts) expect(error, error?.message).toBeNull();
        return counts.map(({ data }) => data!.length);
      };
      const none = [0, 0, 0, 0, 0, 0];
      expect(await reads(seller.client, accepted.vehicle_id, accepted.book_id)).toEqual(none);
      expect(await reads(buyer.client, seller.vehicle, seller.book)).toEqual(none);
      expect(await reads(third.client, seller.vehicle, seller.book)).toEqual(none);
      expect(await reads(third.client, accepted.vehicle_id, accepted.book_id)).toEqual(none);
      expect((await seller.client.from('sessions').select('id').eq('id', buyerSession)).data).toEqual([]);
      // Each still reads their own.
      expect((await reads(seller.client, seller.vehicle, seller.book)).every((count) => count > 0)).toBe(true);
      expect((await reads(buyer.client, accepted.vehicle_id, accepted.book_id)).every((count) => count > 0)).toBe(true);
    });

    test('the seller\'s copy is read-only: every write is refused and every read still answers', async () => {
      const { client, vehicle, book } = bikeAtSale.seller;

      const created = await client.rpc('create_session_with_laps', {
        p_session_id: randomUUID(),
        p_session: sessionFields(vehicle),
        p_laps: [],
        p_environment: null,
      });
      expect(created.error?.code).toBe('TT410');
      const inserted = await client.from('sessions').insert({
        user_id: bikeAtSale.seller.rider.id,
        vehicle_id: vehicle,
        date: '2026-10-17',
        conditions: 'sunny',
        tires: {},
        suspension: {},
      } as never);
      expect(inserted.error?.code).toBe('TT410');
      expect((await client.rpc('save_service_entry', { p_book_id: book, p_entry_id: null, p_entry: { service_date: '2026-10-17' }, p_items: [{ label: 'x' }], p_parts: null })).error?.code).toBe('TT410');
      expect((await client.rpc('save_service_entry', { p_book_id: book, p_entry_id: bikeAtSale.plain, p_entry: { service_date: '2026-10-17' }, p_items: [{ label: 'x' }], p_parts: null })).error?.code).toBe('TT410');
      expect((await client.rpc('reserve_service_attachment', { p_book_id: book, p_entry_id: bikeAtSale.plain, p_kind: 'receipt', p_mime: 'application/pdf', p_bytes: 10 })).error?.code).toBe('TT410');
      expect((await client.from('vehicle_readings').insert({ book_id: book, reading_date: '2026-10-17', hours: 99 })).error?.code).toBe('42501');
      expect((await client.from('service_items').insert({ book_id: book, name: 'New item' })).error?.code).toBe('42501');
      expect((await client.from('service_entries').update({ notes: 'rewritten' }).eq('id', bikeAtSale.plain).select('id')).data).toEqual([]);
      expect((await client.from('service_entry_items').delete().eq('entry_id', bikeAtSale.plain).select('id')).data).toEqual([]);
      expect((await client.from('session_usage_weights').delete().eq('book_id', book).select('id')).data).toEqual([]);
      expect((await client.from('service_books').update({ tracks_distance: true }).eq('id', book).select('id')).data).toEqual([]);
      expect((await client.rpc('create_service_book_transfer', { p_book_id: book, p_to_email: 'next@example.com', p_token_hash: token().hash, p_handover_hours: null, p_handover_distance: null, p_time_zone: null })).error?.code).toBe('TT410');

      // Reads still answer, and the bike still leaves its rider free to add another.
      expect((await client.from('service_entries').select('id').eq('book_id', book)).data!.length).toBeGreaterThan(0);
      expect((await client.from('sessions').select('id').eq('vehicle_id', vehicle)).data!.length).toBeGreaterThan(0);
      const nextBike = await createVehicle(client, bikeAtSale.seller.rider.id);
      expect((await client.from('service_books').insert({ vehicle_id: nextBike }).select('id')).error).toBeNull();
    });

    test('the previous owner\'s entries are remove-only for the buyer', async () => {
      const copy = await record(accepted.vehicle_id, accepted.book_id);
      const copied = copy.service_entries.find((row) => row.copied_from_entry_id === bikeAtSale.plain)!;
      const id = copied.id as string;

      expect((await buyer.client.rpc('save_service_entry', { p_book_id: accepted.book_id, p_entry_id: id, p_entry: { service_date: '2026-10-17' }, p_items: [{ label: 'x' }], p_parts: null })).error?.code).toBe('TT403');
      expect((await buyer.client.from('service_entries').update({ notes: 'rewritten' }).eq('id', id)).error?.code).toBe('TT403');
      expect((await buyer.client.from('service_entry_items').update({ label: 'rewritten' }).eq('entry_id', id).select('id')).data).toEqual([]);
      expect((await buyer.client.from('service_entry_items').delete().eq('entry_id', id).select('id')).data).toEqual([]);
      expect((await buyer.client.from('service_entry_items').insert({ entry_id: id, label: 'added' })).error?.code).toBe('42501');

      const removedNow = await buyer.client.from('service_entries').update({ deleted_at: new Date().toISOString() }).eq('id', id).select('id');
      expect(removedNow.error, removedNow.error?.message).toBeNull();
      expect(removedNow.data).toHaveLength(1);
      const revisions = await admin.from('service_entry_revisions').select('revision, kind').eq('entry_id', id).order('revision');
      expect(revisions.data!.at(-1)).toEqual({ revision: Number(copied.revision) + 1, kind: 'deleted' });
      const stored = await admin.from('service_entries').select('notes, deleted_at').eq('id', id).single();
      expect(stored.data!.notes).toBe(copied.notes);
      expect(stored.data!.deleted_at).not.toBeNull();

      // The buyer's own entry stays theirs to edit.
      const mine = await entry(buyer.client, accepted.book_id, { notes: 'mine' });
      await entry(buyer.client, accepted.book_id, { notes: 'mine, edited' }, [{ item_id: null, label: 'Oil change' }], null, mine);
    });
  });

  test('refuses the wrong account, the seller, an expired or cancelled link, a second link and a free buyer with a bike, writing nothing', async () => {
    const seller = await bike('refusals');
    const buyer = await rider('refusals-buyer');
    const stranger = await rider('refusals-stranger');
    await entry(seller.client, seller.book);
    await session(seller.client, seller.vehicle);

    const writes = async () => {
      const [vehicles, books, transfers] = await Promise.all([
        admin.from('vehicles').select('id', { count: 'exact', head: true }).in('user_id', [seller.rider.id, buyer.rider.id, stranger.rider.id]),
        admin.from('service_books').select('id', { count: 'exact', head: true }).eq('transferred_from_book_id', seller.book),
        admin.from('service_book_transfers').select('*').eq('book_id', seller.book).order('id'),
      ]);
      return { vehicles: vehicles.count, books: books.count, transfers: transfers.data, sold: (await admin.from('vehicles').select('sold_at').eq('id', seller.vehicle).single()).data!.sold_at };
    };

    const link = await hand(seller, buyer.rider.email);

    // A second pending link on the same bike, and a link to the seller's own address.
    expect((await seller.client.rpc('create_service_book_transfer', { p_book_id: seller.book, p_to_email: 'someone@example.com', p_token_hash: token().hash, p_handover_hours: null, p_handover_distance: null, p_time_zone: null })).error?.code).toBe('TT409');
    expect((await stranger.client.rpc('create_service_book_transfer', { p_book_id: seller.book, p_to_email: 'someone@example.com', p_token_hash: token().hash, p_handover_hours: null, p_handover_distance: null, p_time_zone: null })).error?.code).toBe('TT404');

    const start = await writes();
    const refused = async (client: Client, raw: string, code: string) => {
      expect((await client.rpc('prepare_service_book_transfer_accept', { p_token: raw })).error?.code).toBe(code);
      expect((await client.rpc('accept_service_book_transfer', { p_token: raw, p_photo_urls: {} })).error?.code).toBe(code);
    };
    await refused(stranger.client, link.raw, 'TT403');
    await refused(seller.client, link.raw, 'TT403');
    await refused(buyer.client, token().raw, 'TT404');
    await refused(anonClient(), link.raw, '42501');

    // A free buyer who already has a bike; Pro, or a free buyer whose only bike is sold, may.
    const ownBike = await createVehicle(buyer.client, buyer.rider.id);
    const holding = await writes();
    await refused(buyer.client, link.raw, 'TT402');
    expect(await writes()).toEqual(holding);
    expect(holding).toEqual({ ...start, vehicles: Number(start.vehicles) + 1 });
    expect((await admin.from('profiles').upsert({ id: buyer.rider.id, tier: 'pro' }).select('id')).error).toBeNull();
    expect((await buyer.client.rpc('prepare_service_book_transfer_accept', { p_token: link.raw })).error).toBeNull();
    expect((await admin.from('profiles').upsert({ id: buyer.rider.id, tier: 'free' }).select('id')).error).toBeNull();
    const ownBook = await buyer.client.from('service_books').insert({ vehicle_id: ownBike }).select('id').single();
    const nextOwner = await rider('refusals-next-owner');
    const resale = await hand({ rider: buyer.rider, client: buyer.client, vehicle: ownBike, book: ownBook.data!.id }, nextOwner.rider.email);
    await takeOver(nextOwner.client, resale.raw);
    expect((await buyer.client.rpc('prepare_service_book_transfer_accept', { p_token: link.raw })).error).toBeNull();

    // Expired: still pending, past fourteen days.
    const aged = runAsPostgres(`update public.service_book_transfers set expires_at = now() - interval '1 second' where id = '${link.id}';`);
    expect(aged.ok, aged.stderr).toBe(true);
    const expiredStart = await writes();
    await refused(buyer.client, link.raw, 'TT404');
    expect(await writes()).toEqual(expiredStart);

    // Cancelled: refused, and a new link can be sent.
    expect((await stranger.client.rpc('cancel_service_book_transfer', { p_transfer_id: link.id })).data).toBe(false);
    expect((await seller.client.rpc('cancel_service_book_transfer', { p_transfer_id: link.id })).data).toBe(true);
    await refused(buyer.client, link.raw, 'TT404');
    const reissued = await hand(seller, buyer.rider.email);
    const cancelledStart = await writes();
    await refused(buyer.client, link.raw, 'TT404');
    expect(await writes()).toEqual(cancelledStart);
    await takeOver(buyer.client, reissued.raw);
  });

  test('copied sessions and receipts count toward no free cap; the buyer\'s own still do', async () => {
    const seller = await bike('caps', true);
    const pdfEntry = await entry(seller.client, seller.book);
    for (let index = 0; index < SESSION_CAP + 1; index += 1) await session(seller.client, seller.vehicle);
    for (let index = 0; index < ATTACHMENT_CAP; index += 1) await receipt(seller.client, seller.book, pdfEntry);

    const buyer = await rider('caps-buyer');
    const link = await hand(seller, buyer.rider.email);
    const accepted = await takeOver(buyer.client, link.raw);
    expect(accepted).toMatchObject({ sessions: SESSION_CAP + 1, attachments: ATTACHMENT_CAP });
    const copies = await admin.from('sessions').select('original_user_id').eq('vehicle_id', accepted.vehicle_id);
    expect(new Set(copies.data!.map((row) => row.original_user_id))).toEqual(new Set([seller.rider.id]));

    for (let index = 0; index < SESSION_CAP; index += 1) await session(buyer.client, accepted.vehicle_id);
    const eleventh = await buyer.client.rpc('create_session_with_laps', {
      p_session_id: randomUUID(),
      p_session: sessionFields(accepted.vehicle_id),
      p_laps: [],
      p_environment: null,
    });
    expect(eleventh.error?.code).toBe('TT402');

    const copiedEntry = (await admin.from('service_entries').select('id').eq('book_id', accepted.book_id).single()).data!.id;
    const own = await entry(buyer.client, accepted.book_id);
    const reserve = (entryId: string) =>
      buyer.client.rpc('reserve_service_attachment', { p_book_id: accepted.book_id, p_entry_id: entryId, p_kind: 'receipt', p_mime: 'application/pdf', p_bytes: 10 });
    // The previous owner's entry takes no receipt of the buyer's; the buyer's own takes the whole allowance.
    expect((await reserve(copiedEntry)).error?.code).toBe('TT403');
    for (let index = 0; index < ATTACHMENT_CAP; index += 1) expect((await reserve(own)).error).toBeNull();
    expect((await reserve(own)).error?.code).toBe('TT402');
  });

  test('a bike handed back to the rider who logged its history brings no free sessions or receipts with it', async () => {
    // A fills the free caps on their bike and hands it to B; B logs one session
    // of their own and hands it back; A deletes the sold copy they kept.
    const first = await bike('loop-a');
    const receiptEntry = await entry(first.client, first.book);
    for (let index = 0; index < SESSION_CAP; index += 1) await session(first.client, first.vehicle);
    for (let index = 0; index < ATTACHMENT_CAP; index += 1) await receipt(first.client, first.book, receiptEntry);

    const second = await rider('loop-b');
    const toSecond = await takeOver(second.client, (await hand(first, second.rider.email)).raw);
    await session(second.client, toSecond.vehicle_id);
    const secondBike: Bike = { ...second, vehicle: toSecond.vehicle_id, book: toSecond.book_id };

    const back = await hand(secondBike, first.rider.email);
    expect((await first.client.from('vehicles').delete().eq('id', first.vehicle).select('id')).data).toHaveLength(1);
    const toFirst = await takeOver(first.client, back.raw);
    expect(toFirst).toMatchObject({ sessions: SESSION_CAP + 1, attachments: ATTACHMENT_CAP });

    const another = await first.client.rpc('create_session_with_laps', {
      p_session_id: randomUUID(),
      p_session: sessionFields(toFirst.vehicle_id),
      p_laps: [],
      p_environment: null,
    });
    expect(another.error?.code).toBe('TT402');
    const ownEntry = await entry(first.client, toFirst.book_id);
    const reserved = await first.client.rpc('reserve_service_attachment', {
      p_book_id: toFirst.book_id,
      p_entry_id: ownEntry,
      p_kind: 'receipt',
      p_mime: 'application/pdf',
      p_bytes: 10,
    });
    expect(reserved.error?.code).toBe('TT402');
  });

  test('a book counts every entry removed across its whole history', async () => {
    const first = await bike('removed-1');
    await entry(first.client, first.book, { notes: 'kept' });
    for (let index = 0; index < 3; index += 1) {
      const removed = await entry(first.client, first.book);
      expect((await first.client.from('service_entries').update({ deleted_at: new Date().toISOString() }).eq('id', removed).select('id')).data).toHaveLength(1);
    }
    const second = await rider('removed-2');
    const toSecond = await takeOver(second.client, (await hand(first, second.rider.email)).raw);
    expect((await admin.from('service_books').select('transferred_removed_entry_count').eq('id', toSecond.book_id).single()).data!.transferred_removed_entry_count).toBe(3);

    const removed = await entry(second.client, toSecond.book_id);
    expect((await second.client.from('service_entries').update({ deleted_at: new Date().toISOString() }).eq('id', removed).select('id')).data).toHaveLength(1);
    const third = await rider('removed-3');
    const link = await hand({ ...second, vehicle: toSecond.vehicle_id, book: toSecond.book_id }, third.rider.email);
    const summary = await admin.from('service_book_transfers').select('summary').eq('id', link.id).single();
    expect(summary.data!.summary).toMatchObject({ removed_entries: 4 });
    const toThird = await takeOver(third.client, link.raw);
    expect((await admin.from('service_books').select('transferred_removed_entry_count').eq('id', toThird.book_id).single()).data!.transferred_removed_entry_count).toBe(4);
  });

  test('a session logged after prepare makes accept TT409 with nothing written, and preparing again lets it through', async () => {
    const seller = await bike('stale');
    await entry(seller.client, seller.book);
    await session(seller.client, seller.vehicle);
    const buyer = await rider('stale-buyer');
    const link = await hand(seller, buyer.rider.email);

    const urls = await copyObjects(await prepare(buyer.client, link.raw));
    const late = await session(seller.client, seller.vehicle);
    const stale = await buyer.client.rpc('accept_service_book_transfer', { p_token: link.raw, p_photo_urls: urls });
    expect(stale.error?.code).toBe('TT409');
    expect((await admin.from('vehicles').select('id').eq('user_id', buyer.rider.id)).data).toEqual([]);
    expect((await admin.from('vehicles').select('sold_at').eq('id', seller.vehicle).single()).data!.sold_at).toBeNull();

    const accepted = await takeOver(buyer.client, link.raw);
    expect(accepted.sessions).toBe(2);
    const copied = await admin.from('sessions').select('copied_from_session_id').eq('vehicle_id', accepted.vehicle_id);
    expect(copied.data!.map((row) => row.copied_from_session_id)).toContain(late);
  });

  test('a write that meets a running accept waits for it, then finds the bike sold and writes nothing', async () => {
    const seller = await bike('race');
    const holder = `transfer-race-${randomUUID()}`;
    // Accept's first step and its last, with time between them for the writes to arrive.
    const sale = startAsPostgres(`
      set application_name = '${holder}';
      select 1 from public.vehicles where id = '${seller.vehicle}' for update;
      select pg_sleep(3);
      update public.vehicles set sold_at = now() where id = '${seller.vehicle}';
    `);
    await expect
      .poll(() => runAsPostgres(`select count(*) from pg_stat_activity where application_name = '${holder}' and query like '%pg_sleep%';`).stdout, { timeout: 15_000 })
      .toBe('1');

    const [created, reading, saved] = await Promise.all([
      seller.client.rpc('create_session_with_laps', {
        p_session_id: randomUUID(),
        p_session: sessionFields(seller.vehicle),
        p_laps: [],
        p_environment: null,
      }),
      seller.client.from('vehicle_readings').insert({ book_id: seller.book, reading_date: '2026-10-17', hours: 12 }),
      seller.client.rpc('save_service_entry', { p_book_id: seller.book, p_entry_id: null, p_entry: { service_date: '2026-10-17' }, p_items: [{ label: 'x' }], p_parts: null }),
    ]);
    const sold = await sale;
    expect(sold.ok, sold.stderr).toBe(true);

    expect(created.error?.code).toBe('TT410');
    expect(reading.error?.code).toBe('42501');
    expect(saved.error?.code).toBe('TT410');
    expect((await admin.from('sessions').select('id').eq('vehicle_id', seller.vehicle)).data).toEqual([]);
    expect((await admin.from('vehicle_readings').select('id').eq('book_id', seller.book)).data).toEqual([]);
    expect((await admin.from('service_entries').select('id').eq('book_id', seller.book)).data).toEqual([]);
  });

  test('a receipt or photo missing from storage makes accept TT409 with nothing written', async () => {
    const seller = await bike('missing');
    const withReceipt = await entry(seller.client, seller.book);
    await receipt(seller.client, seller.book, withReceipt, 'image/jpeg');
    const photographed = await session(seller.client, seller.vehicle);
    await upload('session-photos', `${seller.rider.id}/${photographed}.jpg`, JPEG, 'image/jpeg');
    expect((await seller.client.from('sessions').update({ photo_url: publicUrl('session-photos', `${seller.rider.id}/${photographed}.jpg`) }).eq('id', photographed)).error).toBeNull();
    const buyer = await rider('missing-buyer');
    const link = await hand(seller, buyer.rider.email);

    const prepared = await prepare(buyer.client, link.raw);
    const urls = await copyObjects(prepared);
    const accept = (photoUrls: Json) => buyer.client.rpc('accept_service_book_transfer', { p_token: link.raw, p_photo_urls: photoUrls });
    const nothingWritten = async () => {
      expect((await admin.from('vehicles').select('id').eq('user_id', buyer.rider.id)).data).toEqual([]);
      expect((await admin.from('service_book_transfers').select('status').eq('id', link.id).single()).data!.status).toBe('pending');
    };

    // The thumbnail of the copied receipt is gone.
    const thumb = prepared.attachments[0].to_thumb!;
    expect((await admin.storage.from('service-book').remove([thumb])).error).toBeNull();
    expect((await accept(urls)).error?.code).toBe('TT409');
    await nothingWritten();
    expect((await admin.storage.from('service-book').copy(prepared.attachments[0].from_thumb!, thumb)).error).toBeNull();

    // The session photo was copied but its URL not passed, or passed for another object.
    expect((await accept({ ...(urls as Record<string, Json>), sessions: {} })).error?.code).toBe('TT409');
    expect((await accept({ ...(urls as Record<string, Json>), sessions: { [prepared.session_photos[0].session_id]: publicUrl('session-photos', `${buyer.rider.id}/elsewhere.jpg`) } })).error?.code).toBe('TT409');
    await nothingWritten();

    const accepted = await accept(urls);
    expect(accepted.error, accepted.error?.message).toBeNull();
  });

  test('a rider cannot write what only the handover writes', async () => {
    const owner = await bike('pins');
    const plainSession = await session(owner.client, owner.vehicle);

    // `copied_from_session_id` and `original_user_id` on a rider's own insert or update are not theirs to set.
    const id = randomUUID();
    const inserted = await owner.client.from('sessions').insert({
      id,
      user_id: owner.rider.id,
      vehicle_id: owner.vehicle,
      date: '2026-10-17',
      conditions: 'sunny',
      tires: {},
      suspension: {},
      copied_from_session_id: plainSession,
      original_user_id: randomUUID(),
    } as never);
    expect(inserted.error, inserted.error?.message).toBeNull();
    const origin = () => admin.from('sessions').select('copied_from_session_id, original_user_id').eq('id', id).single();
    expect((await origin()).data).toEqual({ copied_from_session_id: null, original_user_id: null });
    expect((await owner.client.from('sessions').update({ copied_from_session_id: plainSession, original_user_id: randomUUID() } as never).eq('id', id)).error).toBeNull();
    expect((await origin()).data).toEqual({ copied_from_session_id: null, original_user_id: null });

    // Nor `sold_at`, on insert or update - not even by the service role.
    const marked = await owner.client.from('vehicles').update({ sold_at: new Date().toISOString() } as never).eq('id', owner.vehicle);
    expect(marked.error, marked.error?.message).toBeNull();
    expect((await admin.from('vehicles').update({ sold_at: new Date().toISOString() } as never).eq('id', owner.vehicle)).error).toBeNull();
    const born = await owner.client.from('vehicles').insert({ user_id: owner.rider.id, nickname: 'Sold?', type: 'motorcycle', sold_at: new Date().toISOString() } as never).select('id').single();
    expect(born.error, born.error?.message).toBeNull();
    const sold = await admin.from('vehicles').select('sold_at').in('id', [owner.vehicle, (born.data as { id: string }).id]);
    expect(sold.data!.map((row) => row.sold_at)).toEqual([null, null]);

    // Nor a book's transfer origin, nor an attachment row at all.
    expect((await owner.client.from('service_books').update({ transferred_removed_entry_count: 3 } as never).eq('id', owner.book)).error?.code).toBe('42501');
    expect((await owner.client.from('service_books').update({ transferred_from_book_id: owner.book } as never).eq('id', owner.book)).error?.code).toBe('42501');
  });

  test('the handover row is the seller\'s to read, less its hash, and nobody\'s to write', async () => {
    const seller = await bike('rows');
    const buyer = await rider('rows-buyer');
    const third = await rider('rows-third');
    const link = await hand(seller, buyer.rider.email);

    const seen = await seller.client.from('service_book_transfers').select('id, status, to_email_normalized').eq('id', link.id);
    expect(seen.error, seen.error?.message).toBeNull();
    expect(seen.data).toEqual([{ id: link.id, status: 'pending', to_email_normalized: buyer.rider.email.toLowerCase() }]);
    expect((await seller.client.from('service_book_transfers').select('token_hash').eq('id', link.id)).error?.code).toBe('42501');
    for (const client of [buyer.client, third.client, anonClient()]) {
      const read = await client.from('service_book_transfers').select('id').eq('id', link.id);
      expect(read.data ?? []).toEqual([]);
    }

    for (const client of [seller.client, buyer.client, admin]) {
      expect((await client.from('service_book_transfers').update({ status: 'accepted' } as never).eq('id', link.id)).error?.code).toBe('42501');
      expect((await client.from('service_book_transfers').delete().eq('id', link.id)).error?.code).toBe('42501');
      expect((await client.from('service_book_transfers').insert({ book_id: seller.book } as never)).error?.code).toBe('42501');
    }

    // The link page's read: the bike only to the address it was sent to.
    const describe = (viewerId: string | null, email: string | null, raw = link.raw) =>
      admin.rpc('describe_service_book_transfer', { p_token: raw, p_viewer_id: viewerId, p_viewer_email: email });
    expect((await describe(null, null)).data).toEqual({ status: 'pending', viewer: 'signed_out' });
    expect((await describe(seller.rider.id, seller.rider.email)).data).toEqual({ status: 'pending', viewer: 'seller' });
    expect((await describe(third.rider.id, third.rider.email)).data).toEqual({ status: 'pending', viewer: 'other' });
    expect((await describe(buyer.rider.id, buyer.rider.email)).data).toMatchObject({ status: 'pending', viewer: 'recipient', bike: { nickname: 'Test bike' }, summary: { sessions: 0 } });
    expect((await describe(buyer.rider.id, buyer.rider.email, token().raw)).data).toEqual({ status: 'not_found' });
    for (const client of [seller.client, buyer.client, anonClient()]) {
      expect((await client.rpc('describe_service_book_transfer', { p_token: link.raw, p_viewer_id: null, p_viewer_email: null })).error?.code).toBe('42501');
    }
    expect((await admin.rpc('prepare_service_book_transfer_accept', { p_token: link.raw })).error?.code).toBe('42501');

    const accepted = await takeOver(buyer.client, link.raw);
    expect((await describe(buyer.rider.id, buyer.rider.email)).data).toEqual({ status: 'accepted', viewer: 'recipient', vehicle_id: accepted.vehicle_id });
    expect((await describe(third.rider.id, buyer.rider.email)).data).toEqual({ status: 'accepted', viewer: 'other' });
  });
});
