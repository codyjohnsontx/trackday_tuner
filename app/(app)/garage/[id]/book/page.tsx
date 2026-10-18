import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DemoBanner } from '@/components/demo/demo-banner';
import { ServiceBookHandoverCard } from '@/components/service-book/service-book-handover-card';
import { ServiceBookScreen } from '@/components/service-book/service-book-screen';
import { ServiceBookExport } from '@/components/service-book/service-book-export';
import { ServiceBookSharing } from '@/components/service-book/service-book-sharing';
import { ServiceBookSetup } from '@/components/service-book/service-book-setup';
import { pageTitleClass } from '@/components/ui/page-header';
import { getServiceBook } from '@/lib/actions/service-book';
import { getServiceBookShares } from '@/lib/actions/service-book-shares';
import { getServiceBookHandover } from '@/lib/actions/service-book-transfers';
import { isDemoMode } from '@/lib/demo/mode';
import { describePdfOffer } from '@/lib/service-book/pdf-plan';
import { serviceYearOf } from '@/lib/service-book/shared-view';
import { cn } from '@/lib/utils';

interface ServiceBookPageProps {
  params: Promise<{ id: string }>;
}

export default async function ServiceBookPage({ params }: ServiceBookPageProps) {
  const [{ id }, demoMode] = await Promise.all([params, isDemoMode()]);
  const result = await getServiceBook(id);

  if (!result.ok && result.error === 'Vehicle not found.') notFound();
  // Demo is a tour, so it offers no link to make (CLAUDE.md, "The Demo Is Read-Only").
  const [shares, handover] =
    result.ok && result.data.data && !demoMode ? await Promise.all([getServiceBookShares(id), getServiceBookHandover(id)]) : [null, null];
  // A sold bike's book is the seller's read-only copy (owner, TQ3): no
  // settings to edit, no handover to make, and the pending-link line is gone
  // with the link that was accepted.
  const sold = result.ok && result.data.vehicle.sold_at !== null;
  // The export prints the rows the book holds, and the demo's book is code, not rows.
  const pdfOffer =
    result.ok && result.data.data && !demoMode
      ? describePdfOffer(
          result.data.data.entries
            .filter((entry) => entry.deleted_at === null)
            .map((entry) => ({ serviceYear: serviceYearOf(entry.service_date), attachments: entry.attachments })),
        )
      : null;

  return (
    <div className="space-y-5">
      {demoMode ? <DemoBanner /> : null}

      <header className="flex items-start justify-between gap-4 px-1">
        <div className="min-w-0">
          <Link href="/garage" className="text-sm text-ink-dim hover:text-ink">
            ← Garage
          </Link>
          <h1 className={cn('mt-3', pageTitleClass)}>Service book</h1>
          {result.ok ? <p className="mt-1 text-sm text-ink-dim">{result.data.vehicle.nickname}</p> : null}
        </div>
        {result.ok && result.data.data && !demoMode && !sold ? (
          <Link
            href={`/garage/${id}/book/settings`}
            className="flex min-h-11 shrink-0 items-center rounded-control bg-surface-3 px-3 text-xs font-semibold text-ink-dim transition hover:bg-surface-3/70 hover:text-ink focus-visible:ring-2 focus-visible:ring-signal/80"
          >
            Settings
          </Link>
        ) : null}
      </header>

      {!result.ok ? (
        <section className="rounded-card bg-surface p-5">
          <p className="text-sm text-slower" role="alert">
            {result.error}
          </p>
        </section>
      ) : result.data.data === null ? (
        <ServiceBookSetup vehicleId={id} nickname={result.data.vehicle.nickname} vehicleType={result.data.vehicle.type} />
      ) : (
        <ServiceBookScreen data={result.data.data} demoMode={demoMode} />
      )}

      {shares ? <ServiceBookSharing vehicleId={id} shares={shares} /> : null}
      {handover && !sold ? <ServiceBookHandoverCard vehicleId={id} handover={handover} /> : null}
      {pdfOffer ? <ServiceBookExport base={`/api/service-book/vehicles/${id}/pdf`} offer={pdfOffer} audience="owner" /> : null}
    </div>
  );
}
