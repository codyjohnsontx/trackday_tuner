import { expect, test } from '@playwright/test';
import { createTestAdminClient } from '@/tests/e2e/helpers/supabase';
import { createThrowawayRider, deleteThrowawayRider, type ThrowawayRider } from '@/tests/e2e/helpers/throwaway-rider';
import { anonClient, createVehicle, signIn, type Client } from '@/tests/db/helpers/rider';

/**
 * `save_service_entry` (20261013000300) writes an entry with its items and
 * parts in one transaction, as a signed-in rider, so the history the triggers
 * keep reads as the owner ruled (2026-10-08): a new entry is one `created`
 * revision, a save that changes nothing adds none, a real edit adds one, and
 * nothing a rider cannot do through PostgREST becomes possible through it -
 * another rider's book, a removed entry, an item of another book, or an entry
 * naming nothing.
 *
 * Part of `npm run test:db`, which CI runs on every pull request against a
 * local stack built from supabase/migrations - see playwright.db.config.ts.
 */

type Entry = { service_date: string; notes?: string | null; reading_hours?: number | null; performed_by?: 'self' | 'shop' | null; cost_cents?: number | null };
type Item = { item_id: string | null; label: string };
type Part = { brand: string | null; part_number: string | null; quantity: number | null; unit_cost_cents: number | null };

