import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getVehicle } from '@/lib/actions/vehicles';
import { VehicleForm } from '@/components/garage/vehicle-form';

interface EditVehiclePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditVehiclePage({ params }: EditVehiclePageProps) {
  const { id } = await params;
  const result = await getVehicle(id);

  if (!result.ok) {
    redirect('/garage');
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
        <h1 className="mt-3 text-2xl font-bold text-zinc-100">Edit Vehicle</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Update details for {result.data.nickname}.
        </p>
      </div>

      <VehicleForm vehicle={result.data} />
    </div>
  );
}
