import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { findSavedTrackByName, trackNameKey } from '@/lib/session-track';
import {
  buildTrackAliasIndex,
  buildTrackLayoutIndex,
  findLayoutForTrack,
  findTrackByAlias,
} from '@/lib/track-directory';
import type { Track, TrackAlias, TrackLayout } from '@/types';

function track(id: string, name: string): Track {
  return { id, name, location: null, slug: id, is_seeded: true, created_by: null, created_at: '' };
}

function alias(trackId: string, value: string): TrackAlias {
  return { id: `${trackId}:${value}`, track_id: trackId, alias: value, created_at: '' };
}

function layout(trackId: string, id: string, name: string, sortOrder: number): TrackLayout {
  return { id, track_id: trackId, slug: id, name, sort_order: sortOrder, created_at: '' };
}

describe('track aliases', () => {
  const tracks = [track('cota', 'Circuit of the Americas'), track('ctmp', 'Canadian Tire Motorsport Park')];

  it('finds a circuit from a name it is known by, however it is cased and spaced', () => {
    const aliases = buildTrackAliasIndex([alias('cota', 'COTA'), alias('ctmp', 'Mosport')]);

    expect(findTrackByAlias(' cota ', aliases, tracks)?.id).toBe('cota');
    expect(findTrackByAlias('MOSPORT', aliases, tracks)?.id).toBe('ctmp');
    expect(findTrackByAlias('Road Atlanta', aliases, tracks)).toBeNull();
    expect(findTrackByAlias('   ', aliases, tracks)).toBeNull();
  });

  it('ignores an alias whose circuit the rider cannot see', () => {
    const aliases = buildTrackAliasIndex([alias('someone-elses', 'Home Track')]);

    expect(findTrackByAlias('Home Track', aliases, tracks)).toBeNull();
  });

  it('drops an alias that two circuits both claim rather than guessing between them', () => {
    const aliases = buildTrackAliasIndex([alias('cota', 'AMP'), alias('ctmp', 'amp'), alias('cota', 'COTA')]);

    expect(aliases).toEqual({ cota: 'cota' });
    expect(findTrackByAlias('AMP', aliases, tracks)).toBeNull();
  });

  it('keeps an alias repeated for the same circuit', () => {
    expect(buildTrackAliasIndex([alias('cota', 'COTA'), alias('cota', 'cota')])).toEqual({ cota: 'cota' });
  });
});

describe('track layouts', () => {
  const index = buildTrackLayoutIndex([
    layout('msr', 'msr-31', '3.1-Mile', 2),
    layout('msr', 'msr-17', '1.7-Mile', 0),
    layout('vir', 'vir-full', 'Full Course', 0),
    layout('msr', 'msr-13', '1.3-Mile', 1),
  ]);

  it('groups each circuit\'s layouts in their offered order', () => {
    expect(index.msr.map((row) => row.name)).toEqual(['1.7-Mile', '1.3-Mile', '3.1-Mile']);
    expect(index.vir.map((row) => row.name)).toEqual(['Full Course']);
  });

  it('only answers with a layout that belongs to the circuit asked about', () => {
    expect(findLayoutForTrack('msr-13', 'msr', index)?.name).toBe('1.3-Mile');
    expect(findLayoutForTrack('vir-full', 'msr', index)).toBeNull();
    expect(findLayoutForTrack('msr-13', null, index)).toBeNull();
    expect(findLayoutForTrack(null, 'msr', index)).toBeNull();
  });
});

/**
 * The seed itself, read out of the migration that ships it.
 *
 * These are the claims the migration's header makes, checked against its rows
 * rather than against a fixture that could agree with the code and not with
 * what a database is actually given.
 */
