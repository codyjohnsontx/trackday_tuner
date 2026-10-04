import { test, expect } from '@playwright/test';
import { createTestAdminClient } from '@/tests/e2e/helpers/supabase';
import {
  createThrowawayRider,
  deleteThrowawayRider,
  type ThrowawayRider,
} from '@/tests/e2e/helpers/throwaway-rider';
import { trackNameKey } from '@/lib/session-track';
import { anonClient, signIn, type Client } from '@/tests/db/helpers/rider';
import type { Suspension, Tires } from '@/types/supabase';

/**
 * `relink_legacy_session_tracks` (20261004002600) against a real database: a
 * session that names a circuit and points at no track is linked to the one track
 * that name resolves to by lib/track-lookup.ts's rules, and anything ambiguous or
 * unmatched is reported and left alone.
 *
 * The legacy rows are written straight to `sessions` with the service role,
 * which is how they came to exist - none of them went through the resolver that
 * would have linked them. Every call is scoped to this spec's own riders, since
 * the function would otherwise relink sessions other specs are asserting on.
 */

const admin = createTestAdminClient();

type Relink = {
  session_id: string;
  user_id: string;
  track_name: string;
  outcome: string;
  track_id: string | null;
  candidate_track_ids: string[];
};

let rider: ThrowawayRider | null = null;
let otherRider: ThrowawayRider | null = null;
let vehicle = '';

async function seededTrackId(name: string): Promise<string> {
  const { data, error } = await admin.from('tracks').select('id').eq('is_seeded', true).eq('name', name).single();
  expect(error, error?.message).toBeNull();
  return data!.id;
}

async function customTrack(userId: string, name: string): Promise<string> {
  const { data, error } = await admin
    .from('tracks')
    .insert({ name, is_seeded: false, created_by: userId })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  return data!.id;
}

/** A session as an older client stored it: a name, and whatever `track_id` it was given. */
async function legacySession(trackName: string | null, trackId: string | null = null): Promise<string> {
  const { data, error } = await admin
    .from('sessions')
    .insert({
      user_id: rider!.id,
      vehicle_id: vehicle,
      track_id: trackId,
      track_name: trackName,
      date: '2026-05-02',
      conditions: 'sunny',
      // An empty setup: both columns are `jsonb`, and the relink reads neither.
      tires: {} as Tires,
      suspension: {} as Suspension,
    })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  return data!.id;
}

async function trackIdOf(sessionId: string): Promise<string | null> {
  const { data, error } = await admin.from('sessions').select('track_id').eq('id', sessionId).single();
  expect(error, error?.message).toBeNull();
  return data!.track_id;
}

async function relink(userId: string): Promise<Relink[]> {
  const { data, error } = await admin.rpc('relink_legacy_session_tracks', { p_user_id: userId });
  expect(error, error?.message).toBeNull();
  return (data ?? []) as Relink[];
}

test.beforeEach(async () => {
  rider = await createThrowawayRider('relink-tracks');
  otherRider = await createThrowawayRider('relink-tracks-other');
  const { data, error } = await admin
    .from('vehicles')
    .insert({ user_id: rider.id, nickname: 'Test bike', make: 'Yamaha', model: 'R6', year: 2020, type: 'motorcycle' })
    .select('id')
    .single();
  expect(error, error?.message).toBeNull();
  vehicle = data!.id;
});

test.afterEach(async () => {
  await deleteThrowawayRider(rider);
  await deleteThrowawayRider(otherRider);
  rider = null;
  otherRider = null;
});

test('links a name to the seeded circuit it folds to, and an alias to its circuit', async () => {
  const roadAmerica = await seededTrackId('Road America');
  const cota = await seededTrackId('Circuit of the Americas');
  // Case, spacing - a tab and a no-break space among them - and a byte-order mark
  // are all folded by `trackNameKey`, so the SQL has to fold them too.
  const typed = '  road\tAMERICA\u00a0\ufeff';
  expect(trackNameKey(typed)).toBe(trackNameKey('Road America'));
  const byName = await legacySession(typed);
  const byAlias = await legacySession('cota');

  const rows = await relink(rider!.id);

  expect(await trackIdOf(byName)).toBe(roadAmerica);
  expect(await trackIdOf(byAlias)).toBe(cota);
  expect(rows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ session_id: byName, outcome: 'relinked', track_id: roadAmerica }),
      expect.objectContaining({ session_id: byAlias, outcome: 'relinked', track_id: cota }),
    ]),
  );
  expect(rows).toHaveLength(2);
});

