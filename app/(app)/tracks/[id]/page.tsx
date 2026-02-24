import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getTrack } from '@/lib/actions/tracks';
import { TrackForm } from '@/components/tracks/track-form';
import { TrackDeleteForm } from '@/components/tracks/track-delete-form';

interface TrackDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function TrackDetailPage({ params }: TrackDetailPageProps) {
  const { id } = await params;
  const result = await getTrack(id);

  if (!result.ok) {
    redirect('/tracks');
  }

  const track = result.data;
  const isCustom = !track.is_seeded;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/tracks" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Tracks
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-zinc-100">{track.name}</h1>
        <p className="mt-1 text-sm text-zinc-400">{track.location ?? 'No location provided.'}</p>
        <span className="mt-2 inline-flex rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-300">
          {isCustom ? 'Custom Track' : 'Global Read-only Track'}
        </span>
      </div>

      {isCustom ? (
        <section className="space-y-4 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Edit Track</h2>
          <TrackForm initialTrack={track} onSuccessPath={`/tracks/${track.id}`} />
          <TrackDeleteForm trackId={track.id} />
        </section>
      ) : (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <p className="text-sm text-zinc-400">
            This is a seeded global track and is read-only.
          </p>
        </section>
      )}

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Recent Sessions</h2>
        <p className="mt-3 text-sm text-zinc-500">
          Session history for this track will appear here. Use session logging to populate this view.
        </p>
      </section>
    </div>
  );
}
