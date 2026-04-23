'use client';

import { useEffect, useState } from 'react';
import { readTimeFormat, writeTimeFormat, type TimeFormat } from '@/lib/time-format';

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
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Time display</h2>
      <p className="mt-2 text-sm text-zinc-400">
        How session start times and other clock times appear across the app.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium text-zinc-200">Format</span>
        <div className="flex overflow-hidden rounded-md border border-zinc-700 text-xs">
          <button
            type="button"
            onClick={() => set('12h')}
            className={`px-3 py-1.5 font-medium transition ${
              format === '12h' ? 'bg-cyan-400 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            12-hour
          </button>
          <button
            type="button"
            onClick={() => set('24h')}
            className={`px-3 py-1.5 font-medium transition ${
              format === '24h' ? 'bg-cyan-400 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'
            }`}
          >
            24-hour
          </button>
        </div>
      </div>
    </div>
  );
}
