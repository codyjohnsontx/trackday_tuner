import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import type { SessionAnalyticsSummary } from '@/lib/session-export';

interface SessionAnalyticsPanelProps {
  analytics: SessionAnalyticsSummary;
  tier: 'free' | 'pro';
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">{label}</p>
      <p className="mt-2 text-xl font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function CountList({ title, items }: { title: string; items: { label: string; detail: string }[] }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="text-sm font-semibold text-zinc-100">{title}</p>
      {items.length > 0 ? (
        <div className="mt-3 divide-y divide-zinc-800">
          {items.map((item) => (
            <div key={`${item.label}-${item.detail}`} className="flex justify-between gap-3 py-2">
              <span className="min-w-0 truncate text-sm text-zinc-300">{item.label}</span>
              <span className="shrink-0 text-sm font-medium text-zinc-100">{item.detail}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">No data yet.</p>
      )}
    </section>
  );
}

export function SessionAnalyticsPanel({ analytics, tier }: SessionAnalyticsPanelProps) {
  if (tier !== 'pro') {
    return (
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <p className="text-sm font-semibold text-zinc-100">Analytics</p>
        <p className="mt-1 text-sm text-zinc-400">
          Pro summarizes vehicle usage, track history, module coverage, tire pressures, and environment snapshots.
        </p>
        <div className="mt-4">
          <UpgradeToProButton fullWidth />
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-3">
      <div>
        <p className="text-sm font-semibold text-zinc-100">Analytics</p>
        <p className="mt-1 text-sm text-zinc-400">Quick summaries from your logged setup history.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Sessions" value={String(analytics.totalSessions)} />
        <StatCard
          label="Environment Logs"
          value={`${analytics.environmentSnapshots.withEnvironment}/${analytics.totalSessions}`}
        />
        <StatCard
          label="Avg Track Temp"
          value={
            analytics.environmentSnapshots.averageTrackTemperatureC === null
              ? 'Not logged'
              : `${analytics.environmentSnapshots.averageTrackTemperatureC} C`
          }
        />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <CountList
          title="Sessions by Vehicle"
          items={analytics.sessionsByVehicle.map((item) => ({
            label: item.label,
            detail: String(item.count),
          }))}
        />
        <CountList
          title="Top Tracks"
          items={analytics.topTracks.map((item) => ({
            label: item.trackName,
            detail: String(item.count),
          }))}
        />
        <CountList
          title="Module Coverage"
          items={analytics.moduleCoverage.map((item) => ({
            label: item.module.replace('_', ' '),
            detail: `${item.count} (${item.percent}%)`,
          }))}
        />
        <CountList
          title="Tire Pressure Trends"
          items={analytics.tirePressureTrends.map((item) => ({
            label: item.label,
            detail: `${item.first} -> ${item.latest}`,
          }))}
        />
      </div>
    </section>
  );
}
