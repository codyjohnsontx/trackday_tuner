import { formatLapTime, type LapMetricDeltas, type LapMetrics } from '@/lib/session-compare';
import { cn } from '@/lib/utils';

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

/**
 * A delta already knows which way it went, so it carries its own tone. Pace and
 * consistency are directional — quicker and tighter are better. Lap count is
 * not: more laps is neither an improvement nor a regression.
 */
interface Delta {
  text: string;
  tone: string;
}

const NEUTRAL_DELTA = 'text-ink-faint';

function formatDelta(delta: number | null, mode: 'pace' | 'count' | 'spread'): Delta {
  if (delta === null) return { text: '—', tone: NEUTRAL_DELTA };
  if (mode === 'count') {
    if (delta === 0) return { text: 'same', tone: NEUTRAL_DELTA };
    return { text: delta > 0 ? `+${delta} laps` : `${delta} laps`, tone: NEUTRAL_DELTA };
  }

  if (delta === 0) return { text: 'same', tone: NEUTRAL_DELTA };
  const abs = formatLapTime(Math.abs(delta));
  const better = delta < 0;
  const tone = better ? 'text-faster' : 'text-slower';
  if (mode === 'spread') {
    return { text: better ? `${abs} more consistent` : `${abs} less consistent`, tone };
  }
  return { text: better ? `${abs} faster` : `${abs} slower`, tone };
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
  delta: Delta;
}) {
  return (
    <div className="grid grid-cols-[1fr_5.5rem_5.5rem] gap-3 py-2 text-sm">
      <span className="text-ink-dim">{label}</span>
      <span className="text-right text-ink-dim">{baseline}</span>
      <span className="text-right font-medium text-ink">{current}</span>
      <span className={cn('col-span-3 text-xs', delta.tone)}>{delta.text}</span>
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
