import type { VehicleBaseline } from '@/types';

function formatDateLabel(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function baselineSourceLabel(baseline: VehicleBaseline): string {
  return [
    baseline.source_track_name ?? 'Unknown Track',
    formatDateLabel(baseline.source_date),
    baseline.source_session_number ? `Session ${baseline.source_session_number}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
}
