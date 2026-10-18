import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DemoReadOnlyNotice } from '@/components/demo/read-only-notice';
import { ServiceBookHandoverForm } from '@/components/service-book/service-book-handover-form';
import { SoldBanner } from '@/components/service-book/sold-banner';
import { pageTitleClass } from '@/components/ui/page-header';
import { getServiceBook } from '@/lib/actions/service-book';
import { getServiceBookHandover, getServiceBookHandoverCounts } from '@/lib/actions/service-book-transfers';
import { isDemoMode } from '@/lib/demo/mode';
import { cn } from '@/lib/utils';

interface ServiceBookHandoverPageProps {
  params: Promise<{ id: string }>;
}

/**
 * The seller's handover screen (owner, PQ2). Demo offers none: the demo is a
 * tour, and a handover is the one write that ends a bike's life in a garage.
 * A bike already handed over shows its sold state; otherwise the form, which
 * shows the one pending link with Cancel instead of itself while a link is
 * out (TQ4).
 */
export default async function ServiceBookHandoverPage({ params }: ServiceBookHandoverPageProps) {
  const { id } = await params;
  if (await isDemoMode()) {
    return <DemoReadOnlyNotice backHref={`/garage/${id}/book`} backLabel="Back to the service book" />;
  }

  const [result, handover, counts] = await Promise.all([getServiceBook(id), getServiceBookHandover(id), getServiceBookHandoverCounts(id)]);
  if (!result.ok && result.error === 'Vehicle not found.') notFound();
  const failure = !result.ok ? result.error : !handover.ok ? handover.error : !counts.ok ? counts.error : null;
  if (failure !== null || !result.ok || !handover.ok || !counts.ok) {
    return (
      <section className="rounded-card bg-surface p-5">
        <p className="text-sm text-slower" role="alert">
          {failure}
        </p>
      </section>
    );
  }
  if (result.data.data === null) redirect(`/garage/${id}/book`);
  const { vehicle } = result.data;

  return (
    <div className="space-y-5">
      <div className="px-1">
        <Link href={`/garage/${id}/book`} className="text-sm text-ink-dim hover:text-ink">
          ← Service book
        </Link>
        <h1 className={cn('mt-3', pageTitleClass)}>Hand over to a buyer</h1>
        <p className="mt-1 text-sm text-ink-dim">{vehicle.nickname}</p>
      </div>

      {vehicle.sold_at !== null ? (
        <SoldBanner soldAt={vehicle.sold_at} />
      ) : (
        <ServiceBookHandoverForm vehicleId={id} nickname={vehicle.nickname} data={result.data.data} extra={counts.data} pending={handover.data} />
      )}
    </div>
  );
}
