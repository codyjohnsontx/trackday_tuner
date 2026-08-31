import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  getFreePlanLimit,
  getFreePlanLimitMessage,
  getFreePlanLimitTitle,
  isAtFreePlanLimit,
  type LimitedResource,
} from '@/lib/plans';
import type { Track, Vehicle } from '@/types';

// A free rider already at their limit could open the whole New Session screen -
// 21 fields, 3,180px on an iPhone viewport - fill it in, and only learn the save
// was impossible from the error `createSession` returned. That error then
// rendered in document flow, 2,463px below the fold, while the sticky Save
// button they had just tapped was on screen: they tapped Save and nothing
// changed. Reproduced against a free account seeded to 12/10 sessions.
//
// Three rules come out of it. The first two are structural and guarded here; the
// third - that the refusal is on screen wherever the rider is - is a rendered
// position, so it lives in tests/e2e/plan-limit-gate.spec.ts.
//
//   1. One helper decides "at the limit", so a hidden create button, a gated
//      route and a refused save cannot disagree about the number.
//   2. The Save bar clears the floating nav pill at every width. `sm:bottom-4`
//      used to move it under the nav from 640px up, where a click at the middle
//      of "Save Session" hit a nav icon instead of the button.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/actions/sessions', () => ({ createSession: vi.fn() }));
vi.mock('@/lib/product-events.client', () => ({ trackProductEvent: vi.fn() }));

const { SessionForm } = await import('@/components/sessions/session-form');
const { PlanLimitNotice } = await import('@/components/billing/plan-limit-notice');

const RESOURCES: LimitedResource[] = ['vehicles', 'tracks', 'sessions'];

const vehicle = {
  id: 'vehicle-1',
  user_id: 'user-1',
  nickname: 'R6 Track Bike',
  type: 'motorcycle',
  make: 'Yamaha',
  model: 'R6',
  year: 2015,
  photo_url: null,
  created_at: new Date(0).toISOString(),
  updated_at: new Date(0).toISOString(),
} as unknown as Vehicle;

const tracks: Track[] = [];

describe('the free-plan limit', () => {
  it('is reached exactly at the number the limit table names', () => {
    for (const resource of RESOURCES) {
      const limit = getFreePlanLimit(resource);

      expect(isAtFreePlanLimit(resource, limit - 1, false)).toBe(false);
      expect(isAtFreePlanLimit(resource, limit, false)).toBe(true);
      // A count past the limit is still at it - a rider can arrive there through
      // an expired Pro subscription rather than by saving one row too many.
      expect(isAtFreePlanLimit(resource, limit + 5, false)).toBe(true);
    }
  });

  it('never stops a Pro rider', () => {
    for (const resource of RESOURCES) {
      expect(isAtFreePlanLimit(resource, getFreePlanLimit(resource) + 100, true)).toBe(false);
    }
  });

  it('titles the limit with the same resource the message names', () => {
    for (const resource of RESOURCES) {
      const title = getFreePlanLimitTitle(resource);
      const noun = resource.slice(0, -1);

      expect(title.toLowerCase()).toContain(noun);
      expect(title).toMatch(/limit reached$/);
      expect(getFreePlanLimitMessage(resource).toLowerCase()).toContain(noun);
    }
  });
});

describe('the notice that stands in for a create form', () => {
  it('names the limit, what it costs and a way out', () => {
    const html = renderToStaticMarkup(
      createElement(PlanLimitNotice, {
        resource: 'sessions',
        backHref: '/sessions',
        backLabel: 'Back to Sessions',
        hint: 'Everything you have already logged stays readable.',
      }),
    );

    expect(html).toContain(getFreePlanLimitTitle('sessions'));
    expect(html).toContain(getFreePlanLimitMessage('sessions'));
    expect(html).toContain('Everything you have already logged stays readable.');
    expect(html).toContain('href="/sessions"');
    // The rider gets the paid way out as well as the way back.
    expect(html).toContain('Upgrade to Pro');
  });
});

describe('the session form Save bar', () => {
  it('keeps one offset that clears the floating nav at every width', () => {
    const html = renderToStaticMarkup(createElement(SessionForm, { vehicles: [vehicle], tracks }));
    const bar = html.match(/<div class="([^"]*sticky[^"]*)"/)?.[1];

    expect(bar).toBeTruthy();
    expect(bar).toContain('bottom-20');
    // The nav pill renders at every width, so there is no wider layout in which
    // a smaller offset is safe.
    expect(bar).not.toMatch(/\b(sm|md|lg|xl):bottom-/);
  });
});
