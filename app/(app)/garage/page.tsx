import Link from 'next/link';
import { getVehicles, getUserProfile } from '@/lib/actions/vehicles';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { VehicleCard } from '@/components/garage/vehicle-card';
import { Button } from '@/components/ui/button';
import { formatFreePlanUsage, getFreePlanLimit } from '@/lib/plans';

export default async function GaragePage() {
  const [vehicles, profile] = await Promise.all([getVehicles(), getUserProfile()]);

  const isFree = !profile || profile.tier === 'free';
  const atLimit = isFree && vehicles.length >= getFreePlanLimit('vehicles');

  const tierLabel = isFree
    ? formatFreePlanUsage('vehicles', vehicles.length)
    : `Pro plan · ${vehicles.length} vehicle${vehicles.length !== 1 ? 's' : ''}`;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Garage</h1>
          <p className="mt-0.5 text-xs text-zinc-500">{tierLabel}</p>
        </div>
        {!atLimit ? (
          <Link href="/garage/new">
            <Button variant="primary" className="min-h-10 px-3 text-sm">
              + Add Vehicle
            </Button>
          </Link>
        ) : null}
      </div>

      {vehicles.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-zinc-700 bg-zinc-950/50 p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-zinc-700 bg-zinc-900 text-zinc-500">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="h-6 w-6">
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 0 1-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 0 0-3.213-9.193 2.056 2.056 0 0 0-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 0 0-10.026 0 1.106 1.106 0 0 0-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
            </svg>
          </div>
          <p className="text-sm font-semibold text-zinc-300">Your garage is empty</p>
          <p className="mt-1 text-sm text-zinc-500">Add your first machine to start building your setup history.</p>
          <div className="mt-4">
            <Link href="/garage/new">
              <Button fullWidth>Add Your First Machine</Button>
            </Link>
          </div>
        </section>
      ) : (
        <ul className="space-y-3">
          {vehicles.map((v) => (
            <VehicleCard key={v.id} vehicle={v} />
          ))}
        </ul>
      )}

      {atLimit ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <p className="text-sm font-semibold text-zinc-200">Garage full on the free plan</p>
          <p className="mt-1 text-sm text-zinc-400">
            Upgrade to Factory for unlimited machines, full session history, and AI tuning advice.
          </p>
          <div className="mt-4">
            <UpgradeToProButton fullWidth />
          </div>
        </section>
      ) : null}
    </div>
  );
}
