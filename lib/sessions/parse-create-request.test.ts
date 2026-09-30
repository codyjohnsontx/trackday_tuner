import { describe, expect, it } from 'vitest';
import { parseCreateSessionRequest } from '@/lib/sessions/parse-create-request';
import { SETUP_FIELDS, readStoredSession } from '@/lib/stored-session';

/**
 * The phone's save check reads which setup fields a body may carry off
 * `SETUP_FIELDS`, the list the screens read a stored session through, so the two
 * cannot disagree about what a session holds. The route suite
 * (app/api/mobile/sessions/route.test.ts) walks the rest of the body through the
 * route; these pin the setup half against that list.
 */

const ID = '44444444-4444-4444-8444-444444444444';
const VEHICLE_ID = '22222222-2222-4222-8222-222222222222';

/** A value for every setup field on the list, each one different, so a dropped or crossed field shows. */
function everySetupField() {
  const body: Record<string, Record<string, unknown>> = {};
  for (const [index, field] of SETUP_FIELDS.entries()) {
    const path = field.id.split('.');
    const leaf = path.pop()!;
    let container: Record<string, unknown> = body;
    for (const key of path) container = (container[key] ??= {}) as Record<string, unknown>;
    container[leaf] = field.kind === 'choice' ? field.options![0] : `value ${index}`;
  }
  return body;
}

function sessionBody(setup: Record<string, unknown>) {
  return { id: ID, vehicle_id: VEHICLE_ID, track_name: 'Road America', date: '2026-09-27', conditions: 'sunny', ...setup };
}

describe('parseCreateSessionRequest and SETUP_FIELDS', () => {
  it('accepts every field on the list and stores each where the screens read it back', () => {
    const parsed = parseCreateSessionRequest(sessionBody(everySetupField()));

    expect(parsed.ok, !parsed.ok ? parsed.error : '').toBe(true);
    const session = readStoredSession(parsed.ok ? parsed.data.input : null);
    for (const [index, field] of SETUP_FIELDS.entries()) {
      expect(field.read(session), field.id).toBe(field.kind === 'choice' ? field.options![0] : `value ${index}`);
    }
  });

  it.each(['tires.front', 'tires', 'suspension.rear', 'alignment', 'extra_modules.aero', 'extra_modules'])(
    'refuses a key under %s that is not on the list',
    (container) => {
      const setup = everySetupField();
      let target: Record<string, unknown> = setup;
      for (const key of container.split('.')) target = target[key] as Record<string, unknown>;
      target.surprise = 'x';

      expect(parseCreateSessionRequest(sessionBody(setup))).toEqual({
        ok: false,
        error: `Unknown field: ${container}.surprise.`,
      });
    },
  );

  it('keeps the hot pressure, which is a reading after the session rather than a setup field', () => {
    const setup = everySetupField();
    (setup.tires.front as Record<string, unknown>).hot_pressure = '35';

    const parsed = parseCreateSessionRequest(sessionBody(setup));

    expect(parsed.ok && parsed.data.input.tires.front.hot_pressure).toBe('35');
  });

  it('refuses a number where a setup value is text, rather than storing one the screens cannot print as typed', () => {
    const setup = everySetupField();
    (setup.suspension.front as Record<string, unknown>).rebound = 8;

    expect(parseCreateSessionRequest(sessionBody(setup))).toEqual({
      ok: false,
      error: 'suspension.front.rebound must be a string.',
    });
  });

  it('takes the tyre condition as one of its options or as not logged, and nothing else', () => {
    const unlogged = everySetupField();
    (unlogged.tires as Record<string, unknown>).condition = null;
    const absent = everySetupField();
    delete (absent.tires as Record<string, unknown>).condition;
    const odd = everySetupField();
    (odd.tires as Record<string, unknown>).condition = 'bald';

    const parsed = parseCreateSessionRequest(sessionBody(unlogged));
    const parsedAbsent = parseCreateSessionRequest(sessionBody(absent));

    expect(parsed.ok && parsed.data.input.tires.condition).toBeNull();
    expect(parsedAbsent.ok && parsedAbsent.data.input.tires.condition).toBeNull();
    expect(parseCreateSessionRequest(sessionBody(odd))).toEqual({
      ok: false,
      error: 'tires.condition must be one of new, scrubbed, used, worn, or null.',
    });
  });

  it('requires an adjuster direction on each end, as in or out', () => {
    const cases: [string, unknown][] = [
      ['null', null],
      ['absent', undefined],
      ['odd', 'sideways'],
    ];
    for (const [label, direction] of cases) {
      const setup = everySetupField();
      const rear = setup.suspension.rear as Record<string, unknown>;
      if (direction === undefined) delete rear.direction;
      else rear.direction = direction;

      expect(parseCreateSessionRequest(sessionBody(setup)), label).toEqual({
        ok: false,
        error: 'suspension.rear.direction must be in or out.',
      });
    }
  });

  it('requires every tyre, suspension and alignment value, and only the advanced-module values sent', () => {
    const missingTyre = everySetupField();
    delete (missingTyre.tires.rear as Record<string, unknown>).compound;
    const partialModule = everySetupField();
    partialModule.extra_modules = { geometry: { fork_height: '3' } };

    expect(parseCreateSessionRequest(sessionBody(missingTyre))).toEqual({
      ok: false,
      error: 'tires.rear.compound must be a string.',
    });
    const parsed = parseCreateSessionRequest(sessionBody(partialModule));
    expect(parsed.ok && parsed.data.input.extra_modules).toEqual({ geometry: { fork_height: '3' } });
  });
});
