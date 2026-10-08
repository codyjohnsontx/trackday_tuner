import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { createTestAdminClient } from '@/tests/e2e/helpers/supabase';
import {
  createThrowawayRider,
  deleteThrowawayRider,
  type ThrowawayRider,
} from '@/tests/e2e/helpers/throwaway-rider';
import { anonClient, createVehicle, signIn, type Client } from '@/tests/db/helpers/rider';
import type { TableInsert, TableUpdate } from '@/types/supabase';

/**
 * The service book schema (20261010000100, 20261010000200) against a real
 * database, written to as a signed-in rider through the Data API - the position
 * the website and the phone write from - and read back through the service role.
 *
 * - another rider's book, entries, history and readings are invisible to a
 *   rider and refuse their writes;
 * - an edit writes a revision, and a rider cannot write one;
 * - `logged_at` is the server's clock: a rider cannot set it on insert or move
 *   it on update, and even the service role's value is replaced;
 * - an entry carrying a reading writes a `vehicle_readings` row that follows
 *   the entry;
 * - a rider's reading is never updated or deleted, by the rider or the service
 *   role: a correction supersedes it, once, from the same book, and the old
 *   value stays;
 * - `delete` on entries is refused, and removing one is a soft delete that the
 *   history records;
 * - a usage weight only counts a session from the book's own vehicle;
 * - deleting the vehicle still takes the whole book with it.
 *
 * Part of `npm run test:db`, which CI runs on every pull request against a
 * local stack built from supabase/migrations - see playwright.db.config.ts.
 */

/** A write naming columns the typed client does not offer, sent as-is so the database answers it. */
function untyped<T = never>(value: Record<string, unknown>): T {
  return value as unknown as T;
}

function secondsFromNow(timestamp: string): number {
  return Math.abs(Date.now() - new Date(timestamp).getTime()) / 1000;
}

