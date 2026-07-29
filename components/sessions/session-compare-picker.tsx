'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export interface SessionComparePickerOption {
  id: string;
  trackName: string;
  dateLabel: string;
  sessionLabel: string;
  conditionLabel: string;
  bestLapLabel: string | null;
  sameTrack: boolean;
  isVehicleBaseline?: boolean;
}

interface SessionComparePickerProps {
  options: SessionComparePickerOption[];
  selectedId: string | null;
}

export function SessionComparePicker({ options, selectedId }: SessionComparePickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set('baseline', value);
    } else {
      params.delete('baseline');
    }
    const query = params.toString();
    router.push((query ? `${pathname}?${query}` : pathname) as never);
  }

  return (
    <section className="rounded-card bg-surface p-4">
      <div className="mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Baseline session</h2>
        <p className="mt-1 text-sm text-ink-dim">Same-vehicle sessions are listed with same-track sessions first.</p>
      </div>

      {options.length > 0 ? (
        <select
          value={selectedId ?? ''}
          onChange={(event) => handleChange(event.target.value)}
          className="min-h-12 w-full rounded-row bg-surface-3 px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
          aria-label="Baseline session"
        >
          <option value="">Choose a baseline</option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.isVehicleBaseline ? 'Vehicle baseline · ' : ''}
              {option.sameTrack ? 'Same track · ' : 'Other track · '}
              {option.trackName} · {option.dateLabel} · {option.sessionLabel} · {option.conditionLabel}
              {option.bestLapLabel ? ` · Best ${option.bestLapLabel}` : ''}
            </option>
          ))}
        </select>
      ) : (
        <p className="text-sm text-ink-dim">No other sessions are available for this vehicle yet.</p>
      )}
    </section>
  );
}
