'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center bg-zinc-950 px-4 text-center text-zinc-100" style={{ fontFamily: 'ui-sans-serif, -apple-system, sans-serif' }}>
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-rose-800/50 bg-rose-950/40">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-7 w-7 text-rose-400" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h1 className="text-xl font-bold">Something went sideways</h1>
        <p className="mt-2 max-w-xs text-sm text-zinc-400">
          {error.message || 'An unexpected error occurred.'}
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={reset}
            className="rounded-xl bg-cyan-400 px-4 py-3 text-sm font-semibold text-zinc-950 transition hover:bg-cyan-300"
          >
            Try Again
          </button>
          <Link
            href="/"
            className="rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-sm font-semibold text-zinc-100 transition hover:bg-zinc-800"
          >
            Go Home
          </Link>
        </div>
      </body>
    </html>
  );
}
