import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DemoBanner } from '@/components/demo/demo-banner';
import { ServiceBookScreen } from '@/components/service-book/service-book-screen';
import { ServiceBookSharing } from '@/components/service-book/service-book-sharing';
import { ServiceBookSetup } from '@/components/service-book/service-book-setup';
import { pageTitleClass } from '@/components/ui/page-header';
import { getServiceBook } from '@/lib/actions/service-book';
import { getServiceBookShares } from '@/lib/actions/service-book-shares';
import { isDemoMode } from '@/lib/demo/mode';
import { cn } from '@/lib/utils';

interface ServiceBookPageProps {
  params: Promise<{ id: string }>;
}

export default async function ServiceBookPage({ params }: ServiceBookPageProps) {
  const [{ id }, demoMode] = await Promise.all([params, isDemoMode()]);
  const result = await getServiceBook(id);

  if (!result.ok && result.error === 'Vehicle not found.') notFound();
  // Demo is a tour, so it offers no link to make (CLAUDE.md, "The Demo Is Read-Only").
  const shares = result.ok && result.data.data && !demoMode ? await getServiceBookShares(id) : null;

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
        {result.ok && result.data.data && !demoMode ? (
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
    </div>
  );
}
