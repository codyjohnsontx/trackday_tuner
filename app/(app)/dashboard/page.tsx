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
import { resolveDashboardHeroSubject } from '@/lib/dashboard-hero';
import { resolveUserAccess } from '@/lib/access';
import { getFreePlanLimit, isAtFreePlanLimit } from '@/lib/plans';
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
  const access = resolveUserAccess(profile);
  const isFree = !access.hasProAccess;
  const atSessionLimit = isAtFreePlanLimit('sessions', sessionCount, access.hasProAccess);

  const vehicleMap = new Map(vehicles.map((v) => [v.id, v.nickname]));

  // The name and the line under it describe one vehicle, so they are resolved
  // together rather than picked off two different lists.
  const hero = resolveDashboardHeroSubject(vehicles, sessions);
  const lastRun = hero.latestSession
    ? `Last out at ${hero.latestSession.track_name ?? 'an unnamed track'} on ${new Date(
        `${hero.latestSession.date}T00:00:00`,
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
            ? `${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''} · ${sessionCount}/${isFree ? getFreePlanLimit('sessions') : '∞'} sessions`
            : 'Nothing in the garage yet'
        }
      />

      <DashboardHero vehicleName={hero.vehicleName} lastRun={lastRun} />

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
