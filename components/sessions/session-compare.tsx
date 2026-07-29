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
    <section className="rounded-card bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
            Compare with Previous Session
          </h2>
          <p className="mt-1 text-xs text-ink-dim">Compared against {previousDateLabel}</p>
        </div>
        <button
          type="button"
          className="rounded-plate bg-surface-3 px-2.5 py-1 text-xs text-ink-dim hover:text-ink"
          onClick={() => setShowUnchanged((v) => !v)}
        >
          {showUnchanged ? 'Hide unchanged' : 'Show unchanged'}
        </button>
      </div>

      {visibleRows.length === 0 ? (
        <p className="text-sm text-ink-dim">No changed fields against the previous session.</p>
      ) : (
        <ul className="space-y-2">
          {visibleRows.map((row) => (
            <li key={row.label} className="rounded-row bg-surface-3 p-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{row.label}</p>
              <div className="mt-1 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <p className="text-ink-faint">Previous</p>
                  <p className="text-ink-dim">{row.previous || '—'}</p>
                </div>
                <div>
                  <p className="text-ink-faint">Current</p>
                  <p className="text-ink">{row.current || '—'}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