test('keeps the typed name as it was stored', async () => {
  const session = await legacySession('cota');
  await relink(rider!.id);
  const { data } = await admin.from('sessions').select('track_name').eq('id', session).single();
  expect(data!.track_name).toBe('cota');
});

test("prefers the rider's own track over a seeded one, and a name over an alias, as a save does", async () => {
  const ownRoadAtlanta = await customTrack(rider!.id, 'Road Atlanta');
  const ownElkhart = await customTrack(rider!.id, 'Elkhart Lake');
  const sameName = await legacySession('Road Atlanta');
  // "Elkhart Lake" is a seeded alias of Road America; the rider's own track by
  // that name is consulted first.
  const aliasName = await legacySession('elkhart lake');

  await relink(rider!.id);

  expect(await trackIdOf(sameName)).toBe(ownRoadAtlanta);
  expect(await trackIdOf(aliasName)).toBe(ownElkhart);
});

test('leaves a name with two equally good tracks alone and reports both', async () => {
  const first = await customTrack(rider!.id, 'Backyard Test Loop');
  const second = await customTrack(rider!.id, 'backyard  test loop');
  const session = await legacySession('Backyard Test Loop');

  const rows = await relink(rider!.id);

  expect(await trackIdOf(session)).toBeNull();
  expect(rows).toEqual([
    {
      session_id: session,
      user_id: rider!.id,
      track_name: 'Backyard Test Loop',
      outcome: 'ambiguous',
      track_id: null,
      candidate_track_ids: [first, second].sort(),
    },
  ]);
});

test('leaves a name matching nothing alone, creates no track, and never reaches another rider', async () => {
  // Another rider's custom track is private to them, so it is no match for this one.
  await customTrack(otherRider!.id, 'Hidden Ranch Circuit');
  const nowhere = await legacySession('Nowhere Raceway');
  const private_ = await legacySession('Hidden Ranch Circuit');
  const { count: before } = await admin.from('tracks').select('id', { count: 'exact', head: true });

  const rows = await relink(rider!.id);

  expect(await trackIdOf(nowhere)).toBeNull();
  expect(await trackIdOf(private_)).toBeNull();
  expect(rows.map((row) => [row.session_id, row.outcome]).sort()).toEqual(
    [
      [nowhere, 'unmatched'],
      [private_, 'unmatched'],
    ].sort(),
  );
  const { count: after } = await admin.from('tracks').select('id', { count: 'exact', head: true });
  expect(after).toBe(before);
});

test('never touches a session that already has a track, or one that names none', async () => {
  const own = await customTrack(rider!.id, 'Practice Pad');
  // Its name resolves to a seeded circuit, but the id it holds is what it means.
  const linked = await legacySession('Road America', own);
  const blank = await legacySession('   ');
  const unnamed = await legacySession(null);

  const rows = await relink(rider!.id);

  expect(rows).toEqual([]);
  expect(await trackIdOf(linked)).toBe(own);
  expect(await trackIdOf(blank)).toBeNull();
  expect(await trackIdOf(unnamed)).toBeNull();
});

test('is safe to run again: a second run relinks nothing and reports what is still unresolved', async () => {
  const roadAmerica = await seededTrackId('Road America');
  const matched = await legacySession('Road America');
  const unmatched = await legacySession('Nowhere Raceway');

  const first = await relink(rider!.id);
  const second = await relink(rider!.id);

  expect(first.map((row) => row.outcome).sort()).toEqual(['relinked', 'unmatched']);
  expect(second).toEqual([expect.objectContaining({ session_id: unmatched, outcome: 'unmatched' })]);
  expect(await trackIdOf(matched)).toBe(roadAmerica);
});

test('a track added later is picked up by the next run', async () => {
  const session = await legacySession('Nowhere Raceway');
  expect((await relink(rider!.id))[0].outcome).toBe('unmatched');

  const track = await customTrack(rider!.id, 'Nowhere Raceway');
  expect((await relink(rider!.id))[0]).toMatchObject({ session_id: session, outcome: 'relinked', track_id: track });
});

test('no Data API role can run it', async () => {
  const signedIn: Client = await signIn(rider!);
  for (const client of [anonClient(), signedIn]) {
    const { error } = await client.rpc('relink_legacy_session_tracks', { p_user_id: rider!.id });
    expect(error?.code).toBe('42501');
  }
});
