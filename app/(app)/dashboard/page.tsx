import Link from 'next/link';
import { ManageBillingButton, UpgradeToProButton } from '@/components/billing/billing-buttons';
import { getVehicles, getUserProfile } from '@/lib/actions/vehicles';
import { getSessions, getSessionCount } from '@/lib/actions/sessions';
import { Button } from '@/components/ui/button';
import { SessionCard } from '@/components/sessions/session-card';

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
  const atSessionLimit = isFree && sessionCount >= 10;
  const billingRenewal = profile?.stripe_current_period_end
    ? new Date(profile.stripe_current_period_end).toLocaleDateString()
    : null;

  const vehicleMap = new Map(vehicles.map((v) => [v.id, v.nickname]));

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-xl font-semibold">Dashboard</h2>
        {hasVehicles ? (
          <>
            <p className="mt-2 text-sm text-zinc-300">
              {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} · {sessionCount}/
              {isFree ? '10' : '∞'} sessions
            </p>
            <div className="mt-4">
              {atSessionLimit ? (
                <UpgradeToProButton fullWidth />
              ) : (
                <Link href="/sessions/new">
                  <Button fullWidth>+ New Session</Button>
                </Link>
              )}
            </div>
          </>
        ) : (
          <>
            <p className="mt-2 text-sm text-zinc-300">
              Add a vehicle to start logging track sessions.
            </p>
            <div className="mt-4">
              <Link href="/garage/new">
                <Button>Add a Vehicle</Button>
              </Link>
            </div>
          </>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">
          Billing
        </h3>
        <p className="mt-2 text-sm text-zinc-300">
          Plan: <span className="font-medium uppercase">{isPro ? 'Pro' : 'Free'}</span>
        </p>
        {isPro ? (
          <p className="mt-1 text-sm text-zinc-400">
            {billingRenewal ? `Renews on ${billingRenewal}.` : 'Active subscription.'}
          </p>
        ) : (
          <p className="mt-1 text-sm text-zinc-400">
            Upgrade to unlock unlimited vehicles, tracks, and sessions.
          </p>
        )}
        <div className="mt-4">
          {isPro ? <ManageBillingButton fullWidth /> : <UpgradeToProButton fullWidth />}
        </div>
      </section>

      {sessions.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
              Recent Sessions
            </h3>
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
      ) : null}
    </div>
  );
}
