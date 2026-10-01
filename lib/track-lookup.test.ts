import { describe, expect, it, vi } from 'vitest';
import { getFreePlanLimit } from '@/lib/plans';
import {
  CUSTOM_TRACK_LABEL,
  findTrackByName,
  findVisibleTrackByName,
  isAtCustomTrackCap,
  isAtCustomTrackCapInDatabase,
  isCustomTrack,
  resolveTrackInDirectory,
} from '@/lib/track-lookup';
import { createTrackNameQuery, likeExpression } from '@/tests/unit/helpers/track-name-query';

const USER_ID = 'user-1';
const CAP = getFreePlanLimit('tracks');

type Row = { id: string; name: string; is_seeded: boolean };

const seeded = (id: string, name: string): Row => ({ id, name, is_seeded: true });
const own = (id: string, name: string): Row => ({ id, name, is_seeded: false });

/** A `track_aliases` read that applies the `ilike` it is handed, as the database does. */
function createAliasQuery(rows: { alias: string; tracks: { id: string; name: string } }[]) {
  let matched = rows;
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.ilike = vi.fn((_column: string, pattern: string) => {
    const expression = likeExpression(pattern);
    matched = matched.filter((row) => expression.test(row.alias));
    return query;
  });
  query.then = (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) =>
    Promise.resolve({ data: matched, error: null }).then(onFulfilled, onRejected);
  return query;
}

function fakeClient(tracks: Row[], aliases: { alias: string; tracks: { id: string; name: string } }[] = []) {
  const from = vi.fn((table: string) => (table === 'tracks' ? createTrackNameQuery(tracks) : createAliasQuery(aliases)));
  return { client: { from } as never, from };
}

function fakeCountClient(count: number | null) {
  const query: Record<string, unknown> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.then = (onFulfilled: (value: unknown) => unknown) => Promise.resolve({ count, error: null }).then(onFulfilled);
  const from = vi.fn(() => query);
  return { client: { from } as never, from, query };
}

