import { describe, expect, it } from 'vitest';
import { hasManualSessionData, selectSimilarSessions } from '@/lib/rag/race-engineer-context';
import type { Session, SessionEnvironment } from '@/types';

const baseSession: Session = {
  id: 'current',
  user_id: 'user-1',
  vehicle_id: 'vehicle-1',
  track_id: 'track-1',
  track_name: 'Road America',
  layout_id: null,
  layout_name: null,
  date: '2026-04-22',
  start_time: '11:00:00',
  session_number: 2,
  conditions: 'sunny',
  tires: {
    front: { brand: 'Pirelli', compound: 'SC2', pressure: '31' },
    rear: { brand: 'Pirelli', compound: 'SC1', pressure: '25' },
    condition: 'scrubbed',
  },
  suspension: {
    front: { preload: '4', compression: '10', rebound: '8', direction: 'out' },
    rear: { preload: '6', compression: '12', rebound: '10', direction: 'out' },
  },
  alignment: null,
  enabled_modules: null,
  extra_modules: null,
  notes: 'Front pushed mid-corner.',
  photo_url: null,
  created_at: '2026-04-22T11:00:00Z',
  updated_at: '2026-04-22T11:00:00Z',
};

function environment(sessionId: string, ambient: number): SessionEnvironment {
  return {
    id: `env-${sessionId}`,
    user_id: 'user-1',
    session_id: sessionId,
    ambient_temperature_c: ambient,
    track_temperature_c: null,
    humidity_percent: null,
    weather_condition: null,
    surface_condition: null,
    source: 'manual',
    created_at: '2026-04-22T11:00:00Z',
    updated_at: '2026-04-22T11:00:00Z',
  };
}

describe('selectSimilarSessions', () => {
  it('ranks same-track, similar-pressure sessions first', () => {
    const sameTrack = {
      ...baseSession,
      id: 'same-track',
      date: '2026-04-21',
      tires: {
        ...baseSession.tires,
        front: { ...baseSession.tires.front, pressure: '31.2' },
        rear: { ...baseSession.tires.rear, pressure: '25.4' },
      },
    };
    const differentTrack = {
      ...baseSession,
      id: 'different-track',
      track_id: 'track-2',
      track_name: 'Barber',
      date: '2026-04-20',
      tires: {
        ...baseSession.tires,
        front: { ...baseSession.tires.front, pressure: '35' },
        rear: { ...baseSession.tires.rear, pressure: '29' },
      },
    };

    const result = selectSimilarSessions({
      current: baseSession,
      candidates: [differentTrack, sameTrack],
      environments: [
        environment(baseSession.id, 26),
        environment(sameTrack.id, 28),
        environment(differentTrack.id, 15),
      ],
    });

    expect(result[0].session.id).toBe('same-track');
    expect(result[0].reasons).toContain('same track');
    expect(result[0].reasons).toContain('similar ambient temperature');
  });

  // Name-only sessions are the same circuit when their names fold to one key
  // (lib/session-track.ts), so case, spacing and accent composition must not
  // cost a candidate its "same track" match.
  it.each([
    ['case', 'Road America', 'ROAD AMERICA'],
    ['spacing', 'Road America', ' Road  America'],
    ['accent composition', 'Aut\u00f3dromo Hermanos Rodr\u00edguez', 'Auto\u0301dromo Hermanos Rodri\u0301guez'],
  ])('matches name-only sessions whose track names differ only by %s', (_kind, currentName, candidateName) => {
    const current = { ...baseSession, track_id: null, track_name: currentName };
    const candidate = { ...baseSession, id: 'variant', track_id: null, track_name: candidateName, date: '2026-04-21' };

    const [match] = selectSimilarSessions({ current, candidates: [candidate] });

    expect(match.reasons).toContain('same track');
  });

  it('does not score different track rows as the same track when their names fold together', () => {
    const current = { ...baseSession, track_id: 'track-full', track_name: 'Road America' };
    const candidate = { ...baseSession, id: 'other-layout', track_id: 'track-short', track_name: 'road  america', date: '2026-04-21' };

    const [match] = selectSimilarSessions({ current, candidates: [candidate] });

    expect(match.reasons).not.toContain('same track');
  });

  it('returns no matches when there are no candidates', () => {
    const result = selectSimilarSessions({
      current: baseSession,
      candidates: [],
      environments: [environment(baseSession.id, 26)],
    });

    expect(result).toEqual([]);
  });

  it('still matches same-track sessions without environment rows', () => {
    const sameTrack = {
      ...baseSession,
      id: 'same-track-no-env',
      date: '2026-04-21',
    };

    const result = selectSimilarSessions({
      current: baseSession,
      candidates: [sameTrack],
      environments: [environment(baseSession.id, 26)],
    });

    expect(result).toHaveLength(1);
    expect(result[0].session.id).toBe('same-track-no-env');
    expect(result[0].reasons).toContain('same track');
    expect(result[0].reasons).not.toContain('similar ambient temperature');
  });

  it('does not tag far-apart same-track sessions as similar ambient temperature', () => {
    const sameTrack = {
      ...baseSession,
      id: 'same-track-hot',
      date: '2026-04-21',
    };

    const result = selectSimilarSessions({
      current: baseSession,
      candidates: [sameTrack],
      environments: [environment(baseSession.id, 26), environment(sameTrack.id, 44)],
    });

    expect(result).toHaveLength(1);
    expect(result[0].reasons).toContain('same track');
    expect(result[0].reasons).not.toContain('similar ambient temperature');
  });
});
/**
 * `sessions.tires` and `sessions.suspension` are shape-unconstrained `jsonb`
 * that `createSession` inserts verbatim, so every leaf below is a value the
 * database will accept although the TypeScript type says `string`, and every
 * container below is a shape it will accept although the type says otherwise.
 * Both helpers run inside the two AI routes' error boundaries and BEFORE the
 * prompt builder, so each of these used to answer a legitimate question with
 * the shaped 500.
 */
