'use client';

import { useState, useEffect } from 'react';

const STORAGE_KEY = 'tracktuner_time_format';

function to12h(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

function to24h(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function TimeDisplay({ time }: { time: string | null }) {
  const [format, setFormat] = useState<'12h' | '24h'>('12h');

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === '12h' || saved === '24h') setFormat(saved);
  }, []);

  if (!time) {
    return <span className="text-sm font-medium text-zinc-100">—</span>;
  }

  function toggle(next: '12h' | '24h') {
    setFormat(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  const formatted = format === '12h' ? to12h(time) : to24h(time);

  return (
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-zinc-100">{formatted}</span>
      <div className="flex overflow-hidden rounded-md border border-zinc-700 text-xs">
        <button
          type="button"
          onClick={() => toggle('12h')}
          className={`px-2 py-0.5 font-medium transition ${format === '12h' ? 'bg-cyan-400 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
        >
          12h
        </button>
        <button
          type="button"
          onClick={() => toggle('24h')}
          className={`px-2 py-0.5 font-medium transition ${format === '24h' ? 'bg-cyan-400 text-zinc-950' : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200'}`}
        >
          24h
        </button>
      </div>
    </div>
  );
}
