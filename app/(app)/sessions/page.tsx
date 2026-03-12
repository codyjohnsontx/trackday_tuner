import Link from 'next/link';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { getSessions } from '@/lib/actions/sessions';
import { getVehicles, getUserProfile } from '@/lib/actions/vehicles';
import { formatFreePlanUsage, getFreePlanLimit } from '@/lib/plans';
import { SessionCard } from '@/components/sessions/session-card';
import { Button } from '@/components/ui/button';

export default async function SessionsPage() {
  const [sessions, vehicles, profile] = await Promise.all([
    getSessions(),
    getVehicles(),
    getUserProfile(),
  ]);

  const isFree = !profile || profile.tier === 'free';
  const atLimit = isFree && sessions.length >= getFreePlanLimit('sessions');

  const tierLabel = isFree
    ? formatFreePlanUsage('sessions', sessions.length)
    : `Pro plan · ${sessions.length} session${sessions.length !== 1 ? 's' : ''}`;

  const vehicleMap = new Map(vehicles.map((v) => [v.id, v.nickname]));

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Logbook</h1>
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

      {sessions.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/50 p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-500">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2M9 5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2M9 5h6" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-zinc-300">No sessions in the logbook</p>
          <p className="mt-1 text-sm text-zinc-500">Log your first session after your next outing.</p>
          {vehicles.length > 0 ? (
            <div className="mt-4">
              <Link href="/sessions/new">
                <Button fullWidth>Log First Session</Button>
              </Link>
            </div>
          ) : (
            <div className="mt-4">
              <Link href="/garage/new">
                <Button fullWidth>Add a Machine First</Button>
              </Link>
            </div>
          )}
        </section>
      ) : (
        <ul className="space-y-3">
          {sessions.map((s) => (
            <SessionCard
              key={s.id}
              session={s}
              vehicleNickname={vehicleMap.get(s.vehicle_id) ?? 'Unknown Vehicle'}
            />
          ))}
        </ul>
      )}

      {atLimit ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <p className="text-sm font-semibold text-zinc-200">Logbook full on the free plan</p>
          <p className="mt-1 text-sm text-zinc-400">
            Upgrade to Factory for unlimited sessions, full history, and AI tuning advice.
          </p>
          <div className="mt-4">
            <UpgradeToProButton fullWidth />
          </div>
        </section>
      ) : null}
    </div>
  );
}
