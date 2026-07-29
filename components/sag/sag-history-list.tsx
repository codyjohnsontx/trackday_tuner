import { cn } from '@/lib/utils';
import type { SagEntry } from '@/types';

interface SagHistoryListProps {
  entries: SagEntry[];
  selectedId: string | null;
  onSelect: (entry: SagEntry) => void;
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function SagHistoryList({ entries, selectedId, onSelect }: SagHistoryListProps) {
  return (
    <section className="space-y-3 rounded-card bg-surface p-4">
      <h2 className="text-base font-semibold text-ink">History</h2>

      {entries.length === 0 ? (
        <p className="text-sm text-ink-faint">No sag entries saved yet.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={cn(
                  'w-full rounded-row px-3 py-3 text-left transition',
                  selectedId === entry.id
                    ? 'bg-surface-3 ring-1 ring-signal/30'
                    : 'bg-surface-2 hover:bg-surface-3',
                )}
                onClick={() => onSelect(entry)}
              >
                <p className="text-sm font-semibold text-ink">{entry.label?.trim() || 'Untitled Entry'}</p>
                <p className="mt-0.5 text-xs text-ink-faint">{formatDate(entry.created_at)}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
