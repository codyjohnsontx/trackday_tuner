import Link from 'next/link';
import { ManageBillingButton, UpgradeToProButton } from '@/components/billing/billing-buttons';
import { getVehicles, getUserProfile } from '@/lib/actions/vehicles';
import { getSessions, getSessionCount } from '@/lib/actions/sessions';
import { getFreePlanLimit } from '@/lib/plans';
import { Button } from '@/components/ui/button';
import { SessionCard } from '@/components/sessions/session-card';
import { SectionLabel } from '@/components/ui/section-label';
import { EmptyState } from '@/components/ui/empty-state';

export default async function DashboardPage() {
  const [vehicles, sessions, sessionCount, profile] = await Promise.all([
    getVehicles(),
    getSessions(undefined, 3),
    getSessionCount(),
    getUserProfile(),
  ]);

  const hasVehicles = vehicles.length > 0;
  const isFree = !profile || profile.tier === 'free';
  const isPro = profile?.tier === 'pro';
  const atSessionLimit = isFree && sessionCount >= getFreePlanLimit('sessions');
  const billingRenewal = profile?.stripe_current_period_end
    ? new Date(profile.stripe_current_period_end).toLocaleDateString()
    : null;

  const vehicleMap = new Map(vehicles.map((v) => [v.id, v.nickname]));

  return (
    <div className="space-y-5">
      {/* Hero */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h1 className="text-2xl font-bold text-zinc-100">Pit Board</h1>
        {hasVehicles ? (
          <>
            <p className="mt-1.5 text-sm text-zinc-400">
              {vehicles.length} machine{vehicles.length !== 1 ? 's' : ''} ·{' '}
              {sessionCount}/{isFree ? getFreePlanLimit('sessions') : '∞'} sessions logged
            </p>
            <div className="mt-4">
              {atSessionLimit ? (
                <UpgradeToProButton fullWidth />
              ) : (
                <Link href="/sessions/new">
                  <Button fullWidth>+ Log Session</Button>
                </Link>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-sm text-zinc-400">
              Add your first machine and you&apos;re one session away from your setup logbook.
            </p>
            <div className="mt-4">
              <Link href="/garage/new">
                <Button>Add Your First Machine</Button>
              </Link>
            </div>
          </>
        )}
      </section>

      {/* Billing */}
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <SectionLabel>Subscription</SectionLabel>
        <p className="mt-2 text-sm text-zinc-300">
          Plan: <span className="font-semibold uppercase">{isPro ? 'Factory' : 'Privateer'}</span>
        </p>
        {isPro ? (
          <p className="mt-1 text-sm text-zinc-400">
            {billingRenewal ? `Renews ${billingRenewal}.` : 'Active subscription.'}
          </p>
        ) : (
          <p className="mt-1 text-sm text-zinc-400">
            Upgrade to Factory for unlimited machines, full session history, and AI tuning advice.
          </p>
        )}
        <div className="mt-4">
          {isPro ? <ManageBillingButton fullWidth /> : <UpgradeToProButton fullWidth />}
        </div>
      </section>

      {/* Recent sessions */}
      {sessions.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionLabel>Recent Sessions</SectionLabel>
            <Link href="/sessions" className="text-xs text-cyan-400 hover:text-cyan-300">
              View all
            </Link>
          </div>
          <ul className="space-y-3">
            {sessions.map((s) => (
              <SessionCard
                key={s.id}
                session={s}
                vehicleNickname={vehicleMap.get(s.vehicle_id) ?? 'Unknown Vehicle'}
              />
            ))}
          </ul>
        </div>
      ) : hasVehicles ? (
        <EmptyState
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5h6" />
            </svg>
          }
          title="No sessions in the logbook yet"
          description="Head to the track and log your first setup."
          action={
            <Link href="/sessions/new">
              <Button size="sm">Log a Session</Button>
            </Link>
          }
        />
      ) : null}
    </div>
  );
}