describe('the North America seed', () => {
  const sql = readFileSync(
    path.resolve(__dirname, '../supabase/migrations/20260916001600_seed_north_america_tracks.sql'),
    'utf8',
  );

  const quoted = String.raw`'((?:[^']|'')*)'`;
  const unquote = (value: string) => value.replace(/''/g, "'");

  const seeded = [...sql.matchAll(new RegExp(String.raw`^\s*\(${quoted}, ${quoted}, (?:${quoted}|null), true, null\)`, 'gm'))].map(
    (match) => track(unquote(match[1]), unquote(match[2])),
  );
  const aliasSection = sql.slice(sql.indexOf('insert into public.track_aliases'));
  const aliasRows = [...aliasSection.matchAll(new RegExp(String.raw`^\s*\(${quoted}, ${quoted}\)`, 'gm'))].map(
    (match) => alias(unquote(match[1]), unquote(match[2])),
  );
  const layoutSection = sql.slice(
    sql.indexOf('insert into public.track_layouts'),
    sql.indexOf('insert into public.track_aliases'),
  );
  const layoutRows = [
    ...layoutSection.matchAll(new RegExp(String.raw`^\s*\(${quoted}, ${quoted}, ${quoted}, (\d+)::smallint\)`, 'gm')),
  ].map((match) => layout(unquote(match[1]), `${match[1]}/${match[2]}`, unquote(match[3]), Number(match[4])));

  const aliases = buildTrackAliasIndex(aliasRows);
  const layouts = buildTrackLayoutIndex(layoutRows);

  /** What `resolveSessionTrack` settles on: names first, then aliases. */
  const resolve = (typed: string) =>
    findSavedTrackByName(typed, seeded)?.id ?? findTrackByAlias(typed, aliases, seeded)?.id ?? null;

  it('was read at all, so the checks below are about real rows', () => {
    expect(seeded.length).toBe(50);
    expect(aliasRows.length).toBeGreaterThan(50);
    expect(layoutRows.length).toBeGreaterThan(40);
  });

  it('files the reproduction\'s two spellings under one circuit', () => {
    expect(resolve('Circuit of the Americas')).toBe('circuit-of-the-americas');
    expect(resolve('COTA')).toBe('circuit-of-the-americas');
  });

  it.each([
    ['cota', 'circuit-of-the-americas'],
    ['circuit of the  americas', 'circuit-of-the-americas'],
    ['Mosport', 'canadian-tire-motorsport-park'],
    ['mid ohio', 'mid-ohio-sports-car-course'],
    ['Mid-Ohio', 'mid-ohio-sports-car-course'],
    ['VIR', 'virginia-international-raceway'],
    ['laguna seca', 'weathertech-raceway-laguna-seca'],
    ['Sears Point', 'sonoma-raceway'],
    ['Miller Motorsports Park', 'utah-motorsports-campus'],
    ['MSR Cresson', 'motorsport-ranch'],
    // Typed on a keyboard without the accents.
    ['Autodromo Hermanos Rodriguez', 'autodromo-hermanos-rodriguez'],
    ['Autódromo Hermanos Rodríguez', 'autodromo-hermanos-rodriguez'],
  ])('finds %j as the seeded circuit %s', (typed, slug) => {
    expect(resolve(typed)).toBe(slug);
  });

  it('keeps Road America and Road Atlanta apart', () => {
    expect(resolve('Road America')).toBe('road-america');
    expect(resolve('Road Atlanta')).toBe('road-atlanta');
  });

  it('does not guess at a circuit nobody seeded', () => {
    expect(resolve('GingerMan Raceway')).toBeNull();
    expect(resolve('Road Americas')).toBeNull();
  });

  it('points every alias at a circuit it seeds', () => {
    const slugs = new Set(seeded.map((row) => row.id));
    expect(aliasRows.filter((row) => !slugs.has(row.track_id))).toEqual([]);
    expect(layoutRows.filter((row) => !slugs.has(row.track_id))).toEqual([]);
  });

  it('never folds one alias onto another, or onto a different circuit\'s name', () => {
    // The unique index refuses the first when the file is applied; this says so
    // before anyone has to apply it. The second the index cannot see.
    expect(Object.keys(aliases)).toHaveLength(aliasRows.length);

    const nameOwners = new Map(seeded.map((row) => [trackNameKey(row.name), row.id]));
    const clashes = aliasRows.filter((row) => {
      const owner = nameOwners.get(trackNameKey(row.alias));
      return owner !== undefined && owner !== row.track_id;
    });
    expect(clashes).toEqual([]);
  });

  it('models a circuit\'s configurations as layouts of it, not as circuits', () => {
    expect(layouts['motorsport-ranch'].map((row) => row.name)).toEqual(['1.7-Mile', '1.3-Mile', '3.1-Mile']);
    // No seeded circuit carries a configuration in its name.
    expect(seeded.filter((row) => /\d\.\d|\bconfig/i.test(row.name))).toEqual([]);
  });

  it('gives each circuit\'s layouts distinct names', () => {
    for (const [trackId, rows] of Object.entries(layouts)) {
      const names = rows.map((row) => trackNameKey(row.name));
      expect(new Set(names).size, trackId).toBe(names.length);
    }
  });

  it('leaves a circuit with one configuration nothing to choose', () => {
    expect(layouts['circuit-of-the-americas']).toBeUndefined();
  });
});
