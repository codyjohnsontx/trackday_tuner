import type { ReactNode } from 'react';
import { ChartNoAxesColumn } from 'lucide-react';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { CardGroup, Eyebrow } from '@/components/ui/surface';
import { TemperatureDisplay } from '@/components/ui/temperature-display';
import type { SessionAnalyticsSummary } from '@/lib/session-export';

interface SessionAnalyticsPanelProps {
  analytics: SessionAnalyticsSummary;
  tier: 'free' | 'pro';
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-row bg-surface-2 p-4">
      <Eyebrow>{label}</Eyebrow>
      <p className="mt-2 text-xl font-semibold text-ink">{value}</p>
    </div>
  );
}

function CountList({ title, items }: { title: string; items: { label: string; detail: string }[] }) {
  return (
    <CardGroup eyebrow={title}>
      {items.length > 0 ? (
        <div className="divide-y divide-white/5 rounded-row bg-surface-2 px-4">
          {items.map((item) => (
            <div key={`${item.label}-${item.detail}`} className="flex justify-between gap-3 py-2.5">
              <span className="min-w-0 truncate text-sm text-ink-dim">{item.label}</span>
              <span className="shrink-0 text-sm font-medium text-ink">{item.detail}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-row bg-surface-2 p-4 text-sm text-ink-faint">No data yet.</p>
      )}
    </CardGroup>
  );
}

export function SessionAnalyticsPanel({ analytics, tier }: SessionAnalyticsPanelProps) {
  if (tier !== 'pro') {
    return (
      <section className="rounded-card bg-surface p-4">
        <p className="text-sm font-semibold text-ink">Analytics</p>
        <p className="mt-1 text-sm text-ink-dim">
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
      <CardGroup
        icon={ChartNoAxesColumn}
        eyebrow="From your history"
        title="Analytics"
      >
        {/* Three across even on the narrowest phone: these are short numbers,
            and stacking them turns a glance into a scroll. */}
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Sessions" value={String(analytics.totalSessions)} />
          <Stat
            label="Env logs"
            value={`${analytics.environmentSnapshots.withEnvironment}/${analytics.totalSessions}`}
          />
          <Stat
            label="Avg track"
            value={
              analytics.environmentSnapshots.averageTrackTemperatureC === null ? (
                '--'
              ) : (
                <TemperatureDisplay
                  celsius={analytics.environmentSnapshots.averageTrackTemperatureC}
                  className="text-xl font-semibold"
                />
              )
            }
          />
        </div>
      </CardGroup>

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
