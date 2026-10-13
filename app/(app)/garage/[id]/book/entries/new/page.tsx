import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { DemoReadOnlyNotice } from '@/components/demo/read-only-notice';
import { ServiceEntryForm } from '@/components/service-book/service-entry-form';
import { pageTitleClass } from '@/components/ui/page-header';
import { getServiceBook } from '@/lib/actions/service-book';
import { isDemoMode } from '@/lib/demo/mode';
import { cn } from '@/lib/utils';

interface NewServiceEntryPageProps {
  params: Promise<{ id: string }>;
}

export default async function NewServiceEntryPage({ params }: NewServiceEntryPageProps) {
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
  if (result.data.data === null) redirect(`/garage/${id}/book`);
  const { book, fields, items, vehicle } = result.data.data;

  return (
    <div className="space-y-5">
      <div className="px-1">
        <Link href={`/garage/${id}/book`} className="text-sm text-ink-dim hover:text-ink">
          ← Service book
        </Link>
        <h1 className={cn('mt-3', pageTitleClass)}>Log service</h1>
        <p className="mt-1 text-sm text-ink-dim">{vehicle.nickname}</p>
      </div>
      <ServiceEntryForm vehicleId={id} book={book} fields={fields} items={items} />
    </div>
  );
}
