import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { VehicleBaselineSetup } from '@/components/garage/vehicle-baseline-setup';
import { VehicleCard } from '@/components/garage/vehicle-card';
import { baselineToComparableSession } from '@/lib/session-changes';
import { resolveSessionEnabledModules } from '@/lib/session-modules';
import { buildSetupView, isSetupViewEmpty } from '@/lib/setup-view';
import type { Vehicle, VehicleBaseline } from '@/types';

/**
 * `vehicle_baselines` stores a whole known-good setup - tires, suspension,
 * alignment, extra modules and notes - and no screen in the app rendered any of
 * it. The garage card and the session detail panel both showed only
 * `baselineSourceLabel`: the track and date of the session it was copied from,
 * linked to that session. Reproduced in the browser on a real Pro account,
 * whose garage card read "BASELINE / Barber Motorsports Park · Aug 10, 2026 ·
 * Session 1" and not one of the stored numbers.
 *
 * The link is not a substitute for the snapshot, twice over: editing that
 * session does not update the copy, and `source_session_id` is
 * `on delete set null`, so deleting it leaves a stored setup pointing nowhere.
 *
 * The suite has no DOM, so this renders to static markup: structural evidence
 * that the values reach the rider, not that they are legible on screen.
 */

function baseline(overrides: Partial<VehicleBaseline> = {}): VehicleBaseline {
  return {
    id: 'baseline-1',
    user_id: 'user-1',
    vehicle_id: 'bike-1',
    source_session_id: 'session-1',
    source_track_id: null,
    source_track_name: 'Barber Motorsports Park',
    source_date: '2026-08-10',
    source_start_time: '09:30:00',
    source_session_number: 1,
    source_conditions: 'sunny',
    tires: {
      condition: 'scrubbed',
      front: { brand: 'Pirelli', compound: 'SC1', pressure: '30 psi' },
      rear: { brand: 'Pirelli', compound: 'SC1', pressure: '28 psi' },
    },
    suspension: {
      front: { preload: '4', compression: '12', rebound: '10', direction: 'out' },
      rear: { preload: '6', compression: '8', rebound: '9', direction: 'out' },
    },
    alignment: null,
    enabled_modules: {
      tires: true,
      suspension: true,
      alignment: false,
      geometry: true,
      drivetrain: false,
      aero: false,
      notes: true,
    },
    extra_modules: {
      geometry: { sag_front: '32mm', sag_rear: '30mm', fork_height: '5mm', rear_ride_height: '', notes: '' },
    },
    notes: 'Known-good baseline from the cool morning session.',
    created_at: '2026-08-10T09:00:00Z',
    updated_at: '2026-08-10T09:00:00Z',
    ...overrides,
  };
}

function render(value: VehicleBaseline): string {
  return renderToStaticMarkup(
    createElement(VehicleBaselineSetup, { baseline: value, vehicleType: 'motorcycle' }),
  );
}

