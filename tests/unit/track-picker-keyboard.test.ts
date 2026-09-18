import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Track, Vehicle } from '@/types';

// The Track picker on the New Session form was mouse-only. Reproduced against a
// real account with two saved circuits: the input carried no `role`, no
// `aria-expanded`, no `aria-controls` and no `aria-activedescendant`; the
// suggestion list was a bare `<ul>` of focusable `<button>`s bound to
// `onMouseDown`; ArrowDown and Enter did nothing at all; and Tab out of the
// input left `document.activeElement` on `<body>`, because tabbing reached the
// first button and the input's blur handler then unmounted the list from under
// it. Track is a required field, so a keyboard or screen reader rider could
// reach the saved row the mouse rider picks by nothing they typed.
//
// The suite is node-only and has no DOM, so the keyboard walk itself lives in
// tests/e2e/session-track-keyboard.spec.ts. What is structural is guarded here,
// and it is the half that decides whether the keys can work at all: the ARIA
// wiring the browser needs to announce the list, and the absence of the
// focusable button that broke Tab.

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock('@/lib/actions/sessions', () => ({ createSession: vi.fn() }));
vi.mock('@/lib/product-events.client', () => ({ trackProductEvent: vi.fn() }));

const { SessionForm } = await import('@/components/sessions/session-form');

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

function track(id: string, name: string): Track {
  return {
    id,
    name,
    location: null,
    is_seeded: true,
    created_by: null,
    created_at: new Date(0).toISOString(),
  } as unknown as Track;
}

const tracks = [track('track-1', 'Circuit of the Americas'), track('track-2', 'Barber Motorsports Park')];

function renderForm(): string {
  return renderToStaticMarkup(createElement(SessionForm, { vehicles: [vehicle], tracks }));
}

/** The attributes on the Track input, read off the rendered tag. */
function trackInputAttributes(html: string): Record<string, string> {
  const tag = html.match(/<input id="session-track"[^>]*>/)?.[0];
  if (!tag) throw new Error('the Track input did not render');

  const attributes: Record<string, string> = {};
  for (const match of tag.matchAll(/([a-zA-Z-]+)(?:="([^"]*)")?/g)) {
    attributes[match[1]] = match[2] ?? '';
  }
  return attributes;
}

describe('the Track picker as a combobox', () => {
  it('marks the input a combobox pointing at the suggestion list', () => {
    const html = renderForm();
    const attributes = trackInputAttributes(html);

    expect(attributes.role).toBe('combobox');
    expect(attributes['aria-autocomplete']).toBe('list');
    expect(attributes['aria-controls']).toBe('session-track-listbox');
    // Track is required, so the browser refuses an empty one the way it already
    // does for Vehicle and Date. See lib/session-track.ts.
    expect(attributes).toHaveProperty('required');
  });

  it('renders the listbox `aria-controls` names, even while it is closed', () => {
    const html = renderForm();

    // A reference that resolves to nothing is a reference a screen reader
    // announces as nothing, so the list is in the document whether or not it is
    // showing - `hidden` is what closes it.
    const list = html.match(/<ul[^>]*id="session-track-listbox"[^>]*>/)?.[0];
    expect(list).toBeTruthy();
    expect(list).toContain('role="listbox"');
    expect(list).toContain('aria-label="Saved tracks"');
    expect(list).toContain('hidden');
  });

  it('gives every saved track an option row the active descendant can name', () => {
    const html = renderForm();
    const options = [...html.matchAll(/<li id="session-track-option-(\d+)"[^>]*role="option"[^>]*>/g)];

    expect(options.map((match) => match[1])).toEqual(['0', '1']);
  });

  it('puts no focusable control inside the list', () => {
    const html = renderForm();
    const list = html.match(/<ul[^>]*id="session-track-listbox"[\s\S]*?<\/ul>/)?.[0];

    // Asserted present first: a list that rendered nothing would satisfy every
    // "does not contain" below while being the very markup this replaced.
    expect(list).toBeTruthy();
    // The whole reason Tab used to land on <body>: a focusable button in a list
    // the input's blur handler removes. Focus has to stay in the input.
    expect(list).not.toContain('<button');
    expect(list).not.toContain('tabindex');
  });
});
