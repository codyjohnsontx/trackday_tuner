import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ServiceBookScreen } from '@/components/service-book/service-book-screen';
import { ServiceEntryForm } from '@/components/service-book/service-entry-form';
import { getDemoServiceBook } from '@/lib/demo/service-book';

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

describe('the demo book', () => {
  const demoHtml = renderToStaticMarkup(createElement(ServiceBookScreen, { data: demo.data, demoMode: true, showingRemoved: false }));
  const realHtml = renderToStaticMarkup(createElement(ServiceBookScreen, { data: demo.data, demoMode: false, showingRemoved: false }));

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

const COMPONENTS = path.resolve(__dirname, '../../components/service-book');
const sources = readdirSync(COMPONENTS).map((name) => [name, readFileSync(path.join(COMPONENTS, name), 'utf8')] as const);

describe('the service-book components', () => {
  it('use design tokens, never raw palette classes', () => {
    for (const [name, source] of sources) {
      expect(source, name).not.toMatch(/\b(?:zinc|cyan|amber|gray|slate|neutral|stone|red|green|blue|yellow|orange)-\d{2,3}\b/);
    }
  });

  it('give every button a 44 px target', () => {
    for (const [name, source] of sources) {
      // Every `<button` in these files carries a className; the lazy match reads
      // the nearest one, which is the tag's own since nothing nests inside an
      // opening tag.
      const opened = source.match(/<button\b/g)?.length ?? 0;
      const buttons = [...source.matchAll(/<button\b[\s\S]*?className=(?:"([^"]*)"|\{cn\(\s*'([^']*)')/g)];
      expect(buttons.length, `${name}: every button names its classes`).toBe(opened);
      for (const match of buttons) {
        const className = match[1] ?? match[2] ?? '';
        expect(className, `${name}: ${match[0].slice(0, 80)}`).toMatch(/min-h-1[1-4]\b|\bh-1[1-4]\b/);
      }
    }
  });
});
