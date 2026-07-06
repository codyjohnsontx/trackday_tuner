import type { SessionChangeSet } from '@/lib/session-changes';
import type { SessionChangeEntry, SessionChangeReferenceKind, Tier } from '@/types';

interface SessionChangesPanelProps {
  changeSets: SessionChangeSet[];
  tier: Tier;
}

const referenceKindLabel: Record<SessionChangeReferenceKind, string> = {
  previous: 'Vs previous session',
  baseline: 'Vs baseline',
};

function groupEntries(entries: SessionChangeEntry[]): [string, SessionChangeEntry[]][] {
  const groups = new Map<string, SessionChangeEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.group) ?? [];
    group.push(entry);
    groups.set(entry.group, group);
  }
  return Array.from(groups.entries());
}

export function SessionChangesPanel({ changeSets, tier }: SessionChangesPanelProps) {
  if (tier !== 'pro') return null;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Setup Changes</h2>

      {changeSets.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-400">No reference setups yet.</p>
      ) : (
        <div className="mt-3 space-y-5">
          {changeSets.map((set) => (
            <div key={set.referenceKind}>
              <h3 className="text-sm font-semibold text-zinc-100">{referenceKindLabel[set.referenceKind]}</h3>
              <p className="mt-0.5 text-xs text-zinc-500">{set.referenceLabel}</p>

              {set.entries.length === 0 ? (
                <p className="mt-2 text-sm text-zinc-400">No setup changes.</p>
              ) : (
                <div className="mt-2 space-y-3">
                  {groupEntries(set.entries).map(([group, entries]) => (
                    <div key={group}>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-cyan-300">{group}</h4>
                      <ul className="space-y-2">
                        {entries.map((entry) => (
                          <li
                            key={`${group}-${entry.label}`}
                            className="rounded-xl border border-zinc-800 bg-zinc-950 p-3"
                          >
                            <p className="text-sm font-semibold text-zinc-100">{entry.label}</p>
                            <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <p className="text-xs text-zinc-500">From</p>
                                <p className="mt-0.5 break-words text-zinc-300">{entry.from || '—'}</p>
                              </div>
                              <div>
                                <p className="text-xs text-zinc-500">To</p>
                                <p className="mt-0.5 break-words text-zinc-100">{entry.to || '—'}</p>
                              </div>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
