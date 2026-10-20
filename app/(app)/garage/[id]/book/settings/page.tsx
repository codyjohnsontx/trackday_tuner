import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DemoReadOnlyNotice } from '@/components/demo/read-only-notice';
import { ServiceBookSettings } from '@/components/service-book/service-book-settings';
import { pageTitleClass } from '@/components/ui/page-header';
import { getServiceBook, getServiceBookUnitLocked } from '@/lib/actions/service-book';
import { isDemoMode } from '@/lib/demo/mode';
import { cn } from '@/lib/utils';

interface ServiceBookSettingsPageProps {
  params: Promise<{ id: string }>;
}

export default async function ServiceBookSettingsPage({ params }: ServiceBookSettingsPageProps) {
  const { id } = await params;
  if (await isDemoMode()) {
    return <DemoReadOnlyNotice backHref={`/garage/${id}/book`} backLabel="Back to the service book" />;
  }

  const result = await getServiceBook(id);
  if (!result.ok && result.error === 'Vehicle not found.') notFound();
  if (!result.ok) {
    return (
      <section className="rounded-card bg-surface p-5">
        <p className="text-sm text-slower" role="alert">
          {result.error}
        </p>
      </section>
    );
  }
  // A sold bike's book takes no settings edit (owner, TQ3).
  if (result.data.data === null || result.data.vehicle.sold_at !== null) redirect(`/garage/${id}/book`);
  const { book, fields, items, vehicle } = result.data.data;
  const unitLocked = await getServiceBookUnitLocked(id);
  if (!unitLocked.ok) {
    return (
      <section className="rounded-card bg-surface p-5">
        <p className="text-sm text-slower" role="alert">
          {unitLocked.error}
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <div className="px-1">
        <Link href={`/garage/${id}/book`} className="text-sm text-ink-dim hover:text-ink">
          ← Service book
        </Link>
        <h1 className={cn('mt-3', pageTitleClass)}>Book settings</h1>
        <p className="mt-1 text-sm text-ink-dim">{vehicle.nickname}</p>
      </div>
      <ServiceBookSettings vehicleId={id} book={book} fields={fields} items={items} unitLocked={unitLocked.data} />
    </div>
  );
}