test.describe('the service book as riders, as nobody and as the service role', () => {
  let admin: Client;
  let alice: ThrowawayRider | null = null;
  let bob: ThrowawayRider | null = null;
  let aliceClient: Client;
  let bobClient: Client;
  let aliceVehicle: string;
  let aliceBook: string;
  let aliceItem: string;

  async function createEntry(fields: Partial<TableInsert<'service_entries'>> = {}): Promise<string> {
    const { data, error } = await aliceClient
      .from('service_entries')
      .insert({ book_id: aliceBook, service_date: '2026-10-01', notes: 'Oil and filter.', ...fields })
      .select('id')
      .single();
    expect(error, error?.message).toBeNull();
    return data!.id;
  }

  async function revisions(entryId: string) {
    const { data, error } = await admin
      .from('service_entry_revisions')
      .select('revision, kind, snapshot')
      .eq('entry_id', entryId)
      .order('revision');
    expect(error, error?.message).toBeNull();
    return data!;
  }

  async function readingsFor(entryId: string) {
    const { data, error } = await admin
      .from('vehicle_readings')
      .select('book_id, reading_date, hours, distance, source, entry_id')
      .eq('entry_id', entryId);
    expect(error, error?.message).toBeNull();
    return data!;
  }

  test.beforeAll(async () => {
    admin = createTestAdminClient();
    alice = await createThrowawayRider('service-book-alice');
    bob = await createThrowawayRider('service-book-bob');
    aliceClient = await signIn(alice);
    bobClient = await signIn(bob);
    aliceVehicle = await createVehicle(aliceClient, alice.id);

    const book = await aliceClient.from('service_books').insert({ vehicle_id: aliceVehicle }).select('id').single();
    expect(book.error, book.error?.message).toBeNull();
    aliceBook = book.data!.id;

    const item = await aliceClient
      .from('service_items')
      .insert({ book_id: aliceBook, name: 'Engine oil and filter', source: 'starter' })
      .select('id')
      .single();
    expect(item.error, item.error?.message).toBeNull();
    aliceItem = item.data!.id;
  });

  test.afterAll(async () => {
    await deleteThrowawayRider(alice);
    await deleteThrowawayRider(bob);
  });

  test('hides another rider’s book, entries, history and readings, and refuses their writes', async () => {
    const entryId = await createEntry({ reading_hours: 42 });

    for (const [table, column, value] of [
      ['service_books', 'id', aliceBook],
      ['service_items', 'book_id', aliceBook],
      ['service_entries', 'book_id', aliceBook],
      ['vehicle_readings', 'book_id', aliceBook],
      ['service_entry_revisions', 'entry_id', entryId],
    ] as const) {
      const { data, error } = await bobClient.from(table).select('id').eq(column, value);
      expect(error, `${table}: ${error?.message}`).toBeNull();
      expect(data, table).toEqual([]);
    }

    const intoHerBook = await bobClient.from('service_entries').insert({ book_id: aliceBook, service_date: '2026-10-02' });
    expect(intoHerBook.error?.code).toBe('42501');

    const onHerBike = await bobClient.from('service_books').insert({ vehicle_id: aliceVehicle });
    expect(onHerBike.error?.code).toBe('42501');

    const edit = await bobClient.from('service_entries').update({ notes: 'Bob was here.' }).eq('id', entryId).select('id');
    expect(edit.error, edit.error?.message).toBeNull();
    expect(edit.data).toEqual([]);

    const readingInHerBook = await bobClient.from('vehicle_readings').insert({ book_id: aliceBook, reading_date: '2026-10-02', hours: 1 });
    expect(readingInHerBook.error?.code).toBe('42501');

    // Bob's own book cannot name Alice's item either: an entry would reset her interval.
    const bobVehicle = await createVehicle(bobClient, bob!.id);
    const bobBook = await bobClient.from('service_books').insert({ vehicle_id: bobVehicle }).select('id').single();
    expect(bobBook.error, bobBook.error?.message).toBeNull();
    const bobEntry = await bobClient
      .from('service_entries')
      .insert({ book_id: bobBook.data!.id, service_date: '2026-10-02' })
      .select('id')
      .single();
    expect(bobEntry.error, bobEntry.error?.message).toBeNull();
    const herItem = await bobClient
      .from('service_entry_items')
      .insert({ entry_id: bobEntry.data!.id, item_id: aliceItem, label: 'Engine oil and filter' });
    expect(herItem.error?.code).toBe('42501');

    const stored = await admin.from('service_entries').select('notes').eq('id', entryId).single();
    expect(stored.data?.notes).toBe('Oil and filter.');

    const nobody = await anonClient().from('service_entries').select('id').eq('book_id', aliceBook);
    expect(nobody.error?.code).toBe('42501');
  });

  test('writes a revision for every edit, and lets the rider write none of the history', async () => {
    const entryId = await createEntry();
    expect(await revisions(entryId)).toMatchObject([
      { revision: 1, kind: 'created', snapshot: { notes: 'Oil and filter.', items: [], parts: [] } },
    ]);

    const edit = await aliceClient
      .from('service_entries')
      .update({ notes: 'Oil, filter and crush washer.' })
      .eq('id', entryId)
      .select('revision')
      .single();
    expect(edit.error, edit.error?.message).toBeNull();
    expect(edit.data!.revision).toBe(2);

    const item = await aliceClient.from('service_entry_items').insert({ entry_id: entryId, item_id: aliceItem, label: 'Engine oil and filter' });
    expect(item.error, item.error?.message).toBeNull();

    const history = await revisions(entryId);
    expect(history.map(({ revision, kind }) => [revision, kind])).toEqual([
      [1, 'created'],
      [2, 'edited'],
      [3, 'edited'],
    ]);
    expect(history[0].snapshot).toMatchObject({ notes: 'Oil and filter.' });
    expect(history[1].snapshot).toMatchObject({ notes: 'Oil, filter and crush washer.', items: [] });
    expect(history[2].snapshot).toMatchObject({ items: [{ item_id: aliceItem, label: 'Engine oil and filter' }] });

    // The rider reads their history and cannot add to, rewrite or remove it.
    const read = await aliceClient.from('service_entry_revisions').select('revision').eq('entry_id', entryId);
    expect(read.data).toHaveLength(3);
    const forged = await aliceClient
      .from('service_entry_revisions')
      .insert(untyped({ entry_id: entryId, revision: 9, kind: 'edited', snapshot: {}, transaction_id: 1 }));
    expect(forged.error?.code).toBe('42501');
    const rewritten = await aliceClient.from('service_entry_revisions').update(untyped({ snapshot: {} })).eq('entry_id', entryId);
    expect(rewritten.error?.code).toBe('42501');
    const removed = await aliceClient.from('service_entry_revisions').delete().eq('entry_id', entryId);
    expect(removed.error?.code).toBe('42501');

    // Nor can the service role: the history is append-only for everyone but its triggers.
    const serviceRewrite = await admin.from('service_entry_revisions').update(untyped({ snapshot: {} })).eq('entry_id', entryId);
    expect(serviceRewrite.error?.code).toBe('42501');
    expect(await revisions(entryId)).toHaveLength(3);
  });

  test('keeps logged_at on the server’s clock whatever the client sends', async () => {
    const entryId = await createEntry({ service_date: '2024-05-01' });
    const logged = await admin.from('service_entries').select('logged_at, logged_by').eq('id', entryId).single();
    expect(secondsFromNow(logged.data!.logged_at)).toBeLessThan(60);
    expect(logged.data!.logged_by).toBe(alice!.id);

    const backdated = await aliceClient
      .from('service_entries')
      .insert(untyped<TableInsert<'service_entries'>>({ book_id: aliceBook, service_date: '2024-05-01', logged_at: '2024-05-01T09:00:00Z' }));
    expect(backdated.error?.code).toBe('42501');

    const moved = await aliceClient
      .from('service_entries')
      .update(untyped<TableUpdate<'service_entries'>>({ logged_at: '2024-05-01T09:00:00Z' }))
      .eq('id', entryId);
    expect(moved.error?.code).toBe('42501');

    const asSomeoneElse = await aliceClient
      .from('service_entries')
      .update(untyped<TableUpdate<'service_entries'>>({ logged_by: bob!.id }))
      .eq('id', entryId);
    expect(asSomeoneElse.error?.code).toBe('42501');

    // The service role holds every column, and still does not set the clock.
    const serviceInsert = await admin
      .from('service_entries')
      .insert(
        untyped<TableInsert<'service_entries'>>({
          book_id: aliceBook,
          service_date: '2024-05-01',
          logged_at: '2024-05-01T09:00:00Z',
          logged_by: alice!.id,
        }),
      )
      .select('id, logged_at')
      .single();
    expect(serviceInsert.error, serviceInsert.error?.message).toBeNull();
    expect(secondsFromNow(serviceInsert.data!.logged_at)).toBeLessThan(60);

    const serviceMove = await admin
      .from('service_entries')
      .update(untyped<TableUpdate<'service_entries'>>({ logged_at: '2024-05-01T09:00:00Z' }))
      .eq('id', entryId)
      .select('logged_at')
      .single();
    expect(serviceMove.error, serviceMove.error?.message).toBeNull();
    expect(serviceMove.data!.logged_at).toBe(logged.data!.logged_at);
  });

  test('writes a reading for an entry that carries one, and keeps it with the entry', async () => {
    const entryId = await createEntry({ service_date: '2026-09-20', reading_hours: 101.5 });
    expect(await readingsFor(entryId)).toEqual([
      { book_id: aliceBook, reading_date: '2026-09-20', hours: 101.5, distance: null, source: 'entry', entry_id: entryId },
    ]);

    const corrected = await aliceClient.from('service_entries').update({ reading_hours: 105, service_date: '2026-09-21' }).eq('id', entryId);
    expect(corrected.error, corrected.error?.message).toBeNull();
    expect(await readingsFor(entryId)).toMatchObject([{ reading_date: '2026-09-21', hours: 105, source: 'entry' }]);

    // A reading an entry wrote is changed through the entry, not directly.
    const direct = await aliceClient
      .from('vehicle_readings')
      .update(untyped<TableUpdate<'vehicle_readings'>>({ hours: 1 }))
      .eq('entry_id', entryId);
    expect(direct.error?.code).toBe('42501');
    const posing = await aliceClient
      .from('vehicle_readings')
      .insert(untyped<TableInsert<'vehicle_readings'>>({ book_id: aliceBook, reading_date: '2026-09-21', hours: 1, source: 'entry', entry_id: entryId }));
    expect(posing.error?.code).toBe('42501');

    // A rider's own reading is theirs to write.
    const own = await aliceClient.from('vehicle_readings').insert({ book_id: aliceBook, reading_date: '2026-09-22', hours: 107 }).select('source').single();
    expect(own.error, own.error?.message).toBeNull();
    expect(own.data!.source).toBe('rider');

    // A removed entry stops counting as the bike's usage, and comes back with it.
    expect((await aliceClient.from('service_entries').update({ deleted_at: new Date().toISOString() }).eq('id', entryId)).error).toBeNull();
    expect(await readingsFor(entryId)).toEqual([]);
    expect((await aliceClient.from('service_entries').update({ deleted_at: null }).eq('id', entryId)).error).toBeNull();
    expect(await readingsFor(entryId)).toHaveLength(1);

    const noEntryReading = await createEntry();
    expect(await readingsFor(noEntryReading)).toEqual([]);
  });

  test('keeps every rider reading, and corrects one by superseding it', async () => {
    const reading = async (fields: Partial<TableInsert<'vehicle_readings'>> = {}) =>
      aliceClient
        .from('vehicle_readings')
        .insert({ book_id: aliceBook, reading_date: '2026-09-25', hours: 120, ...fields })
        .select('id')
        .single();

    const typo = await reading({ hours: 1200 });
    expect(typo.error, typo.error?.message).toBeNull();
    const typoId = typo.data!.id;

    const rewritten = await aliceClient
      .from('vehicle_readings')
      .update(untyped<TableUpdate<'vehicle_readings'>>({ hours: 120 }))
      .eq('id', typoId);
    expect(rewritten.error?.code).toBe('42501');
    const removed = await aliceClient.from('vehicle_readings').delete().eq('id', typoId);
    expect(removed.error?.code).toBe('42501');
    const serviceRewrite = await admin
      .from('vehicle_readings')
      .update(untyped<TableUpdate<'vehicle_readings'>>({ hours: 120 }))
      .eq('id', typoId);
    expect(serviceRewrite.error?.code).toBe('42501');
    const serviceRemoved = await admin.from('vehicle_readings').delete().eq('id', typoId);
    expect(serviceRemoved.error?.code).toBe('42501');

    const correction = await reading({ supersedes_id: typoId });
    expect(correction.error, correction.error?.message).toBeNull();
    // The rider still reads the value they corrected, beside the correction.
    const both = await aliceClient
      .from('vehicle_readings')
      .select('id, hours, supersedes_id')
      .in('id', [typoId, correction.data!.id])
      .order('created_at');
    expect(both.error, both.error?.message).toBeNull();
    expect(both.data).toEqual([
      { id: typoId, hours: 1200, supersedes_id: null },
      { id: correction.data!.id, hours: 120, supersedes_id: typoId },
    ]);

    // Superseded once only, and only a rider reading of the same book.
    expect((await reading({ supersedes_id: typoId })).error?.code).toBe('23505');
    const entryId = await createEntry({ reading_hours: 130 });
    const fromEntry = await admin.from('vehicle_readings').select('id').eq('entry_id', entryId).single();
    expect(fromEntry.error, fromEntry.error?.message).toBeNull();
    expect((await reading({ supersedes_id: fromEntry.data!.id })).error?.code).toBe('42501');

    const bobVehicle = await createVehicle(bobClient, bob!.id);
    const bobBook = await bobClient.from('service_books').insert({ vehicle_id: bobVehicle }).select('id').single();
    const bobReading = await bobClient
      .from('vehicle_readings')
      .insert({ book_id: bobBook.data!.id, reading_date: '2026-09-25', hours: 5 })
      .select('id')
      .single();
    expect(bobReading.error, bobReading.error?.message).toBeNull();
    expect((await reading({ supersedes_id: bobReading.data!.id })).error?.code).toBe('42501');
  });

  test('refuses delete on entries, and records a removal as a soft delete', async () => {
    const entryId = await createEntry();

    const deleted = await aliceClient.from('service_entries').delete().eq('id', entryId);
    expect(deleted.error?.code).toBe('42501');
    const serviceDeleted = await admin.from('service_entries').delete().eq('id', entryId);
    expect(serviceDeleted.error?.code).toBe('42501');

    // A removal dated in the past is dated now: when it was removed is a fact, not a choice.
    const removed = await aliceClient
      .from('service_entries')
      .update({ deleted_at: '2020-01-01T00:00:00Z' })
      .eq('id', entryId)
      .select('deleted_at')
      .single();
    expect(removed.error, removed.error?.message).toBeNull();
    expect(secondsFromNow(removed.data!.deleted_at!)).toBeLessThan(60);

    const restored = await aliceClient.from('service_entries').update({ deleted_at: null }).eq('id', entryId);
    expect(restored.error, restored.error?.message).toBeNull();

    expect((await revisions(entryId)).map(({ kind }) => kind)).toEqual(['created', 'deleted', 'restored']);
    const stored = await admin.from('service_entries').select('id').eq('id', entryId);
    expect(stored.data).toHaveLength(1);
  });

  test('counts a usage weight only for a session on the book’s own vehicle', async () => {
    const otherVehicle = await createVehicle(aliceClient, alice!.id);
    const sessionOn = async (vehicleId: string) => {
      const sessionId = randomUUID();
      const { error } = await aliceClient.rpc('create_session_with_laps', {
        p_session_id: sessionId,
        p_session: { vehicle_id: vehicleId, track_name: 'Road America', date: '2026-09-27', conditions: 'sunny', tires: {}, suspension: {} },
        p_laps: [],
        p_environment: null,
      });
      expect(error, error?.message).toBeNull();
      return sessionId;
    };

    const own = await aliceClient.from('session_usage_weights').insert({ book_id: aliceBook, session_id: await sessionOn(aliceVehicle), weight: 0 });
    expect(own.error, own.error?.message).toBeNull();

    const otherBike = await aliceClient.from('session_usage_weights').insert({ book_id: aliceBook, session_id: await sessionOn(otherVehicle), weight: 2 });
    expect(otherBike.error?.code).toBe('42501');

    const tooHeavy = await aliceClient.from('session_usage_weights').insert({ book_id: aliceBook, session_id: await sessionOn(aliceVehicle), weight: 4 });
    expect(tooHeavy.error?.code).toBe('23514');
  });

  test('takes the whole book with the vehicle it belongs to', async () => {
    const vehicleId = await createVehicle(aliceClient, alice!.id);
    const book = await aliceClient.from('service_books').insert({ vehicle_id: vehicleId }).select('id').single();
    expect(book.error, book.error?.message).toBeNull();
    const entry = await aliceClient
      .from('service_entries')
      .insert({ book_id: book.data!.id, service_date: '2026-10-01', reading_hours: 3 })
      .select('id')
      .single();
    expect(entry.error, entry.error?.message).toBeNull();
    expect(
      (await aliceClient.from('service_entry_parts').insert({ entry_id: entry.data!.id, brand: 'Motul', quantity: 1 })).error,
    ).toBeNull();
    const reading = await aliceClient
      .from('vehicle_readings')
      .insert({ book_id: book.data!.id, reading_date: '2026-10-02', hours: 4 })
      .select('id')
      .single();
    expect(reading.error, reading.error?.message).toBeNull();
    const correction = await aliceClient
      .from('vehicle_readings')
      .insert({ book_id: book.data!.id, reading_date: '2026-10-02', hours: 5, supersedes_id: reading.data!.id });
    expect(correction.error, correction.error?.message).toBeNull();

    const gone = await aliceClient.from('vehicles').delete().eq('id', vehicleId);
    expect(gone.error, gone.error?.message).toBeNull();

    for (const [table, column, value] of [
      ['service_books', 'id', book.data!.id],
      ['service_entries', 'id', entry.data!.id],
      ['service_entry_revisions', 'entry_id', entry.data!.id],
      ['service_entry_parts', 'entry_id', entry.data!.id],
      ['vehicle_readings', 'book_id', book.data!.id],
    ] as const) {
      const { data, error } = await admin.from(table).select('id').eq(column, value);
      expect(error, `${table}: ${error?.message}`).toBeNull();
      expect(data, table).toEqual([]);
    }
  });
});