describe('vehicle baseline setup', () => {
  it('renders the stored snapshot, not just the session it came from', () => {
    const value = baseline();
    const html = render(value);

    // Every stored value the rider set the baseline for.
    for (const stored of ['scrubbed', 'Pirelli', 'SC1', '30 psi', '28 psi', '32mm', '30mm', '5mm', value.notes!]) {
      expect(html).toContain(stored);
    }
    expect(html).toContain('Clicks out from closed');
    expect(html).toContain('Tires');
    expect(html).toContain('Suspension');
    expect(html).toContain('Geometry');
  });

  it('links the source session and says the snapshot does not follow it', () => {
    const html = render(baseline());

    expect(html).toContain('href="/sessions/session-1"');
    expect(html).toContain('Barber Motorsports Park · Aug 10, 2026 · Session 1');
    expect(html).toContain('Editing that session later does not change this snapshot.');
  });

  /**
   * `source_session_id` is `on delete set null`, so a rider who deletes the
   * session still has the baseline - and this is the case where the label alone
   * was worth nothing, because there was nowhere to follow it to.
   */
  it('still renders the setup when the source session is gone', () => {
    const html = render(baseline({ source_session_id: null }));

    expect(html).not.toContain('href="/sessions/');
    expect(html).toContain('30 psi');
    expect(html).toContain('Barber Motorsports Park · Aug 10, 2026 · Session 1');
  });

  it('says so when the baseline recorded no setup values', () => {
    const empty = baseline({
      tires: { condition: null, front: { brand: '', compound: '', pressure: '' }, rear: { brand: '', compound: '', pressure: '' } },
      suspension: {
        front: { preload: '', compression: '', rebound: '', direction: 'out' },
        rear: { preload: '', compression: '', rebound: '', direction: 'out' },
      },
      enabled_modules: {
        tires: false,
        suspension: false,
        alignment: false,
        geometry: false,
        drivetrain: false,
        aero: false,
        notes: true,
      },
      extra_modules: null,
      notes: null,
    });

    expect(render(empty)).toContain('That session recorded no setup values.');
  });

  /**
   * The renderer was lifted out of the session detail page so a baseline shows
   * the same rows a session does. If the two ever disagree, one of the screens
   * is lying about what a setup is.
   */
  it('builds the same rows a session detail page shows', () => {
    const value = baseline();
    const snapshot = baselineToComparableSession(value);
    const view = buildSetupView(snapshot, resolveSessionEnabledModules(snapshot, 'motorcycle'));

    expect(isSetupViewEmpty(view)).toBe(false);
    expect(view.groups.map((group) => group.title)).toEqual(['Tires', 'Suspension', 'Geometry']);
    expect(view.groups[1].rows.map((row) => row.label)).toEqual([
      'Direction',
      'Front Preload',
      'Front Compression',
      'Front Rebound',
      'Rear Preload',
      'Rear Compression',
      'Rear Rebound',
    ]);
    // Advanced modules print only the fields that carry a value.
    expect(view.groups[2].rows.map((row) => row.label)).toEqual(['Front Sag', 'Rear Sag', 'Fork Height']);
    expect(view.notes).toBe(value.notes);
  });

  /** Each end states its own count when the two disagree, or the numbers are ambiguous. */
  it('names both ends when they are counted differently', () => {
    const view = buildSetupView(
      baselineToComparableSession(
        baseline({
          suspension: {
            front: { preload: '4', compression: '12', rebound: '10', direction: 'in' },
            rear: { preload: '6', compression: '8', rebound: '9', direction: 'out' },
          },
        }),
      ),
      { tires: true, suspension: true, alignment: false, geometry: false, drivetrain: false, aero: false, notes: true },
    );

    expect(view.groups.find((group) => group.title === 'Suspension')?.rows.map((row) => row.label)).toEqual([
      'Front direction',
      'Front Preload',
      'Front Compression',
      'Front Rebound',
      'Rear direction',
      'Rear Preload',
      'Rear Compression',
      'Rear Rebound',
    ]);
  });
});

describe('garage card baseline gate', () => {
  const vehicle: Vehicle = {
    id: 'bike-1',
    user_id: 'user-1',
    nickname: 'R6',
    type: 'motorcycle',
    year: 2020,
    make: 'Yamaha',
    model: 'YZF-R6',
    photo_url: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  function card(baselineLocked: boolean): string {
    return renderToStaticMarkup(
      createElement(VehicleCard, { vehicle, baseline: baseline(), baselineLocked }),
    );
  }

  it('shows the stored snapshot to a rider the feature is unlocked for', () => {
    const html = card(false);

    expect(html).toContain('Baseline setup');
    expect(html).toContain('30 psi');
  });

  /**
   * The snapshot obeys the gate the summary beside it already uses. Two halves
   * of one card disagreeing about whether this rider may read the baseline is
   * incoherent, whichever way round it reads.
   */
  it('withholds it while the baseline feature is locked', () => {
    const html = card(true);

    expect(html).not.toContain('Baseline setup');
    expect(html).not.toContain('30 psi');
  });
});
