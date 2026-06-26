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
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Setup deltas</h2>
          <p className="mt-1 text-xs text-zinc-400">Changed fields are shown by default.</p>
        </div>
        <button
          type="button"
          className="min-h-11 rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs font-semibold text-zinc-300 hover:text-zinc-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
          onClick={() => setShowUnchanged((value) => !value)}
        >
          {showUnchanged ? 'Hide unchanged' : 'Show unchanged'}
        </button>
      </div>

      {groupedRows.length > 0 ? (
        <div className="space-y-4">
          {groupedRows.map(([group, groupRows]) => (
            <div key={group}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyan-300">{group}</h3>
              <ul className="space-y-2">
                {groupRows.map((row) => (
                  <li key={`${row.group}-${row.label}`} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="text-sm font-semibold text-zinc-100">{row.label}</p>
                      <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
                        {row.changed ? 'Changed' : 'Same'}
                      </span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-zinc-500">Baseline</p>
                        <p className="mt-0.5 break-words text-zinc-300">{row.baseline || '—'}</p>
                      </div>
                      <div>
                        <p className="text-xs text-zinc-500">Current</p>
                        <p className="mt-0.5 break-words text-zinc-100">{row.current || '—'}</p>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-zinc-400">No changed fields for this comparison.</p>
      )}
    </section>
  );
}
