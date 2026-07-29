import Link from 'next/link';
import { redirect } from 'next/navigation';
import { DemoBanner } from '@/components/demo/demo-banner';
import { getTrack } from '@/lib/actions/tracks';
import { isDemoMode } from '@/lib/demo/mode';
import { TrackForm } from '@/components/tracks/track-form';
import { TrackDeleteForm } from '@/components/tracks/track-delete-form';
import { pageTitleClass } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';

interface TrackDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TrackDetailPage({ params }: TrackDetailPageProps) {
  const { id } = await params;
  const [result, demoMode] = await Promise.all([getTrack(id), isDemoMode()]);

  if (!result.ok) {
    redirect('/tracks');
  }

  const track = result.data;
  const isCustom = !track.is_seeded;

  return (
    <div className="space-y-5">
      {demoMode ? <DemoBanner /> : null}

      <div>
        <Link href="/tracks" className="text-sm text-ink-dim hover:text-ink">
          ← Tracks
        </Link>
        <h1 className={cn('mt-3', pageTitleClass)}>{track.name}</h1>
        <p className="mt-1 text-sm text-ink-dim">{track.location ?? 'No location provided.'}</p>
        <span className="mt-2 inline-flex rounded-plate bg-surface-2 px-2 py-1 text-xs text-ink-dim">
          {isCustom ? 'Custom Track' : 'Global Read-only Track'}
        </span>
      </div>

      {isCustom && !demoMode ? (
        <section className="space-y-4 rounded-card bg-surface p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">Edit Track</h2>
          <TrackForm initialTrack={track} onSuccessPath={`/tracks/${track.id}`} />
          <TrackDeleteForm trackId={track.id} />
        </section>
      ) : (
        <section className="rounded-card bg-surface p-4">
          <p className="text-sm text-ink-dim">
            {demoMode ? 'Demo mode is read-only. Start a real account to edit tracks.' : 'This is a seeded global track and is read-only.'}
          </p>
        </section>
      )}

      <section className="rounded-card bg-surface p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-ink-dim">Recent Sessions</h2>
        <p className="mt-3 text-sm text-ink-faint">
          Session history for this track will appear here. Use session logging to populate this view.
        </p>
      </section>
    </div>
  );
}
