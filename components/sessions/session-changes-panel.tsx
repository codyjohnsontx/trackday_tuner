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
    <section className="rounded-card bg-surface p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Setup Changes</h2>

      {changeSets.length === 0 ? (
        <p className="mt-2 text-sm text-ink-dim">No reference setups yet.</p>
      ) : (
        <div className="mt-3 space-y-5">
          {changeSets.map((set) => (
            <div key={set.referenceKind}>
              <h3 className="text-sm font-semibold text-ink">{referenceKindLabel[set.referenceKind]}</h3>
              <p className="mt-0.5 text-xs text-ink-faint">{set.referenceLabel}</p>

              {set.entries.length === 0 ? (
                <p className="mt-2 text-sm text-ink-dim">No setup changes.</p>
              ) : (
                <div className="mt-2 space-y-3">
                  {groupEntries(set.entries).map(([group, entries]) => (
                    <div key={group}>
                      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">{group}</h4>
                      <ul className="space-y-2">
                        {entries.map((entry) => (
                          <li
                            key={`${group}-${entry.label}`}
                            className="rounded-row bg-surface-3 p-3"
                          >
                            <p className="text-sm font-semibold text-ink">{entry.label}</p>
                            <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                              <div>
                                <p className="text-xs text-ink-faint">From</p>
                                <p className="mt-0.5 break-words text-ink-dim">{entry.from || '—'}</p>
                              </div>
                              <div>
                                <p className="text-xs text-ink-faint">To</p>
                                <p className="mt-0.5 break-words text-ink">{entry.to || '—'}</p>
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