describe('own track first', () => {
  it('prefers the rider\'s own track over a seeded one with the same name, in either order', () => {
    const roadAmerica = seeded('seeded-road-america', 'Road America');
    const mine = own('own-road-america', 'road  america');

    expect(findTrackByName('Road America', [roadAmerica, mine])?.id).toBe('own-road-america');
    expect(findTrackByName('Road America', [mine, roadAmerica])?.id).toBe('own-road-america');
    expect(findTrackByName('Road America', [roadAmerica])?.id).toBe('seeded-road-america');
    expect(findTrackByName('Road Atlanta', [roadAmerica, mine])).toBeNull();
  });

  it('keeps list order among tracks of the same standing', () => {
    expect(findTrackByName('Loop', [own('a', 'Loop'), own('b', 'loop')])?.id).toBe('a');
    expect(findTrackByName('Loop', [seeded('a', 'Loop'), seeded('b', 'loop')])?.id).toBe('a');
  });

  it('lets an own track found by the wider pattern beat a seeded one the exact pattern found', async () => {
    // The exact pattern matches only the seeded row; the rider's own row, stored
    // with doubled spacing, is reached only by the wildcard pass.
    const { client, from } = fakeClient([seeded('seeded', 'Road America'), own('mine', 'Road  America')]);

    await expect(findVisibleTrackByName(client, USER_ID, 'Road America')).resolves.toEqual({
      status: 'found',
      track: { id: 'mine', name: 'Road  America' },
    });
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('stops at an own track the exact pattern found, since nothing later can outrank it', async () => {
    const { client, from } = fakeClient([own('mine', 'Road America'), seeded('seeded', 'Road  America')]);

    await expect(findVisibleTrackByName(client, USER_ID, 'Road  America')).resolves.toEqual({
      status: 'found',
      track: { id: 'mine', name: 'Road America' },
    });
    expect(from).toHaveBeenCalledTimes(1);
  });

  it('labels and counts only the rider\'s own tracks as custom', () => {
    expect(isCustomTrack(own('a', 'Loop'))).toBe(true);
    expect(isCustomTrack(seeded('b', 'Road America'))).toBe(false);
    expect(CUSTOM_TRACK_LABEL).toBe('Custom');
  });
});

describe('id, then name, then alias', () => {
  const barberSeeded = seeded('barber-motorsports-park', 'Barber Motorsports Park');
  const barberMine = own('my-barber', 'Barber');
  const aliases = { barber: 'barber-motorsports-park', vir: 'vir' };
  const vir = seeded('vir', 'Virginia International Raceway');
  const tracks = [barberSeeded, barberMine, vir];

  it('takes a listed id over whatever was typed', () => {
    for (const unlistedId of ['keep', 'ignore'] as const) {
      expect(resolveTrackInDirectory({ trackId: 'vir', typed: 'Barber', tracks, aliases, unlistedId })).toBe('vir');
    }
  });

  it('takes a name over an alias spelled the same', () => {
    expect(resolveTrackInDirectory({ trackId: null, typed: 'barber', tracks, aliases, unlistedId: 'ignore' })).toBe(
      'my-barber',
    );
  });

  it('falls back to an alias when no name matches', () => {
    expect(resolveTrackInDirectory({ trackId: null, typed: 'VIR', tracks, aliases, unlistedId: 'ignore' })).toBe('vir');
    expect(resolveTrackInDirectory({ trackId: null, typed: 'Road Atlanta', tracks, aliases, unlistedId: 'ignore' })).toBeNull();
  });

  it('keeps or ignores an id missing from the list, as the caller says', () => {
    expect(resolveTrackInDirectory({ trackId: 'deleted', typed: 'VIR', tracks, aliases, unlistedId: 'keep' })).toBe(
      'deleted',
    );
    expect(resolveTrackInDirectory({ trackId: 'deleted', typed: 'VIR', tracks, aliases, unlistedId: 'ignore' })).toBe(
      'vir',
    );
  });

  it('asks the database for an alias only once no name matched', async () => {
    const { client, from } = fakeClient(
      [own('my-barber', 'Barber')],
      [{ alias: 'Barber', tracks: { id: 'barber-motorsports-park', name: 'Barber Motorsports Park' } }],
    );

    await expect(findVisibleTrackByName(client, USER_ID, 'barber')).resolves.toEqual({
      status: 'found',
      track: { id: 'my-barber', name: 'Barber' },
    });
    expect(from).not.toHaveBeenCalledWith('track_aliases');

    const missing = fakeClient(
      [],
      [{ alias: 'VIR', tracks: { id: 'vir', name: 'Virginia International Raceway' } }],
    );
    await expect(findVisibleTrackByName(missing.client, USER_ID, 'vir')).resolves.toEqual({
      status: 'found',
      track: { id: 'vir', name: 'Virginia International Raceway' },
    });
    expect(missing.from).toHaveBeenCalledWith('track_aliases');
  });
});

describe('custom-track cap', () => {
  const ownTracks = (count: number) => Array.from({ length: count }, (_, index) => own(`own-${index}`, `Own ${index}`));

  it('counts only own tracks in a visible list', () => {
    const seededMany = Array.from({ length: CAP + 2 }, (_, index) => seeded(`s-${index}`, `Seeded ${index}`));

    expect(isAtCustomTrackCap([...seededMany, ...ownTracks(CAP - 1)], false)).toBe(false);
    expect(isAtCustomTrackCap([...seededMany, ...ownTracks(CAP)], false)).toBe(true);
    expect(isAtCustomTrackCap(ownTracks(CAP + 5), true)).toBe(false);
  });

  it('counts the rider\'s own unseeded rows in the database', async () => {
    const atCap = fakeCountClient(CAP);
    await expect(isAtCustomTrackCapInDatabase(atCap.client, USER_ID, false)).resolves.toBe(true);
    expect(atCap.query.eq).toHaveBeenCalledWith('created_by', USER_ID);
    expect(atCap.query.eq).toHaveBeenCalledWith('is_seeded', false);

    await expect(isAtCustomTrackCapInDatabase(fakeCountClient(CAP - 1).client, USER_ID, false)).resolves.toBe(false);
  });

  it('reads a count it could not get as below the cap', async () => {
    await expect(isAtCustomTrackCapInDatabase(fakeCountClient(null).client, USER_ID, false)).resolves.toBe(false);
  });

  it('never counts for a pro rider', async () => {
    const pro = fakeCountClient(CAP + 10);
    await expect(isAtCustomTrackCapInDatabase(pro.client, USER_ID, true)).resolves.toBe(false);
    expect(pro.from).not.toHaveBeenCalled();
  });
});
