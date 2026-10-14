import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ServiceBookScreen } from '@/components/service-book/service-book-screen';
import { ServiceBookSettings } from '@/components/service-book/service-book-settings';
import { ServiceBookSetup } from '@/components/service-book/service-book-setup';
import { ServiceEntryDetails } from '@/components/service-book/service-entry-details';
import { ServiceEntryForm } from '@/components/service-book/service-entry-form';
import { ServiceEntryHistory } from '@/components/service-book/service-entry-history';
import { VehicleReadingForm } from '@/components/service-book/vehicle-reading-form';
import { getDemoServiceBook, getDemoServiceEntryRevisions } from '@/lib/demo/service-book';

/**
 * What one render of the service-book screens can prove without a browser:
 *
 * - the entry form opens with nothing pressed for "Done by" and no date, because
 *   a default is not an answer (`lib/session-answers.ts`) and the rider's day is
 *   seeded after mount, where it is known;
 * - the demo book offers no save: no form, no "Log service", no settings link,
 *   no reading form (owner, 2026-10-04: the demo is a tour);
 * - every pressable thing is at least 44 px tall, and the screens use the design
 *   tokens rather than raw palette classes.
 *
 * `tests/e2e/service-book-entry.spec.ts` is the walk through a real save.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const demo = getDemoServiceBook('demo-r6')!;

describe('the entry form', () => {
  it('opens with no "Done by" pressed, no service date, and no item chosen', () => {
    const html = renderToStaticMarkup(
      createElement(ServiceEntryForm, { vehicleId: 'demo-r6', book: demo.data.book, fields: demo.data.fields, items: demo.data.items }),
    );
    expect(html).not.toContain('aria-pressed="true"');
    expect(html).toMatch(/aria-pressed="false"[^>]*>Myself</);
    expect(html).toMatch(/aria-pressed="false"[^>]*>A shop</);
    expect(html).toMatch(/<input[^>]*type="date"[^>]*value=""/);
    expect(html).toContain('Engine oil and filter');
  });

  it('asks only for the fields the book has switched on', () => {
    const fields = demo.data.fields.map((field) => (field.builtin_key === 'cost' ? { ...field, enabled: false } : field));
    const html = renderToStaticMarkup(
      createElement(ServiceEntryForm, { vehicleId: 'demo-r6', book: demo.data.book, fields, items: demo.data.items }),
    );
    expect(html).not.toContain('Cost ($)');
    expect(html).toContain('Done by');
  });

  it('reopens a stored entry with its answers pressed', () => {
    const entry = demo.data.entries.find((candidate) => candidate.performed_by === 'shop')!;
    const html = renderToStaticMarkup(
      createElement(ServiceEntryForm, { vehicleId: 'demo-r6', book: demo.data.book, fields: demo.data.fields, items: demo.data.items, entry }),
    );
    expect(html).toMatch(/aria-pressed="true"[^>]*>A shop</);
    expect(html).toMatch(/aria-pressed="true"[^>]*>Brake pads</);
    expect(html).toContain('Cresson Moto Works');
  });
});

describe('the book settings', () => {
  it('lock the distance unit, saying why, once the book holds distances', () => {
    const locked = settingsHtml(true);
    expect(locked).toMatch(/<select[^>]*disabled=""[^>]*>\s*<option value="mi"/);
    expect(locked).toContain('This book already holds distances in miles, so its unit stays miles.');
    const open = settingsHtml(false);
    expect(open).not.toMatch(/<select[^>]*disabled=""[^>]*>\s*<option value="mi"/);
    expect(open).not.toContain('already holds distances');
  });
});

describe('the demo book', () => {
  const demoHtml = renderToStaticMarkup(createElement(ServiceBookScreen, { data: demo.data, demoMode: true }));
  const realHtml = renderToStaticMarkup(createElement(ServiceBookScreen, { data: demo.data, demoMode: false }));

  it('offers no save while a real book offers every one', () => {
    expect(demoHtml).not.toContain('<form');
    expect(demoHtml).not.toContain('Log service');
    expect(demoHtml).not.toContain('Log a reading');
    expect(demoHtml).not.toContain('/book/settings');
    expect(realHtml).toContain('Log service');
    expect(realHtml).toContain('Log a reading');
    expect(realHtml).toContain('/book/settings');
  });

  it('still shows the entries and the schedule', () => {
    expect(demoHtml).toContain('Engine oil and filter');
    expect(demoHtml).toContain('Cresson Moto Works');
    expect(demoHtml).toContain('3 entries');
  });
});

describe('the service-book screens as rendered', () => {
  const entry = demo.data.entries[0];
  const withTyped = { ...entry, items: [...entry.items, { ...entry.items[0], id: 'typed', item_id: null, label: 'Throttle cable' }] };
  const renders: [string, string][] = [
    ['book', realHtml()],
    ['demo book', renderToStaticMarkup(createElement(ServiceBookScreen, { data: demo.data, demoMode: true }))],
    ['new entry', renderToStaticMarkup(createElement(ServiceEntryForm, { vehicleId: 'demo-r6', book: demo.data.book, fields: demo.data.fields, items: demo.data.items }))],
    [
      'edited entry',
      renderToStaticMarkup(
        createElement(ServiceEntryForm, { vehicleId: 'demo-r6', book: demo.data.book, fields: demo.data.fields, items: demo.data.items, entry: withTyped }),
      ),
    ],
    ['entry details', renderToStaticMarkup(createElement(ServiceEntryDetails, { entry, fields: demo.data.fields, distanceUnit: demo.data.book.distance_unit }))],
    [
      'entry history',
      renderToStaticMarkup(
        createElement(ServiceEntryHistory, {
          vehicleId: 'demo-r6',
          entry,
          revisions: getDemoServiceEntryRevisions(entry.id) ?? [],
          distanceUnit: demo.data.book.distance_unit,
          demoMode: false,
        }),
      ),
    ],
    ['settings', settingsHtml(false)],
    ['settings, unit locked', settingsHtml(true)],
    ['setup', renderToStaticMarkup(createElement(ServiceBookSetup, { vehicleId: 'demo-r6', nickname: 'R6', vehicleType: demo.data.vehicle.type }))],
    ['reading form', renderToStaticMarkup(createElement(VehicleReadingForm, { vehicleId: 'demo-r6', book: demo.data.book }))],
  ];

  it('use design tokens, never raw palette classes', () => {
    for (const [name, html] of renders) {
      for (const [, className] of html.matchAll(/class="([^"]*)"/g)) {
        expect(className, name).not.toMatch(/\b(?:zinc|cyan|amber|gray|slate|neutral|stone|red|green|blue|yellow|orange)-\d{2,3}\b/);
      }
    }
  });

  it('give every button a 44 px target', () => {
    let checked = 0;
    for (const [name, html] of renders) {
      for (const [tag] of html.matchAll(/<button\b[^>]*>/g)) {
        expect(tag, name).toMatch(/class="[^"]*(?:\bmin-h-1[1-4]\b|\bh-1[1-4]\b)[^"]*"/);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

function realHtml(): string {
  return renderToStaticMarkup(createElement(ServiceBookScreen, { data: demo.data, demoMode: false }));
}

function settingsHtml(unitLocked: boolean): string {
  const book = { ...demo.data.book, tracks_distance: true, distance_unit: 'mi' as const };
  return renderToStaticMarkup(
    createElement(ServiceBookSettings, { vehicleId: 'demo-r6', book, fields: demo.data.fields, items: demo.data.items, unitLocked }),
  );
}
