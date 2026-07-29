import { redirect } from 'next/navigation';
import Link from 'next/link';
import { DemoReadOnlyNotice } from '@/components/demo/read-only-notice';
import { getVehicle } from '@/lib/actions/vehicles';
import { isDemoMode } from '@/lib/demo/mode';
import { VehicleForm } from '@/components/garage/vehicle-form';
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
    </div>
  );
}
