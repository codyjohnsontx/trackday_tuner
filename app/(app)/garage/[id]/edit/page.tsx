import { redirect } from 'next/navigation';
import Link from 'next/link';
import { DemoReadOnlyNotice } from '@/components/demo/read-only-notice';
import { getVehicle, getVehicleDeletionCounts } from '@/lib/actions/vehicles';
import { isDemoMode } from '@/lib/demo/mode';
import { VehicleForm } from '@/components/garage/vehicle-form';
import { VehicleDeleteForm } from '@/components/garage/vehicle-delete-form';
import { pageTitleClass } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';

interface EditVehiclePageProps {
  params: Promise<{ id: string }>;
}

export default async function EditVehiclePage({ params }: EditVehiclePageProps) {
  if (await isDemoMode()) {
    return <DemoReadOnlyNotice backHref="/garage" backLabel="Back to Garage" />;
  }

  const { id } = await params;
  const result = await getVehicle(id);

  if (!result.ok) {
    redirect('/garage');
  }

  const counts = await getVehicleDeletionCounts(id);

  return (
    <div className="space-y-5">
      <div>
        <Link
          href="/garage"
          className="text-sm text-ink-dim hover:text-ink"
        >
          ← Garage
        </Link>
        <h1 className={cn('mt-3', pageTitleClass)}>Edit Vehicle</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Update details for {result.data.nickname}.
        </p>
      </div>

      <VehicleForm vehicle={result.data} />

      <section className="rounded-card bg-surface p-4">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-faint">Delete Vehicle</h2>
        {counts.ok ? (
          <VehicleDeleteForm vehicleId={result.data.id} nickname={result.data.nickname} counts={counts.data} />
        ) : (
          <p className="text-sm text-slower" role="alert">{counts.error}</p>
        )}
      </section>
    </div>
  );
}
