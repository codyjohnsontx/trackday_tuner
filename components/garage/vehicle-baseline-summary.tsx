import Link from 'next/link';
import type { VehicleBaseline } from '@/types';

interface VehicleBaselineSummaryProps {
  baseline: VehicleBaseline | null;
  locked?: boolean;
}

function formatDateLabel(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function sourceLabel(baseline: VehicleBaseline): string {
  const parts = [
    baseline.source_track_name ?? 'Unknown Track',
    formatDateLabel(baseline.source_date),
    baseline.source_session_number ? `Session ${baseline.source_session_number}` : null,
  ].filter(Boolean);

  return parts.join(' · ');
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

  const label = sourceLabel(baseline);

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
