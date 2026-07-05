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
      <div className="border-t border-zinc-800 pt-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
          {locked ? 'Baseline · Pro feature' : 'No baseline set'}
        </p>
        <p className="mt-1 text-sm text-zinc-400">
          {locked ? 'Set a known-good setup for each vehicle with Pro.' : 'Set one from a session detail page.'}
        </p>
      </div>
    );
  }

  const label = baselineSourceLabel(baseline);

  return (
    <div className="border-t border-zinc-800 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-cyan-300">Baseline</p>
      {baseline.source_session_id ? (
        <Link
          href={`/sessions/${baseline.source_session_id}`}
          className="mt-1 block text-sm font-medium text-zinc-100 underline-offset-4 hover:text-cyan-200 hover:underline focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/80"
        >
          {label}
        </Link>
      ) : (
        <p className="mt-1 text-sm font-medium text-zinc-100">{label}</p>
      )}
    </div>
  );
}
