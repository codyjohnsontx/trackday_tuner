'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  aggregateLaps,
  appendPastedLaps,
  appendQuickLap,
  formatLapTimeInput,
  type LapAppendResult,
  type LapEditorValue,
} from '@/lib/lap-times';
import type { CreateSessionLapInput } from '@/types';

interface LapTimeEditorProps {
  /**
   * The whole editor state, entry boxes included. Held by the caller so its save
   * handler can see text the rider typed but never pressed "Add" on - see
   * `commitLapEditorValue` in lib/lap-times.ts.
   */
  value: LapEditorValue;
  onChange: (value: LapEditorValue) => void;
}

export function LapTimeEditor({ value, onChange }: LapTimeEditorProps) {
  const { laps, pending } = value;
  const [message, setMessage] = useState('');
  const metrics = useMemo(() => aggregateLaps(laps), [laps]);

  function setLaps(next: CreateSessionLapInput[]) {
    onChange({ ...value, laps: next });
  }

  function setPending(next: Partial<LapEditorValue['pending']>) {
    onChange({ ...value, pending: { ...pending, ...next } });
  }

  /** Applies an append result, clearing whichever box it consumed. */
  function apply(result: LapAppendResult, cleared: Partial<LapEditorValue['pending']>) {
    if (result.error) {
      setMessage(result.error);
      return;
    }
    onChange({ laps: result.laps, pending: { ...pending, ...cleared } });
    setMessage('');
  }

  return (
    <section className="space-y-4 rounded-card bg-surface p-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Lap Times</h2>
        <p className="mt-1 text-sm text-ink-dim">
          Optional. Exclude warm-up, traffic, or cool-down laps from comparison metrics.
        </p>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-ink-dim">Quick add</span>
          <input
            value={pending.quick}
            onChange={(event) => setPending({ quick: event.target.value })}
            placeholder="1:42.350"
            inputMode="decimal"
            className="min-h-11 w-full rounded-row bg-surface-3 px-3 text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
          />
        </label>
        <Button
          type="button"
          variant="secondary"
          className="mt-5 min-h-11 px-3"
          disabled={!pending.quick.trim()}
          onClick={() => apply(appendQuickLap(laps, pending.quick), { quick: '' })}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden /> Add
        </Button>
      </div>

      <details className="group rounded-row bg-surface-3 p-3">
        <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-ink">
          Paste several laps
        </summary>
        <div className="mt-3 space-y-2">
          <textarea
            value={pending.paste}
            onChange={(event) => setPending({ paste: event.target.value })}
            rows={4}
            placeholder={'1:42.350\n1:41.920\nLap 3: 1:41.700'}
            className="w-full rounded-row bg-surface-3 px-3 py-3 font-mono text-sm text-ink placeholder:text-ink-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
          />
          <Button
            type="button"
            variant="secondary"
            fullWidth
            onClick={() => apply(appendPastedLaps(laps, pending.paste), { paste: '' })}
            disabled={!pending.paste.trim()}
          >
            Parse and add laps
          </Button>
        </div>
      </details>

      {message ? <p className="text-sm text-signal">{message}</p> : null}

      {laps.length > 0 ? (
        <>
          <div className="grid grid-cols-4 gap-2 border-y border-white/5 py-3 text-center">
            <div><p className="text-[10px] uppercase text-ink-faint">Count</p><p className="text-sm font-semibold">{metrics.lap_count}</p></div>
            <div><p className="text-[10px] uppercase text-ink-faint">Best</p><p className="text-sm font-semibold">{metrics.best_lap_ms ? formatLapTimeInput(metrics.best_lap_ms) : '—'}</p></div>
            <div><p className="text-[10px] uppercase text-ink-faint">Average</p><p className="text-sm font-semibold">{metrics.average_lap_ms ? formatLapTimeInput(metrics.average_lap_ms) : '—'}</p></div>
            <div><p className="text-[10px] uppercase text-ink-faint">Spread</p><p className="text-sm font-semibold">{metrics.consistency_spread_ms == null ? '—' : `${(metrics.consistency_spread_ms / 1000).toFixed(3)}s`}</p></div>
          </div>
          <ul className="divide-y divide-white/5">
            {laps.map((lap, index) => (
              // lap_number is unique by construction: appends take max+1 and
              // pasted laps are de-duplicated against the existing set. Mixing
              // the index back in would remount every row below a deletion.
              <li key={lap.lap_number} className="flex min-h-12 items-center gap-3 py-2">
                <span className="w-12 text-xs text-ink-faint">Lap {lap.lap_number}</span>
                <span className="flex-1 font-mono text-sm text-ink">{formatLapTimeInput(lap.lap_time_ms)}</span>
                <label className="flex min-h-11 items-center gap-2 text-xs text-ink-dim">
                  <input
                    type="checkbox"
                    checked={lap.included}
                    onChange={(event) => setLaps(laps.map((item, itemIndex) => itemIndex === index ? { ...item, included: event.target.checked } : item))}
                    className="h-5 w-5 accent-signal"
                  />
                  Count
                </label>
                <button
                  type="button"
                  aria-label={`Remove lap ${lap.lap_number}`}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-row text-ink-faint hover:bg-surface-3 hover:text-slower focus-visible:ring-2 focus-visible:ring-signal/80"
                  onClick={() => setLaps(laps.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-ink-faint">No structured laps added.</p>
      )}
    </section>
  );
}
