import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn(async () => ({ get: vi.fn(() => undefined) })) }));
vi.mock('@/lib/auth', () => ({ getRealUser: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }));
vi.mock('@/lib/actions/vehicles', () => ({ getUserProfile: vi.fn() }));
vi.mock('@/lib/monitoring/report-error', () => ({ reportError: vi.fn() }));

import { getRealUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { getComparableSessions, getPreviousSession, getSession, getSessions } from '@/lib/actions/sessions';
import { SessionHistoryList } from '@/components/sessions/session-history-list';
import { SetupSections } from '@/components/sessions/setup-sections';
import { copyLastSessionSetup } from '@/lib/session-copy';
import {
  buildPreviousSessionCompareRows,
  buildSessionComparisonModel,
  buildSetupCompareRows,
} from '@/lib/session-compare';
import { deriveSessionAnalytics, flattenSessionForExport } from '@/lib/session-export';
import { resolveSessionEnabledModules } from '@/lib/session-modules';
import { buildSetupView } from '@/lib/setup-view';

/**
 * tt-session-screens-nonstring-fields, reproduced through the read seam a rider's
 * request actually takes.
 *
 * `sessions.tires` and `sessions.suspension` are unconstrained `jsonb`. On
 * 2026-09-30 a session whose front pressure was stored as the JSON number 30
 * took down the whole sessions list (`value?.trim is not a function`), and a
 * session whose setup blobs were stored as JSON `null` took down the detail
 * page, compare, copy and the export (`Cannot read properties of null (reading
 * 'front')`). Both were reproduced in a browser before the fix.
 *
 * Each case below reads the row through the server action the page calls, with
 * Supabase faked at the client, and hands the result to the builder or
 * component that crashed - so it fails on the old casts and passes only because
 * the actions now read rows through `readStoredSession`. The owner's answers
 * (2026-09-30) are what it asserts: a number shows as typed, a missing blob is a
 * normal session with every setup field not logged.
 */

const USER_ID = 'user-1';
const VEHICLE_ID = 'vehicle-1';
const NUMBER_ID = 'session-number-leaf';
const NULL_ID = 'session-null-blob';
const PREVIOUS_ID = 'session-well-formed';

function row(id: string, overrides: Record<string, unknown>) {
  return {
    id,
    user_id: USER_ID,
    vehicle_id: VEHICLE_ID,
    track_id: null,
    track_name: 'Buttonwillow Raceway Park',
    layout_id: null,
    layout_name: null,
    date: '2026-09-20',
    start_time: '09:00:00',
    session_number: 1,
    conditions: 'sunny',
    tires: {
      front: { brand: 'Pirelli', compound: 'SC1', pressure: '31' },
      rear: { brand: 'Pirelli', compound: 'SC2', pressure: '29' },
      condition: 'used',
    },
    suspension: {
      front: { preload: '5', compression: '10', rebound: '12', direction: 'out' },
      rear: { preload: '8', compression: '9', rebound: '11', direction: 'out' },
    },
    alignment: null,
    enabled_modules: null,
    extra_modules: null,
    notes: null,
    photo_url: null,
    created_at: '2026-09-20T12:00:00Z',
    updated_at: '2026-09-20T12:00:00Z',
    ...overrides,
  };
}

const rows = [
  row(NUMBER_ID, {
    session_number: 3,
    start_time: '14:00:00',
    tires: {
      front: { brand: 'Pirelli', compound: 'SC1', pressure: 30 },
      rear: { brand: 'Pirelli', compound: 'SC2', pressure: 28 },
      condition: 'used',
    },
  }),
  row(NULL_ID, { session_number: 2, start_time: '11:00:00', tires: null, suspension: null }),
  row(PREVIOUS_ID, {}),
];

/** A `sessions` table that honours `.eq`, `.neq` and `.single()`. */
function fakeSupabase() {
  return {
    from: vi.fn(() => {
      const filters: Array<(candidate: Record<string, unknown>) => boolean> = [];
      const matching = () => rows.filter((candidate) => filters.every((keep) => keep(candidate)));
      const query: Record<string, unknown> = {};
      for (const method of ['select', 'order', 'limit', 'lte', 'lt', 'range', 'is', 'ilike', 'in']) {
        query[method] = vi.fn(() => query);
      }
      query.eq = vi.fn((column: string, value: unknown) => {
        filters.push((candidate) => candidate[column] === value);
        return query;
      });
      query.neq = vi.fn((column: string, value: unknown) => {
        filters.push((candidate) => candidate[column] !== value);
        return query;
      });
      query.single = vi.fn(async () => {
        const found = matching();
        return found.length === 1
          ? { data: found[0], error: null }
          : { data: null, error: { message: 'not one row', code: 'PGRST116' } };
      });
      query.then = (onFulfilled: (value: unknown) => unknown) =>
        Promise.resolve({ data: matching(), error: null }).then(onFulfilled);
      return query;
    }),
  };
}

beforeEach(() => {
  vi.mocked(getRealUser).mockResolvedValue({ id: USER_ID } as never);
  vi.mocked(createClient).mockResolvedValue(fakeSupabase() as never);
});

async function readSession(id: string) {
  const session = await getSession(id);
  if (!session) throw new Error(`fixture ${id} did not read back`);
  return session;
}

describe('a session stored with a number where text was expected', () => {
  it('renders on the sessions list, showing the number as typed', async () => {
    const sessions = await getSessions();

    const html = renderToStaticMarkup(
      createElement(SessionHistoryList, {
        items: sessions.map((session) => ({ session, vehicleNickname: 'R6', environment: null })),
      }),
    );

    expect(html).toContain('>30<');
    expect(html).toContain('>28<');
  });

  it('exports and trends the number as the text it prints as', async () => {
    const session = await readSession(NUMBER_ID);
    const input = { session, vehicle: null, environment: null, telemetry: null };

    expect(flattenSessionForExport(input).front_tire_pressure).toBe('30');
    expect(() => deriveSessionAnalytics([input])).not.toThrow();
  });
});

describe('a session stored with a null setup blob', () => {
  it('opens on the detail page with every setup field not logged', async () => {
    const session = await readSession(NULL_ID);
    const previous = await getPreviousSession(session);
    const enabled = resolveSessionEnabledModules(session, 'motorcycle');

    const view = buildSetupView(session, enabled);
    const html = renderToStaticMarkup(createElement(SetupSections, { view }));
    const tires = view.groups.find((group) => group.key === 'tires');
    const suspension = view.groups.find((group) => group.key === 'suspension');

    expect(tires?.rows.every((setupRow) => !setupRow.value)).toBe(true);
    expect(suspension?.rows.every((setupRow) => !setupRow.value)).toBe(true);
    expect(html).toContain('Front Pressure');
    // The rest of the session reads as usual.
    expect(session.track_name).toBe('Buttonwillow Raceway Park');
    expect(previous?.id).toBe(PREVIOUS_ID);

    const compareRows = buildPreviousSessionCompareRows(
      session,
      previous!,
      enabled,
      resolveSessionEnabledModules(previous!, 'motorcycle'),
    );
    expect(compareRows.find((compareRow) => compareRow.label === 'Tires: Front Pressure')).toEqual({
      label: 'Tires: Front Pressure',
      current: '',
      previous: '31',
    });
  });

  it('opens on the compare screen', async () => {
    const session = await readSession(NULL_ID);
    const [baseline] = await getComparableSessions(session);

    const model = buildSessionComparisonModel({ currentSession: session, baselineSession: baseline });
    const setupRows = buildSetupCompareRows(session, baseline);

    expect(model.summary).toEqual(expect.any(String));
    expect(setupRows.find((setupRow) => setupRow.label === 'Front pressure')).toMatchObject({
      group: 'Tires',
      current: '',
    });
  });

  it('copies into a new session as a blank setup', async () => {
    const copied = copyLastSessionSetup(await readSession(NULL_ID), 'motorcycle');

    expect(copied.frontTire).toEqual({ brand: '', compound: '', pressure: '' });
    expect(copied.tireCondition).toBeNull();
  });

  it('exports with every setup column empty', async () => {
    const session = await readSession(NULL_ID);
    const exported = flattenSessionForExport({ session, vehicle: null, environment: null, telemetry: null });

    expect(exported.front_tire_pressure).toBe('');
    expect(exported.front_suspension_direction).toBeNull();
  });
});
