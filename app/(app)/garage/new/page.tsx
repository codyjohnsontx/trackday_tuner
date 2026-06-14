import Link from 'next/link';
import { DemoReadOnlyNotice } from '@/components/demo/read-only-notice';
import { VehicleForm } from '@/components/garage/vehicle-form';
import { isDemoMode } from '@/lib/demo/mode';

export default async function NewVehiclePage() {
  if (await isDemoMode()) {
    return <DemoReadOnlyNotice backHref="/garage" backLabel="Back to Garage" />;
  }

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/garage"
          className="text-sm text-zinc-400 hover:text-zinc-200"
        >
          ← Garage
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-zinc-100">Add Vehicle</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Give your vehicle a nickname and fill in optional details.
        </p>
      </div>

      <VehicleForm />
    </div>
  );
}
