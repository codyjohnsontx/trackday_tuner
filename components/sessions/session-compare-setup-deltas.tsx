'use client';

import { useMemo, useState } from 'react';
import type { SetupCompareRow } from '@/lib/session-compare';

interface SessionCompareSetupDeltasProps {
  rows: SetupCompareRow[];
}

export function SessionCompareSetupDeltas({ rows }: SessionCompareSetupDeltasProps) {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const visibleRows = showUnchanged ? rows : rows.filter((row) => row.changed);
  const groupedRows = useMemo(() => {
    const groups = new Map<string, SetupCompareRow[]>();
    for (const row of visibleRows) {
      const group = groups.get(row.group) ?? [];
      group.push(row);
      groups.set(row.group, group);
    }
    return Array.from(groups.entries());
  }, [visibleRows]);

  return (
    <section className="rounded-card bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Setup deltas</h2>
          <p className="mt-1 text-xs text-ink-dim">Changed fields are shown by default.</p>
        </div>
        <button
          type="button"
          className="min-h-11 rounded-row bg-surface-3 px-3 py-2 text-xs font-semibold text-ink-dim hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
          onClick={() => setShowUnchanged((value) => !value)}
        >
          {showUnchanged ? 'Hide unchanged' : 'Show unchanged'}
        </button>
      </div>

      {groupedRows.length > 0 ? (
        <div className="space-y-4">
          {groupedRows.map(([group, groupRows]) => (
            <div key={group}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">{group}</h3>
              <ul className="space-y-2">
                {groupRows.map((row) => (
                  <li key={`${row.group}-${row.label}`} className="rounded-row bg-surface-3 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-ink">{row.label}</p>
                      <span className="rounded-full border border-white/10 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
                        {row.changed ? 'Changed' : 'Same'}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-ink-faint">Baseline</p>
                        <p className="mt-0.5 break-words text-ink-dim">{row.baseline || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-ink-faint">Current</p>
                        <p className="mt-0.5 break-words text-ink">{row.current || '—'}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-ink-dim">No changed fields for this comparison.</p>
      )}
    </section>
  );
}
