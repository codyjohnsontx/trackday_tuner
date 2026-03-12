'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function AppError({
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
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-rose-800/50 bg-rose-950/40">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-7 w-7 text-rose-400" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-zinc-100">Something went wrong</h2>
      <p className="mt-2 max-w-xs text-sm text-zinc-400">
        {error.message || 'An unexpected error occurred. Please try again.'}
      </p>
      <div className="mt-6 flex gap-3">
        <Button variant="primary" onClick={reset}>
          Try Again
        </Button>
        <Link href="/dashboard">
          <Button variant="secondary">Go to Pit Board</Button>
        </Link>
      </div>
    </div>
  );
}