test.describe('save_service_entry as a rider, as another rider and as nobody', () => {
  let admin: Client;
  let alice: ThrowawayRider | null = null;
  let bob: ThrowawayRider | null = null;
  let aliceClient: Client;
  let bobClient: Client;
  let aliceBook: string;
  let aliceItem: string;
  let bobBook: string;
  let bobItem: string;

  async function save(client: Client, book: string, entryId: string | null, entry: Entry, items: Item[], parts: Part[] | null = []) {
    return client.rpc('save_service_entry', { p_book_id: book, p_entry_id: entryId, p_entry: entry, p_items: items, p_parts: parts });
  }

  async function revisions(entryId: string) {
    const { data, error } = await admin.from('service_entry_revisions').select('revision, kind, snapshot').eq('entry_id', entryId).order('revision');
    expect(error, error?.message).toBeNull();
    return data!;
  }

  async function book(client: Client, rider: ThrowawayRider, itemName: string): Promise<[string, string]> {
    const vehicle = await createVehicle(client, rider.id);
    const created = await client.from('service_books').insert({ vehicle_id: vehicle }).select('id').single();
    expect(created.error, created.error?.message).toBeNull();
    const item = await client.from('service_items').insert({ book_id: created.data!.id, name: itemName, source: 'starter' }).select('id').single();
    expect(item.error, item.error?.message).toBeNull();
    return [created.data!.id, item.data!.id];
  }

  test.beforeAll(async () => {
    admin = createTestAdminClient();
    alice = await createThrowawayRider('save-entry-alice');
    bob = await createThrowawayRider('save-entry-bob');
    aliceClient = await signIn(alice);
    bobClient = await signIn(bob);
    [aliceBook, aliceItem] = await book(aliceClient, alice, 'Engine oil and filter');
    [bobBook, bobItem] = await book(bobClient, bob, 'Brake pads');
  });

  test.afterAll(async () => {
    await deleteThrowawayRider(alice);
    await deleteThrowawayRider(bob);
  });

  test('a new entry with items and parts is exactly one revision, and an unchanged re-save adds none', async () => {
    const entry: Entry = { service_date: '2026-10-01', notes: 'Oil and filter.', reading_hours: 41.5, performed_by: 'self', cost_cents: 6850 };
    const items: Item[] = [{ item_id: aliceItem, label: '' }, { item_id: null, label: ' Throttle cable ' }];
    const parts: Part[] = [{ brand: 'Motul', part_number: '300V', quantity: 3.4, unit_cost_cents: 1800 }];

    const created = await save(aliceClient, aliceBook, null, entry, items, parts);
    expect(created.error, created.error?.message).toBeNull();
    const entryId = created.data as string;

    const stored = await admin.from('service_entries').select('revision, logged_by, reading_hours').eq('id', entryId).single();
    expect(stored.data).toMatchObject({ revision: 1, logged_by: alice!.id, reading_hours: 41.5 });
    const history = await revisions(entryId);
    expect(history.map(({ revision, kind }) => [revision, kind])).toEqual([[1, 'created']]);
    const snapshot = history[0].snapshot as { notes: string; items: { item_id: string | null; label: string }[]; parts: unknown[] };
    expect(snapshot.notes).toBe('Oil and filter.');
    // The label is the item's own name, and the typed item is trimmed. Items
    // written in one statement share a created_at, so their order is not a fact.
    expect(snapshot.items.map(({ item_id, label }) => ({ item_id, label })).sort((a, b) => a.label.localeCompare(b.label))).toEqual([
      { item_id: aliceItem, label: 'Engine oil and filter' },
      { item_id: null, label: 'Throttle cable' },
    ]);
    expect(snapshot.parts).toMatchObject([{ brand: 'Motul', part_number: '300V', quantity: 3.4, unit_cost_cents: 1800 }]);
    const reading = await admin.from('vehicle_readings').select('hours, source').eq('entry_id', entryId);
    expect(reading.data).toEqual([{ hours: 41.5, source: 'entry' }]);

    const again = await save(aliceClient, aliceBook, entryId, entry, items, parts);
    expect(again.error, again.error?.message).toBeNull();
    expect(again.data).toBe(entryId);
    expect((await admin.from('service_entries').select('revision').eq('id', entryId).single()).data!.revision).toBe(1);
    expect(await revisions(entryId)).toHaveLength(1);

    // A real edit - a note and a part swapped - is one more revision, whatever it touched.
    const edited = await save(aliceClient, aliceBook, entryId, { ...entry, notes: 'Oil, filter and crush washer.' }, items, [
      { brand: 'K&N', part_number: 'KN-303', quantity: 1, unit_cost_cents: 730 },
    ]);
    expect(edited.error, edited.error?.message).toBeNull();
    const afterEdit = await revisions(entryId);
    expect(afterEdit.map(({ revision, kind }) => [revision, kind])).toEqual([
      [1, 'created'],
      [2, 'edited'],
    ]);
    expect(afterEdit[1].snapshot).toMatchObject({
      notes: 'Oil, filter and crush washer.',
      parts: [{ brand: 'K&N', part_number: 'KN-303', quantity: 1, unit_cost_cents: 730 }],
    });
    const partRows = await admin.from('service_entry_parts').select('brand').eq('entry_id', entryId);
    expect(partRows.data).toEqual([{ brand: 'K&N' }]);
  });

  test('refuses what a rider cannot do through PostgREST either', async () => {
    const entry: Entry = { service_date: '2026-10-02' };

    const nobody = await save(anonClient(), aliceBook, null, entry, [{ item_id: aliceItem, label: '' }]);
    expect(nobody.error?.code).toBe('42501');

    const herBook = await save(bobClient, aliceBook, null, entry, [{ item_id: aliceItem, label: '' }]);
    expect(herBook.error?.code).toBe('TT404');

    const herItem = await save(bobClient, bobBook, null, entry, [{ item_id: aliceItem, label: '' }]);
    expect(herItem.error?.code).toBe('TT404');
    expect((await admin.from('service_entries').select('id').eq('book_id', bobBook)).data).toEqual([]);

    const nothingDone = await save(aliceClient, aliceBook, null, entry, []);
    expect(nothingDone.error?.code).toBe('22023');

    const ownEntry = await save(bobClient, bobBook, null, entry, [{ item_id: bobItem, label: '' }], null);
    expect(ownEntry.error, ownEntry.error?.message).toBeNull();
    const bobEntry = ownEntry.data as string;

    const notHers = await save(aliceClient, aliceBook, bobEntry, entry, [{ item_id: aliceItem, label: '' }]);
    expect(notHers.error?.code).toBe('TT404');

    const removed = await bobClient.from('service_entries').update({ deleted_at: new Date().toISOString() }).eq('id', bobEntry);
    expect(removed.error, removed.error?.message).toBeNull();
    const afterRemoval = await save(bobClient, bobBook, bobEntry, { ...entry, notes: 'late' }, [{ item_id: bobItem, label: '' }]);
    expect(afterRemoval.error?.code).toBe('TT404');
    expect((await revisions(bobEntry)).map(({ kind }) => kind)).toEqual(['created', 'deleted']);
  });
});
