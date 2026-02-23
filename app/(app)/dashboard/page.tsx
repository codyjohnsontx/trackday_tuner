import Link from 'next/link';
import { getVehicles } from '@/lib/actions/vehicles';
import { Button } from '@/components/ui/button';

export default async function DashboardPage() {
  const vehicles = await getVehicles();
  const hasVehicles = vehicles.length > 0;

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-xl font-semibold">Dashboard</h2>
      {hasVehicles ? (
        <>
          <p className="mt-2 text-sm text-zinc-300">
            {vehicles.length} vehicle{vehicles.length !== 1 ? 's' : ''} in your garage.
          </p>
          <div className="mt-4">
            <Button variant="secondary" disabled>
              New Session (coming soon)
            </Button>
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
  );
}
