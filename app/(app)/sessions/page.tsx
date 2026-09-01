import Link from 'next/link';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { DemoBanner } from '@/components/demo/demo-banner';
import { getSessionEnvironments, getSessions } from '@/lib/actions/sessions';
import { getVehicles, getUserProfile } from '@/lib/actions/vehicles';
import { isDemoMode } from '@/lib/demo/mode';
import { DayPlanPanel } from '@/components/ai/day-plan-panel';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { deriveSessionAnalytics } from '@/lib/session-export';
import { SessionAnalyticsPanel } from '@/components/sessions/session-analytics-panel';
import { SessionExportPanel } from '@/components/sessions/session-export-panel';
import { SessionHistoryList } from '@/components/sessions/session-history-list';
import { effectiveTier, resolveUserAccess } from '@/lib/access';
import { getFreePlanLimit, getFreePlanLimitTitle, isAtFreePlanLimit } from '@/lib/plans';

export default async function SessionsPage() {
  const [sessions, vehicles, profile, demoMode] = await Promise.all([
    getSessions(),
    getVehicles(),
    getUserProfile(),
    isDemoMode(),
  ]);
  const environments = await getSessionEnvironments(sessions.map((session) => session.id));

  const hasProAccess = resolveUserAccess(profile).hasProAccess;
  const isFree = !hasProAccess;
  const accessTier = effectiveTier(profile);
  const atLimit = isAtFreePlanLimit('sessions', sessions.length, hasProAccess);

  const tierLabel = isFree
    ? `Free plan · ${sessions.length}/${getFreePlanLimit('sessions')} sessions`
    : `Pro plan · ${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;

  const vehicleMap = new Map(vehicles.map((v) => [v.id, v.nickname]));
  const vehicleRecordMap = new Map(vehicles.map((v) => [v.id, v]));
  const environmentMap = new Map(environments.map((environment) => [environment.session_id, environment]));
  const analytics = deriveSessionAnalytics(
    sessions.map((session) => ({
      session,
      vehicle: vehicleRecordMap.get(session.vehicle_id) ?? null,
      environment: environmentMap.get(session.id) ?? null,
    })),
  );

  return (
    <div className="space-y-5">
      {demoMode ? <DemoBanner /> : null}

      <PageHeader
        title="Sessions"
        sub={tierLabel}
        action={
          !atLimit && !demoMode ? (
            <Button asChild variant="primary" className="min-h-11 px-4 text-sm">
              <Link href="/sessions/new">+ New Session</Link>
            </Button>
          ) : null
        }
      />

      <DayPlanPanel vehicles={vehicles} tier={accessTier} demoMode={demoMode} />

      <SessionExportPanel vehicles={vehicles} tier={accessTier} demoMode={demoMode} />

      <SessionAnalyticsPanel analytics={analytics} tier={accessTier} />

      {sessions.length === 0 ? (
        <section className="rounded-card bg-surface p-6 text-center">
          <p className="text-sm text-ink-dim">No sessions logged yet.</p>
          <p className="mt-1 text-sm text-ink-faint">
            Log your first session to start tracking your setup.
          </p>
          {vehicles.length > 0 ? (
            <div className="mt-4">
              <Link href="/sessions/new">
                <Button fullWidth>Log Your First Session</Button>
              </Link>
            </div>
          ) : (
            <div className="mt-4">
              <Link href="/garage/new">
                <Button fullWidth>Add a Vehicle First</Button>
              </Link>
            </div>
          )}
        </section>
      ) : (
        <SessionHistoryList
          items={sessions.map((session) => ({
            session,
            vehicleNickname: vehicleMap.get(session.vehicle_id) ?? 'Unknown Vehicle',
            environment: environmentMap.get(session.id) ?? null,
          }))}
        />
      )}

      {atLimit && !demoMode ? (
        <section className="rounded-card bg-surface p-4 text-center">
          <p className="text-sm font-semibold text-ink">{getFreePlanLimitTitle('sessions')}</p>
          <p className="mt-1 text-sm text-ink-dim">
            Upgrade to Pro for unlimited sessions, full history, and AI-powered tuning suggestions.
          </p>
          <div className="mt-4">
            <UpgradeToProButton fullWidth />
          </div>
        </section>
      ) : null}
    </div>
  );
}
