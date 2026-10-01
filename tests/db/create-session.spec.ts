import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { resolveUserAccess } from '@/lib/access';
import { getFreePlanLimit, getFreePlanLimitMessage } from '@/lib/plans';
import { MISSING_TRACK_MESSAGE } from '@/lib/session-track';
import {
  SESSION_VEHICLE_NOT_OWNED_MESSAGE,
  createSessionForUser,
  type CreateSessionContext,
  type CreateSessionOptions,
} from '@/lib/sessions/create';
import { createTestAdminClient } from '@/tests/e2e/helpers/supabase';
import {
  createThrowawayRider,
  deleteThrowawayRider,
  type ThrowawayRider,
} from '@/tests/e2e/helpers/throwaway-rider';
import { anonClient, createVehicle, signIn, type Client } from '@/tests/db/helpers/rider';
import type { CreateSessionInput, Profile } from '@/types';

/**
 * Saving a session, as both clients save one, against a real database.
 *
 * The website form's server action and the phone's bearer route both call
 * `createSessionForUser` with an id - the action mints one per save, the phone
 * sends its own - and it resolves the circuit, then writes the row, its laps and
 * its environment in one call to `create_session_with_laps`, which counts the
 * free-plan session cap under the rider's lock. This spec calls it the way they
 * do: as a signed-in rider, through their own client, with the entitlement read
 * as `resolveUserAccess` reads it. Everything it asserts is read back through
 * the service role.
 *
 * It replaces the queued fakes `lib/actions/sessions.test.ts` used to prove
 * this with, which had to script every query in order and so broke on changes
 * inside track resolution that altered nothing a rider could see. The faults a
 * real database cannot be made to produce on cue stay there.
 *
 * Part of `npm run test:db`, which CI runs on every pull request against a local
 * stack built from supabase/migrations - see playwright.db.config.ts.
 */

const SESSION_CAP = getFreePlanLimit('sessions');
const TRACK_CAP = getFreePlanLimit('tracks');

/**
 * A circuit no migration seeds, so a save naming it creates the rider's own
 * track row - which is what the refusals below have to take back. The seeded
 * list is long enough that a real circuit's name is not safe here (Harris Hill
 * Raceway once was, and made every "keeps no track" check pass vacuously), so
 * `beforeAll` checks this one is not on it.
 */
const NEW_CIRCUIT = 'Backyard Test Loop';

const LAPS = [
  { lap_number: 1, lap_time_ms: 142_300, included: true },
  { lap_number: 2, lap_time_ms: 139_800, included: true },
];

interface Rider {
  rider: ThrowawayRider;
  client: Client;
  vehicle: string;
  context: CreateSessionContext;
  reports: unknown[][];
}

/**
 * `client`, except that a call to `create_session_with_laps` waits at the door
 * until `release()` - so a test can hold one save between resolving its track
 * and writing, and run another in that gap. `reached` settles when it arrives.
 */
