import Link from 'next/link';
import { DemoReadOnlyNotice } from '@/components/demo/read-only-notice';
import { TrackForm } from '@/components/tracks/track-form';
import { isDemoMode } from '@/lib/demo/mode';
import { pageTitleClass } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';

export default async function NewTrackPage() {
  if (await isDemoMode()) {
    return <DemoReadOnlyNotice backHref="/tracks" backLabel="Back to Tracks" />;
  }

  return (
    <div className="space-y-5">
      <div>
        <Link href="/tracks" className="text-sm text-ink-dim hover:text-ink">
          ← Tracks
        </Link>
        <h1 className={cn('mt-3', pageTitleClass)}>Add Track</h1>
        <p className="mt-1 text-sm text-ink-dim">
          Create a custom track you can use in session logging.
        </p>
      </div>

      <section className="rounded-card bg-surface p-4">
        <TrackForm onSuccessPath="/tracks" />
      </section>
    </div>
  );
}
