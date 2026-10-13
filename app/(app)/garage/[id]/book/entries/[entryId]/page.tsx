import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DemoBanner } from '@/components/demo/demo-banner';
import { ServiceEntryDetails } from '@/components/service-book/service-entry-details';
import { ServiceEntryForm } from '@/components/service-book/service-entry-form';
import { ServiceEntryHistory } from '@/components/service-book/service-entry-history';
import { pageTitleClass } from '@/components/ui/page-header';
import { getServiceBook, getServiceEntryRevisions } from '@/lib/actions/service-book';
import { isDemoMode } from '@/lib/demo/mode';
import { describeEntryItems } from '@/lib/service-book/entry-draft';
import { cn } from '@/lib/utils';

interface ServiceEntryPageProps {
  params: Promise<{ id: string; entryId: string }>;
}

/**
 * One entry: its honest-history labels and revision list above the edit form.
 * A removed entry still opens - its history is the point - but read-only, and
 * the demo's entries are read-only too, with no form on the page at all.
 */
export default async function ServiceEntryPage({ params }: ServiceEntryPageProps) {
  const [{ id, entryId }, demoMode] = await Promise.all([params, isDemoMode()]);
  const result = await getServiceBook(id, { includeRemoved: true });
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
  const data = result.data.data;
  const entry = data?.entries.find((candidate) => candidate.id === entryId);
  if (!data || !entry) notFound();

  const revisions = await getServiceEntryRevisions(id, entryId);
  const editable = !demoMode && entry.deleted_at === null;

  return (
    <div className="space-y-5">
      {demoMode ? <DemoBanner /> : null}
      <div className="px-1">
        <Link href={`/garage/${id}/book`} className="text-sm text-ink-dim hover:text-ink">
          ← Service book
        </Link>
        <h1 className={cn('mt-3', pageTitleClass)}>{describeEntryItems(entry.items) || 'Service entry'}</h1>
        <p className="mt-1 text-sm text-ink-dim">{data.vehicle.nickname}</p>
      </div>

      <ServiceEntryHistory
        vehicleId={id}
        entry={entry}
        revisions={revisions.ok ? revisions.data : []}
        distanceUnit={data.book.distance_unit}
        demoMode={demoMode}
      />

      {editable ? (
        <ServiceEntryForm vehicleId={id} book={data.book} fields={data.fields} items={data.items} entry={entry} />
      ) : (
        <ServiceEntryDetails entry={entry} fields={data.fields} distanceUnit={data.book.distance_unit} />
      )}
    </div>
  );
}
