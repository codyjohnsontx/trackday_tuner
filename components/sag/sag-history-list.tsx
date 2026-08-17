'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { roundForDisplay, summarizeSagEntry } from '@/lib/sag';
import { cn } from '@/lib/utils';
import type { SagEntry } from '@/types';

interface SagHistoryListProps {
  entries: SagEntry[];
  selectedId: string | null;
  /**
   * True when the form holds measurements that are not in the selected entry.
   * Loading over them destroys them, so the list asks first.
   */
  hasUnsavedWork: boolean;
  onSelect: (entry: SagEntry) => void;
  onDelete: (entry: SagEntry) => void;
  deletingId: string | null;
  errorMessage: string;
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

/**
 * The measurements themselves, so two entries can be told apart without opening
 * them. Rendered with spans because it sits inside the row's own button, which
 * only admits phrasing content.
 */
function EntryReadout({ entry }: { entry: SagEntry }) {
  const axles = summarizeSagEntry(entry);

  if (axles.length === 0) {
    return <span className="mt-1 block text-xs text-ink-faint">No measurements recorded.</span>;
  }

  return (
    <span className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
      {axles.map((axle) => (
        <span key={axle.axle} className="block min-w-0">
          <span className="block text-[10px] font-semibold uppercase tracking-wider text-ink-faint">
            {axle.axle}
          </span>
          <span className="block text-xs text-ink-dim">
            free <span className="font-medium text-ink">{roundForDisplay(axle.freeSagMm)}</span> · rider{' '}
            <span className="font-medium text-ink">{roundForDisplay(axle.riderSagMm)}</span> mm
          </span>
        </span>
      ))}
    </span>
  );
}

export function SagHistoryList({
  entries,
  selectedId,
  hasUnsavedWork,
  onSelect,
  onDelete,
  deletingId,
  errorMessage,
}: SagHistoryListProps) {
  // The entry a rider asked to load while the form still held unsaved work.
  const [pendingLoad, setPendingLoad] = useState<SagEntry | null>(null);

  function handleSelect(entry: SagEntry) {
    // Reloading the entry already selected discards edits just as thoroughly as
    // loading a different one, so both ask.
    if (hasUnsavedWork) {
      setPendingLoad(entry);
      return;
    }
    onSelect(entry);
  }

  return (
    <section className="space-y-3 rounded-card bg-surface p-4">
      <h2 className="text-base font-semibold text-ink">History</h2>

      {errorMessage ? <p className="text-sm text-slower">{errorMessage}</p> : null}

      {entries.length === 0 ? (
        <p className="text-sm text-ink-faint">No sag entries saved yet.</p>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.id}
              className={cn(
                'rounded-row p-3',
                selectedId === entry.id ? 'bg-surface-3 ring-1 ring-signal/30' : 'bg-surface-2',
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  className="min-h-11 flex-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
                  onClick={() => handleSelect(entry)}
                >
                  <span className="block text-sm font-semibold text-ink">
                    {entry.label?.trim() || 'Untitled Entry'}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-faint">
                    {formatDate(entry.created_at)}
                  </span>
                  <EntryReadout entry={entry} />
                </button>
                <Button
                  type="button"
                  variant="destructive"
                  className="min-h-11 px-3 text-xs"
                  holdToConfirm
                  holdingLabel="Hold…"
                  onConfirm={() => onDelete(entry)}
                  loading={deletingId === entry.id}
                  disabled={deletingId !== null}
                >
                  Hold to delete
                </Button>
              </div>

              {pendingLoad?.id === entry.id ? (
                <div className="mt-3 space-y-2 rounded-plate bg-surface-3 p-3">
                  <p className="text-xs text-ink-dim">
                    Loading this entry replaces the measurements on screen, which are not saved yet.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      className="min-h-11 text-xs"
                      onClick={() => setPendingLoad(null)}
                    >
                      Keep editing
                    </Button>
                    <Button
                      type="button"
                      className="min-h-11 text-xs"
                      onClick={() => {
                        setPendingLoad(null);
                        onSelect(entry);
                      }}
                    >
                      Load anyway
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
