import Link from 'next/link';
import { getVehicles, getUserProfile } from '@/lib/actions/vehicles';
import { VehicleCard } from '@/components/garage/vehicle-card';
import { Button } from '@/components/ui/button';

export default async function GaragePage() {
  const [vehicles, profile] = await Promise.all([getVehicles(), getUserProfile()]);

  const isFree = !profile || profile.tier === 'free';
  const atLimit = isFree && vehicles.length >= 1;

  const tierLabel = isFree
    ? `Free plan · ${vehicles.length}/1 vehicle`
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
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-6 text-center">
          <p className="text-sm text-zinc-400">No vehicles yet.</p>
          <p className="mt-1 text-sm text-zinc-500">Add your first vehicle to start logging sessions.</p>
          <div className="mt-4">
            <Link href="/garage/new">
              <Button fullWidth>Add Your First Vehicle</Button>
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
          <p className="text-sm font-semibold text-zinc-200">Want more vehicles?</p>
          <p className="mt-1 text-sm text-zinc-400">
            Upgrade to Pro for unlimited vehicles, full session history, and AI-powered tuning suggestions.
          </p>
          <div className="mt-4">
            <Button variant="secondary" fullWidth disabled>
              Upgrade to Pro (coming soon)
            </Button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
