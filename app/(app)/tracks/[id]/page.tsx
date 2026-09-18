import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DemoBanner } from '@/components/demo/demo-banner';
import { getTrack } from '@/lib/actions/tracks';
import { getSessionsAtTrack, getTelemetrySummaries } from '@/lib/actions/sessions';
import { getVehicles } from '@/lib/actions/vehicles';
import { isDemoMode } from '@/lib/demo/mode';
import { TrackForm } from '@/components/tracks/track-form';
import { TrackDeleteForm } from '@/components/tracks/track-delete-form';
import { SessionCard } from '@/components/sessions/session-card';
import { Button } from '@/components/ui/button';
import { pageTitleClass } from '@/components/ui/page-header';
import { buildLapSummaryLabel } from '@/lib/session-compare';
import { cn } from '@/lib/utils';

interface TrackDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TrackDetailPage({ params }: TrackDetailPageProps) {
  const { id } = await params;
  const [result, demoMode] = await Promise.all([getTrack(id), isDemoMode()]);

  if (!result.ok) {
    redirect('/tracks');
  }

  const track = result.data;
  const isCustom = !track.is_seeded;

  const [sessionsResult, vehicles] = await Promise.all([getSessionsAtTrack(track), getVehicles()]);
  const sessions = sessionsResult.ok ? sessionsResult.data : [];
  const telemetry = await getTelemetrySummaries(sessions.map((session) => session.id));
  const telemetryMap = new Map(telemetry.map((summary) => [summary.session_id, summary]));
  const vehicleMap = new Map(vehicles.map((vehicle) => [vehicle.id, vehicle.nickname]));

  return (
    <div className="space-y-5">
      {demoMode ? <DemoBanner /> : null}

      <div>
        <Link href="/tracks" className="text-sm text-ink-dim hover:text-ink">
          ← Tracks
        </Link>
        <h1 className={cn('mt-3', pageTitleClass)}>{track.name}</h1>
        <p className="mt-1 text-sm text-ink-dim">{track.location ?? 'No location provided.'}</p>
        <span className="mt-2 inline-flex rounded-plate bg-surface-2 px-2 py-1 text-xs text-ink-dim">
          {isCustom ? 'Custom Track' : 'Global Read-only Track'}
        </span>
      </div>

      {/* This used to be a fixed paragraph promising that history "will appear
          here" - it queried nothing, so it said the same on a track the rider
          had logged a whole season at. */}
      <section className="space-y-3 rounded-card bg-surface p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">Recent Sessions</h2>
        {!sessionsResult.ok ? (
          <p className="text-sm text-slower" role="alert">{sessionsResult.error}</p>
        ) : sessions.length > 0 ? (
          <ul className="space-y-2">
            {sessions.map((session) => (
              <li key={session.id}>
                <SessionCard
                  session={session}
                  vehicleNickname={vehicleMap.get(session.vehicle_id) ?? 'Unknown Vehicle'}
                  lapSummary={buildLapSummaryLabel(telemetryMap.get(session.id))}
                />
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="text-sm text-ink-dim">You have not logged a session at this track yet.</p>
            {!demoMode ? (
              <Button asChild variant="secondary" fullWidth>
                <Link href="/sessions/new">Log a Session</Link>
              </Button>
            ) : null}
          </>
        )}
      </section>

      {isCustom && !demoMode ? (
        <section className="space-y-4 rounded-card bg-surface p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">Edit Track</h2>
          <TrackForm initialTrack={track} onSuccessPath={`/tracks/${track.id}`} />
          <TrackDeleteForm trackId={track.id} />
        </section>
      ) : (
        <section className="rounded-card bg-surface p-4">
          <p className="text-sm text-ink-dim">
            {demoMode ? 'Demo mode is read-only. Start a real account to edit tracks.' : 'This is a seeded global track and is read-only.'}
          </p>
        </section>
      )}
    </div>
  );
}
