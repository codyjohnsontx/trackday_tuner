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

function CountList({
  title,
  items,
  emptyMessage = 'No data yet.',
}: {
  // `id` is for a list whose rows can read identically - two vehicles sharing a
  // nickname put the same label and detail on the board twice, and without it
  // React drops one of them.
  items: { id?: string; label: string; detail: string }[];
  title: string;
  emptyMessage?: string;
}) {
  return (
    // `min-w-0`: a grid item sizes to its content by default, so without it a
    // long row makes this section wider than its track and the whole page
    // scrolls sideways on a phone. A circuit name beside a vehicle nickname is
    // enough to do it, and the row can only wrap once the section can shrink.
    <CardGroup eyebrow={title} className="min-w-0">
      {items.length > 0 ? (
        <div className="divide-y divide-white/5 rounded-row bg-surface-2 px-4">
          {items.map((item) => (
            <div key={item.id ?? `${item.label}-${item.detail}`} className="flex justify-between gap-3 py-2.5">
              {/* Wraps rather than truncating. A row's label is what says which
                  circuit, vehicle and - for a session that named no track -
                  which day and session it is, so an ellipsis through it hides
                  the very thing that tells two rows apart. Nothing here is
                  pressable, so a second line costs only height. */}
              <span className="min-w-0 break-words text-sm text-ink-dim">{item.label}</span>
              <span className="shrink-0 text-sm font-medium text-ink">{item.detail}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-row bg-surface-2 p-4 text-sm text-ink-faint">{emptyMessage}</p>
      )}
    </CardGroup>
  );
}

export function SessionAnalyticsPanel({ analytics, tier }: SessionAnalyticsPanelProps) {
  // A board row is one vehicle at one circuit, so a garage holding more than one
  // vehicle can show the same track twice and the vehicle is the only thing
  // telling those rows apart.
  const multipleVehicles = analytics.sessionsByVehicle.length > 1;

  if (tier !== 'pro') {
    return (
      <section className="rounded-card bg-surface p-4">
        <p className="text-sm font-semibold text-ink">Analytics</p>
        <p className="mt-1 text-sm text-ink-dim">
          Pro summarizes your lap totals and best lap at each track, plus vehicle usage, track history, logging
          coverage, and tire pressure trends.
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
          {/* Laps, not `Env logs`. The headline strip is what a rider glances
              at, and the count of sessions carrying an environment row is a
              logging diagnostic - it moved into the coverage list, which is
              where every other "how much did you fill in" number already lives. */}
          <Stat label="Laps" value={String(analytics.laps.totalLaps)} />
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
        {/* First list on the panel: a lap time is the number the session was
            logged for. It is per circuit and per vehicle because that is the
            pair a lap compares against, the same one the compare page uses. */}
        <CountList
          title="Best Lap By Track"
          items={analytics.bestLapByTrack.map((item) => ({
            id: item.key,
            label: multipleVehicles ? `${item.trackName} · ${item.vehicleLabel}` : item.trackName,
            detail: item.bestLap,
          }))}
          emptyMessage="No lap times logged yet."
        />
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
          title="Logging Coverage"
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
