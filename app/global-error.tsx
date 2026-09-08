'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { pageTitleClass } from '@/components/ui/page-header';

/**
 * The last boundary. Next renders this when the root layout itself throws,
 * which is the one class of client error no other boundary can catch - and the
 * one a rider experiences as a blank page, so it must not go unreported.
 *
 * `global-error` replaces the whole document, so it carries its own `<html>`
 * and `<body>` and cannot use the app shell. `app/globals.css` is still loaded,
 * so the tokens are.
 */
export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="bg-canvas text-ink">
        <main className="mx-auto flex min-h-dvh max-w-5xl flex-col items-center justify-center gap-4 px-6 text-center">
          <h1 className={pageTitleClass}>Something went wrong</h1>
          <p className="text-ink-dim">The page failed to load. Reloading usually clears it.</p>
          <Button type="button" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </main>
      </body>
    </html>
  );
}