describe('the setup jsonb a rider can actually have stored', () => {
  /**
   * `hasManualSessionData` is an `||` chain that reads `notes` first and then
   * the two pressures, so a session carrying either never reaches the leaf
   * under test. Every case below starts from a session with none of them - the
   * rider who logged one number and no prose - or the chain short-circuits and
   * the case proves nothing.
   */
  const noManualText = {
    ...baseSession,
    notes: '',
    tires: {
      ...baseSession.tires,
      front: { ...baseSession.tires.front, pressure: '' },
      rear: { ...baseSession.tires.rear, pressure: '' },
    },
    suspension: {
      front: { ...baseSession.suspension.front, rebound: '' },
      rear: { ...baseSession.suspension.rear, rebound: '' },
    },
  } as unknown as Session;

  it.each([
    [
      'a number pressure',
      {
        tires: {
          ...noManualText.tires,
          front: { ...noManualText.tires.front, pressure: 31 },
        },
      },
      true,
    ],
    [
      'a number rebound',
      {
        suspension: {
          ...noManualText.suspension,
          front: { ...noManualText.suspension.front, rebound: 8 },
        },
      },
      true,
    ],
    ['a null tires blob', { tires: null as unknown as Session['tires'] }, false],
    ['a null suspension blob', { suspension: null as unknown as Session['suspension'] }, false],
    ['a tires blob with no axles', { tires: {} as unknown as Session['tires'] }, false],
    [
      'a suspension blob with no ends',
      { suspension: {} as unknown as Session['suspension'] },
      false,
    ],
    [
      'a composite where a pressure should be',
      {
        tires: {
          ...noManualText.tires,
          front: { ...noManualText.tires.front, pressure: { psi: 31 } },
        },
      },
      false,
    ],
    [
      'a true boolean where a pressure should be',
      {
        tires: {
          ...noManualText.tires,
          front: { ...noManualText.tires.front, pressure: true },
        },
      },
      false,
    ],
    [
      'a false boolean where a pressure should be',
      {
        tires: {
          ...noManualText.tires,
          front: { ...noManualText.tires.front, pressure: false },
        },
      },
      false,
    ],
  ])('reads manual data off a session with %s', (_label, partial, expected) => {
    expect(hasManualSessionData({ ...noManualText, ...partial } as Session)).toBe(expected);
  });

  /**
   * A boolean is not a compound. Rendering one as 'true' made two sessions that
   * both stored one score a match and print `matching front compound` into
   * `reasons`, which the prompt interpolates as evidence of a comparison that
   * was never made.
   */
  it('does not match two sessions on a boolean where a compound should be', () => {
    const withBooleanCompound = (id: string, date: string) =>
      ({
        ...baseSession,
        id,
        date,
        tires: {
          ...baseSession.tires,
          front: { ...baseSession.tires.front, compound: true },
          rear: { ...baseSession.tires.rear, compound: true },
        },
      }) as unknown as Session;

    const [match] = selectSimilarSessions({
      current: withBooleanCompound('current', '2026-04-22'),
      candidates: [withBooleanCompound('candidate', '2026-04-21')],
    });

    expect(match.reasons).not.toContain('matching front compound');
    expect(match.reasons).not.toContain('matching rear compound');
  });

  it('scores a pressure stored as a number the way the same pressure stored as text scores', () => {
    const candidate = { ...baseSession, id: 'candidate', date: '2026-04-21' };
    const asText = selectSimilarSessions({ current: baseSession, candidates: [candidate] });
    const asNumber = selectSimilarSessions({
      current: {
        ...baseSession,
        tires: {
          ...baseSession.tires,
          front: { ...baseSession.tires.front, pressure: 31 },
        },
      } as unknown as Session,
      candidates: [candidate],
    });

    expect(asNumber[0].reasons).toContain('front pressure within 0.5');
    expect(asNumber[0].score).toBe(asText[0].score);
  });

  it.each([
    ['a null tires blob on the current session', { tires: null as unknown as Session['tires'] }],
    ['a tires blob with no axles on the current session', { tires: {} as unknown as Session['tires'] }],
  ])('compares candidates against %s without throwing', (_label, partial) => {
    const candidate = { ...baseSession, id: 'candidate', date: '2026-04-21' };

    expect(() =>
      selectSimilarSessions({
        current: { ...baseSession, ...partial } as Session,
        candidates: [candidate],
      }),
    ).not.toThrow();
  });

  it('compares a candidate whose own tires blob is null without throwing', () => {
    const candidate = {
      ...baseSession,
      id: 'candidate',
      date: '2026-04-21',
      tires: null as unknown as Session['tires'],
    } as Session;

    const result = selectSimilarSessions({ current: baseSession, candidates: [candidate] });

    expect(result).toHaveLength(1);
    expect(result[0].reasons).not.toContain('matching front compound');
    expect(result[0].reasons).not.toContain('front pressure within 0.5');
  });
});
