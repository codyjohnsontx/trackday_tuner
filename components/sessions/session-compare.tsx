'use client';

import { useMemo, useState } from 'react';

export interface CompareRow {
  label: string;
  current: string;
  previous: string;
}

interface SessionCompareProps {
  rows: CompareRow[];
  previousDateLabel: string;
}

export function SessionCompare({ rows, previousDateLabel }: SessionCompareProps) {
  const [showUnchanged, setShowUnchanged] = useState(false);

  const computedRows = useMemo(
    () =>
      rows.map((row) => ({
        ...row,
        changed: row.current !== row.previous,
      })),
    [rows]
  );

  const visibleRows = showUnchanged
    ? computedRows
    : computedRows.filter((row) => row.changed);

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Compare with Previous Session
          </h2>
          <p className="mt-1 text-xs text-zinc-400">Compared against {previousDateLabel}</p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-zinc-700 bg-zinc-950 px-2.5 py-1 text-xs text-zinc-300 hover:text-zinc-100"
          onClick={() => setShowUnchanged((v) => !v)}
        >
          {showUnchanged ? 'Hide unchanged' : 'Show unchanged'}
        </button>
      </div>

      {visibleRows.length === 0 ? (
        <p className="text-sm text-zinc-400">No changed fields against the previous session.</p>
      ) : (
        <ul className="space-y-2">
          {visibleRows.map((row) => (
            <li key={row.label} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{row.label}</p>
              <div className="mt-1 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-zinc-500">Previous</p>
                  <p className="text-zinc-300">{row.previous || '—'}</p>
                </div>
                <div>
                  <p className="text-zinc-500">Current</p>
                  <p className="text-zinc-100">{row.current || '—'}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
