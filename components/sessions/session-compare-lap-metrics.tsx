import { formatLapTime, type LapMetricDeltas, type LapMetrics } from '@/lib/session-compare';

interface SessionCompareLapMetricsProps {
  current: LapMetrics;
  baseline: LapMetrics;
  deltas: LapMetricDeltas;
}

function hasLapMetrics(metrics: LapMetrics): boolean {
  return (
    metrics.bestLapMs !== null ||
    metrics.averageLapMs !== null ||
    metrics.lapCount !== null ||
    metrics.consistencySpreadMs !== null
  );
}

function formatDelta(delta: number | null, mode: 'pace' | 'count' | 'spread'): string {
  if (delta === null) return '—';
  if (mode === 'count') {
    if (delta === 0) return 'same';
    return delta > 0 ? `+${delta} laps` : `${delta} laps`;
  }

  if (delta === 0) return 'same';
  const abs = formatLapTime(Math.abs(delta));
  if (mode === 'spread') return delta < 0 ? `${abs} more consistent` : `${abs} less consistent`;
  return delta < 0 ? `${abs} faster` : `${abs} slower`;
}

function MetricRow({
  label,
  baseline,
  current,
  delta,
}: {
  label: string;
  baseline: string;
  current: string;
  delta: string;
}) {
  return (
    <div className="grid grid-cols-[1fr_5.5rem_5.5rem] gap-3 py-2 text-sm">
      <span className="text-ink-dim">{label}</span>
      <span className="text-right text-ink-dim">{baseline}</span>
      <span className="text-right font-medium text-ink">{current}</span>
      <span className="col-span-3 text-xs text-signal">{delta}</span>
    </div>
  );
}

export function SessionCompareLapMetrics({ current, baseline, deltas }: SessionCompareLapMetricsProps) {
  if (!hasLapMetrics(current) || !hasLapMetrics(baseline)) {
    return (
      <section className="rounded-card bg-surface p-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Lap metrics</h2>
        <p className="mt-2 text-sm text-ink-dim">
          Lap metrics unavailable. Add structured lap data in a future release to compare pace.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-card bg-surface p-4">
      <div className="mb-2 grid grid-cols-[1fr_5.5rem_5.5rem] gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Lap metrics</h2>
        <span className="text-right text-xs font-semibold uppercase tracking-wider text-ink-faint">Baseline</span>
        <span className="text-right text-xs font-semibold uppercase tracking-wider text-ink-faint">Current</span>
      </div>
      <div className="divide-y divide-white/5">
        <MetricRow
          label="Best lap"
          baseline={formatLapTime(baseline.bestLapMs)}
          current={formatLapTime(current.bestLapMs)}
          delta={formatDelta(deltas.bestLapMs, 'pace')}
        />
        <MetricRow
          label="Average lap"
          baseline={formatLapTime(baseline.averageLapMs)}
          current={formatLapTime(current.averageLapMs)}
          delta={formatDelta(deltas.averageLapMs, 'pace')}
        />
        <MetricRow
          label="Lap count"
          baseline={baseline.lapCount?.toString() ?? '—'}
          current={current.lapCount?.toString() ?? '—'}
          delta={formatDelta(deltas.lapCount, 'count')}
        />
        <MetricRow
          label="Consistency"
          baseline={formatLapTime(baseline.consistencySpreadMs)}
          current={formatLapTime(current.consistencySpreadMs)}
          delta={formatDelta(deltas.consistencySpreadMs, 'spread')}
        />
      </div>
    </section>
  );
}
