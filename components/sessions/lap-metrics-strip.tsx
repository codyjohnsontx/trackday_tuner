import { formatLapTimeInput, type LapAggregate } from '@/lib/lap-times';
import { cn } from '@/lib/utils';

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase text-ink-faint">{label}</p>
      <p className="text-sm font-semibold">{value}</p>
    </div>
  );
}

/**
 * Count / best / average / spread for a lap list.
 *
 * Shared by the lap editor and the session page's read view, so a rider sees the
 * same four numbers whether or not they are editing. The read view used to print
 * only the included-lap count, so a logged best lap was on screen nowhere.
 */
export function LapMetricsStrip({ metrics, className }: { metrics: LapAggregate; className?: string }) {
  return (
    <div className={cn('grid grid-cols-4 gap-2 text-center', className)}>
      <Metric label="Count" value={String(metrics.lap_count)} />
      <Metric label="Best" value={metrics.best_lap_ms ? formatLapTimeInput(metrics.best_lap_ms) : '—'} />
      <Metric label="Average" value={metrics.average_lap_ms ? formatLapTimeInput(metrics.average_lap_ms) : '—'} />
      <Metric
        label="Spread"
        value={metrics.consistency_spread_ms == null ? '—' : `${(metrics.consistency_spread_ms / 1000).toFixed(3)}s`}
      />
    </div>
  );
}
