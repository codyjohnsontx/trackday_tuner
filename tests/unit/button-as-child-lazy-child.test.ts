import { createElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { Button } from '@/components/ui/button';

// A Server Component that passes `<a>` or `<Link>` into `<Button asChild>`
// does not hand the client an element. Under `next dev` the RSC payload carries
// that child as a lazy reference, and the landing hero's two calls to action -
// "Join the Founding Beta" and "Explore the demo" - rendered on the server and
// were gone the moment React hydrated, with a hydration error in the console.
// Every `Button asChild` on a server page did the same.
//
// Radix `Slot` unwraps a lazy child only when it is the Slot's own child. The
// asChild branch wrapped `children` in a `Slottable` to make room for the
// loading spinner, and `Slottable`'s child is never unwrapped, so Radix read
// the lazy reference as "not an element" and rendered nothing.
//
// The suite has no RSC client, so this builds the lazy element by hand in the
// shape React resolves synchronously: a thenable already marked fulfilled.

function lazyElement(element: ReactElement): ReactNode {
  const payload = {
    status: 'fulfilled',
    value: element,
    then(resolve: (value: ReactElement) => void) {
      resolve(element);
    },
  };
  return {
    $$typeof: Symbol.for('react.lazy'),
    _payload: payload,
    _init: (p: typeof payload) => p.value,
  } as unknown as ReactNode;
}

describe('Button asChild', () => {
  it('renders a child a Server Component passed as a lazy reference', () => {
    const html = renderToStaticMarkup(
      createElement(
        Button,
        { asChild: true, variant: 'secondary' },
        lazyElement(createElement('a', { href: '/demo' }, 'Explore the demo')),
      ),
    );

    expect(html).toContain('href="/demo"');
    expect(html).toContain('Explore the demo');
    expect(html).toContain('bg-surface-3');
  });

  it('still renders an ordinary element child', () => {
    const html = renderToStaticMarkup(
      createElement(Button, { asChild: true }, createElement('a', { href: '#beta' }, 'Join the Founding Beta')),
    );

    expect(html).toMatch(/^<a [^>]*href="#beta"/);
    expect(html).toContain('Join the Founding Beta');
  });

  it('keeps the spinner ahead of the label while loading', () => {
    const html = renderToStaticMarkup(
      createElement(Button, { asChild: true, loading: true }, createElement('a', { href: '/x' }, 'Saving')),
    );

    expect(html).toMatch(/^<a [^>]*aria-busy="true"[^>]*><svg[^>]*animate-spin[\s\S]*<\/svg>Saving<\/a>$/);
  });
});
