'use client';

import { useEffect, useState } from 'react';
import { readTimeFormat, writeTimeFormat, type TimeFormat } from '@/lib/time-format';
import { cn } from '@/lib/utils';

export function TimeFormatSettings() {
  const [format, setFormat] = useState<TimeFormat>('12h');

  useEffect(() => {
    setFormat(readTimeFormat());
  }, []);

  function set(next: TimeFormat) {
    setFormat(next);
    writeTimeFormat(next);
  }

  return (
    <div className="rounded-card bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Time display</h2>
      <p className="mt-2 text-sm text-ink-dim">
        How session start times and other clock times appear across the app.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink">Format</span>
        <div role="group" aria-label="Time format" className="flex gap-1 rounded-full bg-surface-2 p-1 text-xs">
          <button
            type="button"
            aria-pressed={format === '12h'}
            onClick={() => set('12h')}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full px-4 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80',
              format === '12h' ? 'bg-ink text-canvas' : 'text-ink-dim hover:text-ink',
            )}
          >
            12-hour
          </button>
          <button
            type="button"
            aria-pressed={format === '24h'}
            onClick={() => set('24h')}
            className={cn(
              'inline-flex min-h-11 items-center rounded-full px-4 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80',
              format === '24h' ? 'bg-ink text-canvas' : 'text-ink-dim hover:text-ink',
            )}
          >
            24-hour
          </button>
        </div>
      </div>
    </div>
  );
}
