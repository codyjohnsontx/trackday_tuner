import Link from 'next/link';
import { getVehicles, getUserProfile } from '@/lib/actions/vehicles';
import { getSessions } from '@/lib/actions/sessions';
import { Button } from '@/components/ui/button';
import { SessionCard } from '@/components/sessions/session-card';

export default async function DashboardPage() {
  const [vehicles, sessions, profile] = await Promise.all([
    getVehicles(),
    getSessions(),
    getUserProfile(),
  ]);

  const hasVehicles = vehicles.length > 0;
  const isFree = !profile || profile.tier === 'free';
  const atSessionLimit = isFree && sessions.length >= 10;

  const vehicleMap = new Map(vehicles.map((v) => [v.id, v.nickname]));
  const recentSessions = sessions.slice(0, 3);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-xl font-semibold">Dashboard</h2>
        {hasVehicles ? (
          <>
            <p className="mt-2 text-sm text-zinc-300">
              {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} · {sessions.length}/
              {isFree ? '10' : '∞'} sessions
            </p>
            <div className="mt-4">
              {atSessionLimit ? (
                <Button variant="secondary" disabled fullWidth>
                  Session limit reached — Upgrade to Pro
                </Button>
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

      {recentSessions.length > 0 ? (
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
            {recentSessions.map((s) => (
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
