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
    <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-base font-semibold text-zinc-100">History</h2>

      {entries.length === 0 ? (
        <p className="text-sm text-zinc-500">No sag entries saved yet.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                  selectedId === entry.id
                    ? 'border-cyan-400 bg-zinc-950'
                    : 'border-zinc-800 bg-zinc-950 hover:border-zinc-600'
                }`}
                onClick={() => onSelect(entry)}
              >
                <p className="text-sm font-semibold text-zinc-100">{entry.label?.trim() || 'Untitled Entry'}</p>
                <p className="mt-0.5 text-xs text-zinc-500">{formatDate(entry.created_at)}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
