import Link from 'next/link';
import { baselineSourceLabel } from '@/lib/baseline-format';
import type { VehicleBaseline } from '@/types';

interface VehicleBaselineSummaryProps {
  baseline: VehicleBaseline | null;
  locked?: boolean;
}

export function VehicleBaselineSummary({ baseline, locked = false }: VehicleBaselineSummaryProps) {
  if (!baseline) {
    return (
      <div className="border-t border-white/5 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
          {locked ? 'Baseline · Pro feature' : 'No baseline set'}
        </p>
        <p className="mt-1 text-sm text-ink-dim">
          {locked ? 'Set a known-good setup for each vehicle with Pro.' : 'Set one from a session detail page.'}
        </p>
      </div>
    );
  }

  const label = baselineSourceLabel(baseline);

  return (
    <div className="border-t border-white/5 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-faint">Baseline</p>
      {baseline.source_session_id ? (
        <Link
          href={`/sessions/${baseline.source_session_id}`}
          className="mt-1 block text-sm font-medium text-ink underline-offset-4 hover:text-signal hover:underline focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
        >
          {label}
        </Link>
      ) : (
        <p className="mt-1 text-sm font-medium text-ink">{label}</p>
      )}
    </div>
  );
}
