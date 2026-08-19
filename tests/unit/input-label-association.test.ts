import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Input } from '@/components/ui/input';

// `Input` once derived its id from the label text, so two fields asking the same
// question collided. The Sag calculator does exactly that: Front and Rear each
// ask for "Fully Extended (L0)", "Bike Only (L1)" and "Rider On Bike (L2)", so
// the page shipped three duplicated ids. `for` resolves to the first match in
// the document, which made tapping a Rear label focus the Front field - on a
// phone at the track, where the label is the biggest tap target next to the
// input, that silently steers rear measurements into the front box. The same
// collision left the Rear inputs with no accessible name at all.
//
// The suite is node-only and has no DOM renderer, so this renders to static
// markup and reads the attributes back. That is enough for the invariant, which
// is structural: distinct ids, and every label pointing at the input it wraps.

interface RenderedField {
  labelFor: string;
  inputId: string;
}

function renderFields(...labels: string[]): RenderedField[] {
  const html = renderToStaticMarkup(
    createElement(
      'form',
      null,
      labels.map((label, index) => createElement(Input, { key: index, label })),
    ),
  );

  return [...html.matchAll(/<label for="([^"]*)"[\s\S]*?<input id="([^"]*)"/g)].map((match) => ({
    labelFor: match[1],
    inputId: match[2],
  }));
}

describe('Input label association', () => {
  it('gives two fields sharing a label distinct ids', () => {
    const fields = renderFields('Fully Extended (L0)', 'Fully Extended (L0)');

    expect(fields).toHaveLength(2);
    expect(fields[0].inputId).not.toBe(fields[1].inputId);
  });

  it('points each label at the input it wraps', () => {
    const fields = renderFields('Fully Extended (L0)', 'Fully Extended (L0)');

    for (const field of fields) {
      expect(field.labelFor).toBe(field.inputId);
    }
  });

  it('still honours an explicitly supplied id', () => {
    const html = renderToStaticMarkup(createElement(Input, { label: 'Email', id: 'email' }));

    expect(html).toContain('<label for="email"');
    expect(html).toContain('<input id="email"');
  });

  it('keeps helper text out of the field\'s accessible name', () => {
    const html = renderToStaticMarkup(
      createElement(Input, {
        label: 'Total Travel (optional)',
        helperText: 'Needed to show sag as a percentage.',
      }),
    );

    const inputId = /<input id="([^"]*)"/.exec(html)?.[1];
    expect(/<label [^>]*>([\s\S]*?)<\/label>/.exec(html)?.[1]).toBe('Total Travel (optional)');
    expect(html).toContain(`aria-describedby="${inputId}-helper"`);
    expect(html).toContain('Needed to show sag as a percentage.');
  });

  it('keeps error text out of the field\'s accessible name', () => {
    const html = renderToStaticMarkup(
      createElement(Input, { label: 'Front Pressure', error: 'Enter a number' }),
    );

    expect(/<label [^>]*>([\s\S]*?)<\/label>/.exec(html)?.[1]).toBe('Front Pressure');
    expect(html).toContain('Enter a number');
  });

  it('keeps error and helper text wired to the field describing them', () => {
    const html = renderToStaticMarkup(
      createElement(Input, { label: 'Front Pressure', error: 'Enter a number' }),
    );

    const inputId = /<input id="([^"]*)"/.exec(html)?.[1];
    expect(inputId).toBeTruthy();
    expect(html).toContain(`aria-describedby="${inputId}-error"`);
    expect(html).toContain(`<p id="${inputId}-error"`);
  });
});
