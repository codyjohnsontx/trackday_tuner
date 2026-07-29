import Link from 'next/link';
import { Timer } from 'lucide-react';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { DashboardHero } from '@/components/dashboard/dashboard-hero';
import { DemoBanner } from '@/components/demo/demo-banner';
import { getVehicles, getUserProfile } from '@/lib/actions/vehicles';
import { getSessions, getSessionCount } from '@/lib/actions/sessions';
import { isDemoMode } from '@/lib/demo/mode';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { CardGroup } from '@/components/ui/surface';
import { SessionCard } from '@/components/sessions/session-card';
import { resolveUserAccess } from '@/lib/access';
import { getBetaFeedback, hasTwoDistinctTrackDays } from '@/lib/actions/beta';
import { BetaSurvey } from '@/components/beta/beta-survey';

export default async function DashboardPage() {
  const [vehicles, sessions, sessionCount, profile, demoMode, betaFeedback, hasTwoTrackDays] = await Promise.all([
    getVehicles(),
    getSessions(undefined, 3),
    getSessionCount(),
    getUserProfile(),
    isDemoMode(),
    getBetaFeedback(),
    hasTwoDistinctTrackDays(),
  ]);

  const hasVehicles = vehicles.length > 0;
  const isFree = !resolveUserAccess(profile).hasProAccess;
  const atSessionLimit = isFree && sessionCount >= 10;
  const access = resolveUserAccess(profile);

  const vehicleMap = new Map(vehicles.map((v) => [v.id, v.nickname]));

  // getSessions returns newest first, so the head of the list is the last outing.
  const lastSession = sessions[0];
  const lastRun = lastSession
    ? `Last out at ${lastSession.track_name ?? 'an unnamed track'} on ${new Date(
        `${lastSession.date}T00:00:00`,
      ).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
    : hasVehicles
      ? 'No sessions logged yet.'
      : null;

  return (
    <div className="space-y-5">
      {demoMode ? <DemoBanner /> : null}

      <PageHeader
        title="Dashboard"
        sub={
          hasVehicles
            ? `${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''} · ${sessionCount}/${isFree ? '10' : '∞'} sessions`
            : 'Nothing in the garage yet'
        }
      />

      <DashboardHero vehicleName={vehicles[0]?.nickname ?? null} lastRun={lastRun} />

      {hasVehicles ? (
        demoMode ? (
          <Button fullWidth variant="secondary" disabled>
            Read-only demo
          </Button>
        ) : atSessionLimit ? (
          <UpgradeToProButton fullWidth />
        ) : (
          <Button asChild fullWidth>
            <Link href="/sessions/new">+ New Session</Link>
          </Button>
        )
      ) : (
        <Button asChild fullWidth>
          <Link href="/garage/new">Add a Vehicle</Link>
        </Button>
      )}

      {sessions.length > 0 ? (
        <CardGroup
          icon={Timer}
          eyebrow="Recent"
          title="Sessions"
          action={
            <Link
              href="/sessions"
              className="text-sm font-medium text-ink-dim transition hover:text-ink"
            >
              View all
            </Link>
          }
        >
          <ul className="space-y-2">
            {sessions.map((s) => (
              <li key={s.id}>
                <SessionCard
                  session={s}
                  vehicleNickname={vehicleMap.get(s.vehicle_id) ?? 'Unknown Vehicle'}
                />
              </li>
            ))}
          </ul>
        </CardGroup>
      ) : null}

      {access.source === 'beta' && hasTwoTrackDays && !betaFeedback ? <BetaSurvey /> : null}
    </div>
  );
}
