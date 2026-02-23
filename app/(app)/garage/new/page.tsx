import Link from 'next/link';
import { VehicleForm } from '@/components/garage/vehicle-form';

export default function NewVehiclePage() {
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