function pausedBeforeCreate(client: Client) {
  let arrive = () => {};
  let release = () => {};
  const reached = new Promise<void>((resolve) => (arrive = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const paused = new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'rpc') {
        return async (...args: Parameters<Client['rpc']>) => {
          if (args[0] === 'create_session_with_laps') {
            arrive();
            await released;
          }
          return target.rpc(...args);
        };
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return { client: paused, reached, release: () => release() };
}

/** A session as the form posts it, at a seeded circuit by name unless the test says otherwise. */
function formInput(vehicleId: string, overrides: Partial<CreateSessionInput> = {}): CreateSessionInput {
  return {
    vehicle_id: vehicleId,
    track_id: null,
    track_name: 'Road America',
    date: '2026-09-27',
    start_time: '09:40:00',
    session_number: 1,
    conditions: 'sunny',
    tires: {
      front: { brand: 'Pirelli', compound: 'SC1', pressure: '31' },
      rear: { brand: 'Pirelli', compound: 'SC0', pressure: '24' },
      condition: 'used',
    },
    suspension: {
      front: { preload: '4', compression: '10', rebound: '8', direction: 'out' },
      rear: { preload: '6', compression: '12', rebound: '10', direction: 'out' },
    },
    alignment: null,
    enabled_modules: {
      tires: true,
      suspension: true,
      alignment: false,
      geometry: false,
      drivetrain: false,
      aero: false,
      notes: true,
    },
    notes: 'Front pushing in turn 5.',
    laps: [],
    environment: null,
    ...overrides,
  };
}

test.describe('createSessionForUser against a real database', () => {
  let admin: Client;
  const riders: ThrowawayRider[] = [];

  async function newRider(label: string): Promise<Rider> {
    const rider = await createThrowawayRider(label);
    riders.push(rider);
    const client = await signIn(rider);
    const reports: unknown[][] = [];
    return {
      rider,
      client,
      vehicle: await createVehicle(client, rider.id),
      reports,
      context: {
        supabase: client,
        userId: rider.id,
        resolveProAccess: async () => {
          const { data, error } = await client.from('profiles').select('*').eq('id', rider.id).maybeSingle();
          expect(error, error?.message).toBeNull();
          return resolveUserAccess(data as Profile | null).hasProAccess;
        },
        report: (...args) => {
          reports.push(args);
        },
      },
    };
  }

  /** A save as the form makes it by default: a fresh id, so nothing to replay. */
  function save(
    rider: Rider,
    overrides: Partial<CreateSessionInput> = {},
    options: CreateSessionOptions = { id: randomUUID(), replayable: false },
  ) {
    return createSessionForUser(rider.context, formInput(rider.vehicle, overrides), options);
  }

  async function seededTrack(name: string): Promise<{ id: string; name: string }> {
    const { data, error } = await admin.from('tracks').select('id, name').eq('name', name).eq('is_seeded', true).single();
    expect(error, `${name}: ${error?.message}`).toBeNull();
    return data!;
  }

  async function layoutOf(trackId: string, name: string): Promise<string> {
    const { data, error } = await admin.from('track_layouts').select('id').eq('track_id', trackId).eq('name', name).single();
    expect(error, `${name}: ${error?.message}`).toBeNull();
    return data!.id;
  }

  async function ownTrack(rider: Rider, name: string): Promise<string> {
    const { data, error } = await rider.client
      .from('tracks')
      .insert({ name, location: null, is_seeded: false, created_by: rider.rider.id })
      .select('id')
      .single();
    expect(error, error?.message).toBeNull();
    return data!.id;
  }

  async function ownTracks(rider: Rider) {
    const { data, error } = await admin.from('tracks').select('id, name').eq('created_by', rider.rider.id);
    expect(error, error?.message).toBeNull();
    return data!;
  }

  async function sessionsOf(rider: Rider) {
    const { data, error } = await admin
      .from('sessions')
      .select('id, track_id, track_name, layout_id, layout_name')
      .eq('user_id', rider.rider.id);
    expect(error, error?.message).toBeNull();
    return data!;
  }

  /** Sessions stored straight through the service role, to put a rider at a count without saving each one. */
  async function fillSessions(rider: Rider, count: number) {
    const { conditions, tires, suspension, enabled_modules } = formInput(rider.vehicle);
    const rows = Array.from({ length: count }, (_, index) => ({
      user_id: rider.rider.id,
      vehicle_id: rider.vehicle,
      track_name: 'Road America',
      date: `2026-08-${String(index + 1).padStart(2, '0')}`,
      conditions,
      tires,
      suspension,
      enabled_modules: enabled_modules!,
    }));
    const { error } = await admin.from('sessions').insert(rows);
    expect(error, error?.message).toBeNull();
  }

  test.beforeAll(async () => {
    admin = createTestAdminClient();
    const seeded = await admin.from('tracks').select('id').ilike('name', NEW_CIRCUIT);
    expect(seeded.error, seeded.error?.message).toBeNull();
    expect(seeded.data, `${NEW_CIRCUIT} must not be a seeded circuit`).toEqual([]);
  });

  test.afterAll(async () => {
    for (const rider of riders) await deleteThrowawayRider(rider);
  });

  test.describe('one atomic write', () => {
    test('stores the session, its laps and its environment under the id it was given', async () => {
      const rider = await newRider('save-atomic');
      const id = randomUUID();

      const result = await save(
        rider,
        { laps: LAPS, environment: { ambient_temperature_c: 21, humidity_percent: 40, weather_condition: 'dry' } },
        { id, replayable: false },
      );

      expect(result.ok, !result.ok ? result.error : '').toBe(true);
      expect(result.ok && result.data).toMatchObject({ session: { id }, replayed: false, createdTrack: false });
      const [laps, environment] = await Promise.all([
        admin.from('session_laps').select('lap_number, lap_time_ms, included').eq('session_id', id).order('lap_number'),
        admin.from('session_environment').select('humidity_percent, source').eq('session_id', id),
      ]);
      expect(laps.data).toEqual(LAPS);
      expect(environment.data).toEqual([{ humidity_percent: 40, source: 'manual' }]);
      expect(rider.reports).toEqual([]);
    });

    test('stores nothing, and keeps no track it made, when a write after the row is refused', async () => {
      const rider = await newRider('save-environment-refused');

      // Humidity 150 breaks session_environment's CHECK, the last write the function makes.
      const result = await save(rider, {
        track_name: NEW_CIRCUIT,
        laps: LAPS,
        environment: { humidity_percent: 150 },
      });

      expect(result.ok).toBe(false);
      expect(!result.ok && result.kind).toBe('fault');
      expect(await sessionsOf(rider)).toEqual([]);
      expect(await ownTracks(rider)).toEqual([]);
      expect(rider.reports).toHaveLength(1);
    });

    test('answers a second save on the same id with the stored row and writes nothing', async () => {
      const rider = await newRider('save-replay');
      const id = randomUUID();
      expect((await save(rider, { laps: LAPS }, { id, replayable: true })).ok).toBe(true);

      const replay = await save(rider, { notes: 'a different note', laps: [] }, { id, replayable: true });

      expect(replay.ok && replay.data).toMatchObject({ replayed: true, session: { id, notes: 'Front pushing in turn 5.' } });
      expect(await sessionsOf(rider)).toHaveLength(1);
      const laps = await admin.from('session_laps').select('lap_number').eq('session_id', id);
      expect(laps.data).toHaveLength(LAPS.length);
    });

    test('saves a form session without reading for an earlier save, so it needs no deleted_sessions', async () => {
      const rider = await newRider('save-no-pre-read');
      // The rider's client as it stands on a project without the deleted-session
      // records: a read of that table answers as a table the Data API cannot find.
      const withoutTombstones = new Proxy(rider.client, {
        get(target, prop) {
          if (prop === 'from') {
            return (table: string) =>
              target.from((table === 'deleted_sessions' ? 'deleted_sessions_not_applied' : table) as 'sessions');
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const context = { ...rider.context, supabase: withoutTombstones };
      const id = randomUUID();

      const result = await createSessionForUser(context, formInput(rider.vehicle, { laps: LAPS }), {
        id,
        replayable: false,
      });

      expect(result.ok, !result.ok ? result.error : '').toBe(true);
      expect(result.ok && result.data).toMatchObject({ session: { id }, replayed: false });
      expect(await sessionsOf(rider)).toEqual([expect.objectContaining({ id })]);
      expect(rider.reports).toEqual([]);
    });
  });

  test.describe('the vehicle', () => {
    test('refuses another rider’s vehicle with the garage sentence, keeping no track it made', async () => {
      const owner = await newRider('save-vehicle-owner');
      const other = await newRider('save-vehicle-other');

      const result = await save(other, { vehicle_id: owner.vehicle, track_name: NEW_CIRCUIT });

      expect(result).toEqual({ ok: false, error: SESSION_VEHICLE_NOT_OWNED_MESSAGE, kind: 'invalid' });
      expect(await sessionsOf(other)).toEqual([]);
      expect(await ownTracks(other)).toEqual([]);
      expect(other.reports).toEqual([]);
    });

    // The form only offers the rider's own vehicles, but a server action takes
    // whatever a browser posts, and the database casts the id to a uuid.
    test('refuses a vehicle id that is not a uuid with the same sentence, as the rider’s mistake rather than ours', async () => {
      const rider = await newRider('save-vehicle-malformed');

      const result = await save(rider, { vehicle_id: 'not-a-vehicle', track_name: NEW_CIRCUIT });

      expect(result).toEqual({ ok: false, error: SESSION_VEHICLE_NOT_OWNED_MESSAGE, kind: 'invalid' });
      expect(await sessionsOf(rider)).toEqual([]);
      expect(await ownTracks(rider)).toEqual([]);
      expect(rider.reports).toEqual([]);
    });

    test('refuses a vehicle deleted since the form loaded with the same sentence', async () => {
      const rider = await newRider('save-vehicle-deleted');
      const gone = await rider.client.from('vehicles').delete().eq('id', rider.vehicle).select('id');
      expect(gone.data).toHaveLength(1);

      const result = await save(rider);

      expect(result).toEqual({ ok: false, error: SESSION_VEHICLE_NOT_OWNED_MESSAGE, kind: 'invalid' });
      expect(await sessionsOf(rider)).toEqual([]);
    });
  });

  test.describe('the free-plan session cap', () => {
    test('refuses a free rider’s session past the cap with the plan sentence, keeping no track it made', async () => {
      const rider = await newRider('save-cap');
      await fillSessions(rider, SESSION_CAP);

      const result = await save(rider, { track_name: NEW_CIRCUIT });

      expect(result).toEqual({ ok: false, error: getFreePlanLimitMessage('sessions'), kind: 'plan_limit' });
      expect(await sessionsOf(rider)).toHaveLength(SESSION_CAP);
      expect(await ownTracks(rider)).toEqual([]);
    });

    // The defect this write exists to close: the form counted in TypeScript and
    // then inserted, so a form save and a phone save at nine both passed the
    // count and a free rider stored eleven sessions (reproduced on this suite's
    // stack in 2 of 4 runs before the fix). Both now count inside the function
    // under the rider's lock. Three riders, because a race that loses half the
    // time must not be proven by one roll.
    test('holds a free rider at the cap when two saves arrive together at one short of it', async () => {
      for (const round of [1, 2, 3]) {
        const rider = await newRider(`save-cap-race-${round}`);
        await fillSessions(rider, SESSION_CAP - 1);

        const results = await Promise.all([save(rider), save(rider)]);

        expect(results.map((result) => (result.ok ? 'stored' : result.kind)).sort(), `round ${round}`).toEqual([
          'plan_limit',
          'stored',
        ]);
        expect(await sessionsOf(rider), `round ${round}`).toHaveLength(SESSION_CAP);
      }
    });

    // The race one level out, across the track insert that happens before the
    // lock. Save A creates the rider's track for a new circuit and pauses just
    // before its write; save B finds that track, takes the last slot and stores
    // its session against it; A is then refused at the cap. A's refusal takes
    // back the track it made - which, when that was an application-side delete,
    // took it out from under B's stored session (`on delete set null`) and left
    // B with a name and no track. Scheduled rather than raced, so it fails every
    // time the cleanup is wrong.
    test('keeps the winning session linked to a track the refused save created', async () => {
      const rider = await newRider('save-cap-track-race');
      await fillSessions(rider, SESSION_CAP - 1);
      const paused = pausedBeforeCreate(rider.context.supabase);
      const pausedRider = { ...rider, context: { ...rider.context, supabase: paused.client } };

      const first = save(pausedRider, { track_name: NEW_CIRCUIT });
      await paused.reached;
      const [track] = await ownTracks(rider);
      expect(track, 'save A created the rider’s track before its write').toMatchObject({ name: NEW_CIRCUIT });

      const second = await save(rider, { track_name: NEW_CIRCUIT });
      expect(second.ok && second.data).toMatchObject({ createdTrack: false, session: { track_id: track.id } });
      paused.release();
      const refused = await first;

      expect(refused).toEqual({ ok: false, error: getFreePlanLimitMessage('sessions'), kind: 'plan_limit' });
      expect(await ownTracks(rider)).toEqual([track]);
      const stored = await sessionsOf(rider);
      expect(stored).toHaveLength(SESSION_CAP);
      expect(stored.find((session) => session.id === (second.ok ? second.data.session?.id : null))).toMatchObject({
        track_id: track.id,
        track_name: NEW_CIRCUIT,
      });
    });

    test('does not cap a Pro rider', async () => {
      const rider = await newRider('save-cap-pro');
      await fillSessions(rider, SESSION_CAP);
      const upgraded = await admin.from('profiles').update({ tier: 'pro' }).eq('id', rider.rider.id).select('id');
      expect(upgraded.data).toHaveLength(1);

      const result = await save(rider);

      expect(result.ok, !result.ok ? result.error : '').toBe(true);
      expect(await sessionsOf(rider)).toHaveLength(SESSION_CAP + 1);
    });
  });

  test.describe('which circuit a session is stored against', () => {
    test('stores a track id sent without a name under the circuit’s own name', async () => {
      const rider = await newRider('track-id-only');
      const roadAmerica = await seededTrack('Road America');

      const result = await save(rider, { track_id: roadAmerica.id, track_name: null });

      expect(result.ok && result.data).toMatchObject({
        createdTrack: false,
        session: { track_id: roadAmerica.id, track_name: 'Road America' },
      });
    });

    test('stores the track row’s own name over a different name typed beside its id', async () => {
      const rider = await newRider('track-id-name-mismatch');
      const roadAmerica = await seededTrack('Road America');

      const result = await save(rider, { track_id: roadAmerica.id, track_name: 'Road Atlanta' });

      expect(result.ok && result.data.session).toMatchObject({ track_id: roadAmerica.id, track_name: 'Road America' });
    });

    test('lands a typed name on its circuit whatever its case, spacing or accent composition', async () => {
      const rider = await newRider('track-name-fold');
      const roadAmerica = await seededTrack('Road America');
      const rodriguez = await seededTrack('Autódromo Hermanos Rodríguez');

      const spaced = await save(rider, { track_name: '  road   AMERICA ' });
      const decomposed = await save(rider, { track_name: rodriguez.name.normalize('NFD') });

      expect(spaced.ok && spaced.data.session).toMatchObject({ track_id: roadAmerica.id, track_name: 'Road America' });
      expect(decomposed.ok && decomposed.data.session).toMatchObject({ track_id: rodriguez.id, track_name: rodriguez.name });
      expect(await ownTracks(rider)).toEqual([]);
    });

    test('lands a name the circuit is also known by on that circuit', async () => {
      const rider = await newRider('track-alias');
      const roadAmerica = await seededTrack('Road America');

      const result = await save(rider, { track_name: 'Elkhart Lake' });

      expect(result.ok && result.data).toMatchObject({
        createdTrack: false,
        session: { track_id: roadAmerica.id, track_name: 'Road America' },
      });
      expect(await ownTracks(rider)).toEqual([]);
    });

    // Today's rule, which docs/adr/0001-what-a-track-is.md supersedes and the
    // code does not yet follow: the rider's own row wins over a seeded circuit.
    test('prefers the rider’s own track over a seeded circuit of the same name or alias', async () => {
      const rider = await newRider('track-own-first');
      const ownRoadAmerica = await ownTrack(rider, 'Road America');
      const ownElkhart = await ownTrack(rider, 'Elkhart Lake');

      const byName = await save(rider, { track_name: 'road america' });
      const byAlias = await save(rider, { track_name: 'Elkhart Lake' });

      expect(byName.ok && byName.data.session?.track_id).toBe(ownRoadAmerica);
      expect(byAlias.ok && byAlias.data.session?.track_id).toBe(ownElkhart);
    });

    test('saves a circuit the rider has never logged as a track of their own', async () => {
      const rider = await newRider('track-new');

      const result = await save(rider, { track_name: NEW_CIRCUIT });

      const tracks = await ownTracks(rider);
      expect(tracks).toEqual([{ id: expect.any(String), name: NEW_CIRCUIT }]);
      expect(result.ok && result.data).toMatchObject({
        createdTrack: true,
        session: { track_id: tracks[0].id, track_name: NEW_CIRCUIT },
      });
    });

    test('saves the name alone once a free rider holds every custom track the plan allows', async () => {
      const rider = await newRider('track-cap');
      for (let index = 0; index < TRACK_CAP; index += 1) await ownTrack(rider, `Club circuit ${index}`);

      const result = await save(rider, { track_name: NEW_CIRCUIT });

      expect(result.ok && result.data).toMatchObject({
        createdTrack: false,
        session: { track_id: null, track_name: NEW_CIRCUIT },
      });
      expect(await ownTracks(rider)).toHaveLength(TRACK_CAP);
    });

    test('resolves the typed name instead when the track id is one the rider cannot see', async () => {
      const owner = await newRider('track-hidden-owner');
      const other = await newRider('track-hidden-other');
      const hidden = await ownTrack(owner, 'Private Test Loop');
      const roadAmerica = await seededTrack('Road America');

      const result = await save(other, { track_id: hidden, track_name: 'Road America' });

      expect(result.ok && result.data.session).toMatchObject({ track_id: roadAmerica.id, track_name: 'Road America' });
    });

    test('refuses a track id that resolves to nothing with no name beside it, storing nothing', async () => {
      const rider = await newRider('track-unresolvable');

      const result = await save(rider, { track_id: randomUUID(), track_name: null });

      expect(result).toEqual({ ok: false, error: MISSING_TRACK_MESSAGE, kind: 'invalid' });
      expect(await sessionsOf(rider)).toEqual([]);
    });
  });

  test.describe('taking back a track a refused save created', () => {
    /** A session of `rider`'s on `trackId`, written directly - the path a crafted request takes. */
    async function sessionOn(rider: Rider, trackId: string) {
      const { conditions, tires, suspension, enabled_modules } = formInput(rider.vehicle);
      const { data, error } = await rider.client
        .from('sessions')
        .insert({
          user_id: rider.rider.id,
          vehicle_id: rider.vehicle,
          track_id: trackId,
          track_name: NEW_CIRCUIT,
          date: '2026-09-27',
          conditions,
          tires,
          suspension,
          enabled_modules: enabled_modules!,
        })
        .select('id')
        .single();
      expect(error, error?.message).toBeNull();
      return data!.id;
    }

    // A rider's custom track is not visible to anyone else, but the foreign key
    // does not know that, so another rider's session can point at it. The
    // reference check has to see that session even though the rider asking
    // cannot, or the delete would clear the other rider's track_id.
    test('leaves the track in place while another rider’s session references it', async () => {
      const owner = await newRider('take-back-owner');
      const other = await newRider('take-back-other');
      const track = await ownTrack(owner, NEW_CIRCUIT);
      const theirs = await sessionOn(other, track);

      const { data, error } = await owner.client.rpc('delete_auto_created_track_if_unused', { p_track_id: track });

      expect(error, error?.message).toBeNull();
      expect(data).toBe(false);
      expect(await ownTracks(owner)).toEqual([{ id: track, name: NEW_CIRCUIT }]);
      const stored = await admin.from('sessions').select('track_id').eq('id', theirs).single();
      expect(stored.data).toEqual({ track_id: track });
    });

    // The check behind it sees every rider's sessions, so it must not answer for
    // a track that is not the caller's own: that would let a rider learn whether
    // other riders have sessions on any track id they can name.
    test('has a reference check that answers only for the caller’s own auto-created track', async () => {
      const owner = await newRider('take-back-probe-owner');
      const other = await newRider('take-back-probe-other');
      const track = await ownTrack(owner, NEW_CIRCUIT);
      await sessionOn(owner, track);
      const roadAmerica = await seededTrack('Road America');
      await save(other, { track_id: roadAmerica.id, track_name: roadAmerica.name });

      const own = await owner.client.rpc('auto_created_track_is_referenced', { p_track_id: track });
      const someoneElses = await other.client.rpc('auto_created_track_is_referenced', { p_track_id: track });
      const seeded = await other.client.rpc('auto_created_track_is_referenced', { p_track_id: roadAmerica.id });
      const nobody = await anonClient().rpc('auto_created_track_is_referenced', { p_track_id: track });

      expect(own).toMatchObject({ data: true, error: null });
      expect(someoneElses).toMatchObject({ data: null, error: null });
      expect(seeded).toMatchObject({ data: null, error: null });
      expect(nobody.error?.code).toBe('42501');
    });

    test('deletes the rider’s own track once nothing references it', async () => {
      const owner = await newRider('take-back-unused');
      const track = await ownTrack(owner, NEW_CIRCUIT);

      const { data, error } = await owner.client.rpc('delete_auto_created_track_if_unused', { p_track_id: track });

      expect(error, error?.message).toBeNull();
      expect(data).toBe(true);
      expect(await ownTracks(owner)).toEqual([]);
    });
  });

  test.describe('the layout', () => {
    test('records the layout the rider chose on the circuit they chose', async () => {
      const rider = await newRider('layout-own');
      const midOhio = await seededTrack('Mid-Ohio Sports Car Course');
      const club = await layoutOf(midOhio.id, 'Club Course');

      const result = await save(rider, { track_id: midOhio.id, track_name: midOhio.name, layout_id: club });

      expect(result.ok && result.data.session).toMatchObject({ layout_id: club, layout_name: 'Club Course' });
    });

    test('drops a layout of a different circuit, and still saves', async () => {
      const rider = await newRider('layout-foreign');
      const midOhio = await seededTrack('Mid-Ohio Sports Car Course');
      const mosport = await seededTrack('Canadian Tire Motorsport Park');
      const foreign = await layoutOf(mosport.id, 'Grand Prix Circuit');

      const result = await save(rider, { track_id: midOhio.id, track_name: midOhio.name, layout_id: foreign });

      expect(result.ok && result.data.session).toMatchObject({ track_id: midOhio.id, layout_id: null, layout_name: null });
    });
  });

  test.describe('change records', () => {
    test('writes none for a vehicle’s first session', async () => {
      const rider = await newRider('changes-first');

      const result = await save(rider);

      const changes = await admin.from('session_changes').select('id').eq('user_id', rider.rider.id);
      expect(result.ok).toBe(true);
      expect(changes.data).toEqual([]);
    });

    test('records what changed against the previous session and the active baseline', async () => {
      const rider = await newRider('changes-both');
      const earlier = formInput(rider.vehicle).tires;
      const first = await save(rider, {
        date: '2026-09-26',
        tires: { ...earlier, front: { ...earlier.front, pressure: '33' } },
      });
      expect(first.ok).toBe(true);
      const firstSession = first.ok ? first.data.session! : null;
      const baseline = await admin.from('vehicle_baselines').insert({
        user_id: rider.rider.id,
        vehicle_id: rider.vehicle,
        source_session_id: firstSession!.id,
        source_track_name: 'Road America',
        source_date: '2026-09-26',
        source_conditions: 'sunny',
        tires: firstSession!.tires,
        suspension: firstSession!.suspension,
        enabled_modules: firstSession!.enabled_modules ?? {},
      });
      expect(baseline.error, baseline.error?.message).toBeNull();

      const second = await save(rider);

      expect(second.ok).toBe(true);
      const changes = await admin
        .from('session_changes')
        .select('reference_kind, reference_session_id, changes')
        .eq('session_id', second.ok ? second.data.session!.id : '')
        .order('reference_kind');
      expect(changes.error, changes.error?.message).toBeNull();
      const pressure = { group: 'Tires', label: 'Front pressure', from: '33', to: '31' };
      expect(changes.data).toEqual([
        { reference_kind: 'baseline', reference_session_id: firstSession!.id, changes: [pressure] },
        { reference_kind: 'previous', reference_session_id: firstSession!.id, changes: [pressure] },
      ]);
    });
  });
});
