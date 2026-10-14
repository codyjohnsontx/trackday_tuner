import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DemoBanner } from '@/components/demo/demo-banner';
import { ServiceEntryAttachments } from '@/components/service-book/service-entry-attachments';
import { ServiceEntryDetails } from '@/components/service-book/service-entry-details';
import { ServiceEntryForm } from '@/components/service-book/service-entry-form';
import { ServiceEntryHistory } from '@/components/service-book/service-entry-history';
import { pageTitleClass } from '@/components/ui/page-header';
import { resolveUserAccess } from '@/lib/access';
import { getServiceAttachmentLinks } from '@/lib/actions/service-attachments';
import { getServiceBook, getServiceEntryRevisions } from '@/lib/actions/service-book';
import { getUserProfile } from '@/lib/actions/vehicles';
import { isDemoMode } from '@/lib/demo/mode';
import { isAtFreePlanLimit } from '@/lib/plans';
import { describeEntryItems } from '@/lib/service-book/entry-draft';
import { cn } from '@/lib/utils';

interface ServiceEntryPageProps {
  params: Promise<{ id: string; entryId: string }>;
}

/**
 * One entry: its honest-history labels and revision list, its receipts and
 * photos, then the edit form. A removed entry still opens - its history is the
 * point - but read-only, and the demo's entries are read-only too, with no form
 * and no upload on the page at all.
 */
export default async function ServiceEntryPage({ params }: ServiceEntryPageProps) {
  const { id, entryId } = await params;
  // Every read starts at once: none needs another's answer, and each adds a
  // round trip to the page a rider opens straight after saving.
  const [demoMode, result, revisions, links, profile] = await Promise.all([
    isDemoMode(),
    getServiceBook(id, { entryId }),
    getServiceEntryRevisions(id, entryId),
    getServiceAttachmentLinks(id, entryId),
    getUserProfile(),
  ]);
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

  const editable = !demoMode && entry.deleted_at === null;
  // The rider's own layout decides whether attachments are asked for; ones
  // already attached are shown whatever it says.
  const attachmentsAsked = data.fields.some((field) => field.builtin_key === 'attachments' && field.enabled);
  const hasProAccess = resolveUserAccess(profile).hasProAccess;
  const canUpload = editable && attachmentsAsked;
  const attachmentLinks = links.ok ? links.data : null;

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

      {canUpload || attachmentLinks === null || attachmentLinks.length > 0 ? (
        <ServiceEntryAttachments
          vehicleId={id}
          entryId={entryId}
          links={attachmentLinks}
          canUpload={canUpload}
          atLimit={isAtFreePlanLimit('attachments', data.attachmentCount, hasProAccess)}
          hasProAccess={hasProAccess}
        />
      ) : null}

      {editable ? (
        <ServiceEntryForm vehicleId={id} book={data.book} fields={data.fields} items={data.items} entry={entry} />
      ) : (
        <ServiceEntryDetails entry={entry} fields={data.fields} distanceUnit={data.book.distance_unit} />
      )}
    </div>
  );
}
