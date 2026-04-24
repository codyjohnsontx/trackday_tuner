import Link from 'next/link';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { getSessionEnvironments, getSessions } from '@/lib/actions/sessions';
import { getVehicles, getUserProfile } from '@/lib/actions/vehicles';
import { DayPlanPanel } from '@/components/ai/day-plan-panel';
import { Button } from '@/components/ui/button';
import { SessionHistoryList } from '@/components/sessions/session-history-list';

export default async function SessionsPage() {
  const [sessions, vehicles, profile] = await Promise.all([
    getSessions(),
    getVehicles(),
    getUserProfile(),
  ]);
  const environments = await getSessionEnvironments(sessions.map((session) => session.id));

  const isFree = !profile || profile.tier === 'free';
  const atLimit = isFree && sessions.length >= 10;

  const tierLabel = isFree
    ? `Free plan · ${sessions.length}/10 sessions`
    : `Pro plan · ${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;

  const vehicleMap = new Map(vehicles.map((v) => [v.id, v.nickname]));
  const environmentMap = new Map(environments.map((environment) => [environment.session_id, environment]));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Sessions</h1>
          <p className="mt-0.5 text-xs text-zinc-500">{tierLabel}</p>
        </div>
        {!atLimit ? (
          <Link href="/sessions/new">
            <Button variant="primary" className="min-h-10 px-3 text-sm">
              + New Session
            </Button>
          </Link>
        ) : null}
      </div>

      <DayPlanPanel vehicles={vehicles} tier={profile?.tier ?? 'free'} />

      {sessions.length === 0 ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 text-center">
          <p className="text-sm text-zinc-400">No sessions logged yet.</p>
          <p className="mt-1 text-sm text-zinc-500">
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

      {atLimit ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <p className="text-sm font-semibold text-zinc-200">Session limit reached</p>
          <p className="mt-1 text-sm text-zinc-400">
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
