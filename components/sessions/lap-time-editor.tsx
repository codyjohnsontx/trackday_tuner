'use client';

import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { aggregateLaps, formatLapTimeInput, parseLapList, parseLapTime, validateLaps } from '@/lib/lap-times';
import type { CreateSessionLapInput } from '@/types';

interface LapTimeEditorProps {
  value: CreateSessionLapInput[];
  onChange: (laps: CreateSessionLapInput[]) => void;
  onValidationChange?: (message: string) => void;
}

export function LapTimeEditor({ value, onChange, onValidationChange }: LapTimeEditorProps) {
  const [quickValue, setQuickValue] = useState('');
  const [pasteValue, setPasteValue] = useState('');
  const [message, setMessage] = useState('');
  const metrics = useMemo(() => aggregateLaps(value), [value]);

  function report(next: string) {
    setMessage(next);
    onValidationChange?.(next);
  }

  function addQuickLap() {
    const lapTimeMs = parseLapTime(quickValue);
    if (lapTimeMs === null) {
      report('Use M:SS.mmm or total seconds, between 10 seconds and 20 minutes.');
      return;
    }
    const nextNumber = value.reduce((max, lap) => Math.max(max, lap.lap_number), 0) + 1;
    onChange([...value, { lap_number: nextNumber, lap_time_ms: lapTimeMs, included: true }]);
    setQuickValue('');
    report('');
  }

  function addPastedLaps() {
    const parsed = parseLapList(pasteValue);
    const errors = parsed.flatMap((line) => (line.error ? [line.error] : []));
    if (errors.length > 0) {
      report(errors.join(' '));
      return;
    }
    const existingNumbers = new Set(value.map((lap) => lap.lap_number));
    let nextNumber = value.reduce((max, lap) => Math.max(max, lap.lap_number), 0) + 1;
    const valid = parsed.flatMap((line) => {
      if (!line.lap) return [];
      let lapNumber = line.lap.lap_number;
      while (existingNumbers.has(lapNumber)) lapNumber = nextNumber++;
      existingNumbers.add(lapNumber);
      return [{ ...line.lap, lap_number: lapNumber }];
    });
    const candidate = [...value, ...valid].sort((a, b) => a.lap_number - b.lap_number);
    const validationError = validateLaps(candidate);
    if (validationError) {
      report(validationError);
      return;
    }
    onChange(candidate);
    setPasteValue('');
    report('');
  }

  return (
    <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div>
        <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Lap Times</h2>
        <p className="mt-1 text-sm text-zinc-400">
          Optional. Exclude warm-up, traffic, or cool-down laps from comparison metrics.
        </p>
      </div>

      <div className="grid grid-cols-[1fr_auto] gap-2">
        <label className="space-y-1">
          <span className="text-xs font-medium text-zinc-400">Quick add</span>
          <input
            value={quickValue}
            onChange={(event) => setQuickValue(event.target.value)}
            placeholder="1:42.350"
            inputMode="decimal"
            className="min-h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
          />
        </label>
        <Button type="button" variant="secondary" className="mt-5 min-h-11 px-3" onClick={addQuickLap}>
          <Plus className="mr-1 h-4 w-4" aria-hidden /> Add
        </Button>
      </div>

      <details className="group rounded-xl border border-zinc-800 bg-zinc-950/50 p-3">
        <summary className="cursor-pointer text-sm font-medium text-zinc-200">Paste several laps</summary>
        <div className="mt-3 space-y-2">
          <textarea
            value={pasteValue}
            onChange={(event) => setPasteValue(event.target.value)}
            rows={4}
            placeholder={'1:42.350\n1:41.920\nLap 3: 1:41.700'}
            className="w-full rounded-xl border border-zinc-700 bg-zinc-950 px-3 py-3 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
          />
          <Button type="button" variant="secondary" fullWidth onClick={addPastedLaps} disabled={!pasteValue.trim()}>
            Parse and add laps
          </Button>
        </div>
      </details>

      {message ? <p className="text-sm text-amber-200">{message}</p> : null}

      {value.length > 0 ? (
        <>
          <div className="grid grid-cols-4 gap-2 border-y border-zinc-800 py-3 text-center">
            <div><p className="text-[10px] uppercase text-zinc-500">Count</p><p className="text-sm font-semibold">{metrics.lap_count}</p></div>
            <div><p className="text-[10px] uppercase text-zinc-500">Best</p><p className="text-sm font-semibold">{metrics.best_lap_ms ? formatLapTimeInput(metrics.best_lap_ms) : '—'}</p></div>
            <div><p className="text-[10px] uppercase text-zinc-500">Average</p><p className="text-sm font-semibold">{metrics.average_lap_ms ? formatLapTimeInput(metrics.average_lap_ms) : '—'}</p></div>
            <div><p className="text-[10px] uppercase text-zinc-500">Spread</p><p className="text-sm font-semibold">{metrics.consistency_spread_ms == null ? '—' : `${(metrics.consistency_spread_ms / 1000).toFixed(3)}s`}</p></div>
          </div>
          <ul className="divide-y divide-zinc-800">
            {value.map((lap, index) => (
              <li key={`${lap.lap_number}-${index}`} className="flex min-h-12 items-center gap-3 py-2">
                <span className="w-12 text-xs text-zinc-500">Lap {lap.lap_number}</span>
                <span className="flex-1 font-mono text-sm text-zinc-100">{formatLapTimeInput(lap.lap_time_ms)}</span>
                <label className="flex min-h-11 items-center gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={lap.included}
                    onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, included: event.target.checked } : item))}
                    className="h-5 w-5 accent-cyan-400"
                  />
                  Count
                </label>
                <button
                  type="button"
                  aria-label={`Remove lap ${lap.lap_number}`}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-xl text-zinc-500 hover:bg-zinc-800 hover:text-rose-300 focus-visible:ring-2 focus-visible:ring-cyan-400/80"
                  onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="text-sm text-zinc-500">No structured laps added.</p>
      )}
    </section>
  );
}
