import { redirect } from 'next/navigation';
import Link from 'next/link';
import { DemoReadOnlyNotice } from '@/components/demo/read-only-notice';
import { getUserProfile, getVehicle, getVehicleDeletionCounts } from '@/lib/actions/vehicles';
import { resolveUserAccess } from '@/lib/access';
import { hasServiceBook } from '@/lib/actions/service-book-transfers';
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

  const [counts, profile, hasBook] = await Promise.all([getVehicleDeletionCounts(id), getUserProfile(), hasServiceBook(id)]);

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
          <VehicleDeleteForm
            vehicleId={result.data.id}
            nickname={result.data.nickname}
            counts={counts.data}
            sold={result.data.sold_at !== null}
            freePlan={!resolveUserAccess(profile).hasProAccess}
          />
        ) : (
          <p className="text-sm text-slower" role="alert">{counts.error}</p>
        )}
      </section>

      {result.data.sold_at === null && hasBook ? (
        <section className="rounded-card bg-surface p-4">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-faint">Selling it?</h2>
          <p className="text-sm text-ink-dim">
            Hand the service book and the sessions to the buyer instead of deleting them. You keep a read-only copy of everything up to
            the handover.
          </p>
          <Link
            href={`/garage/${result.data.id}/book/handover`}
            className="mt-3 inline-flex min-h-11 items-center justify-center rounded-control bg-surface-3 px-4 text-sm font-semibold text-ink transition hover:bg-surface-3/70 focus-visible:ring-2 focus-visible:ring-signal/80"
          >
            Hand over to a buyer
          </Link>
        </section>
      ) : null}
    </div>
  );
}
