import Link from 'next/link';
import { getTracks } from '@/lib/actions/tracks';
import { TrackForm } from '@/components/tracks/track-form';

export default async function TracksPage() {
  const tracks = await getTracks();
  const seededTracks = tracks.filter((track) => track.is_seeded);
  const customTracks = tracks.filter((track) => !track.is_seeded);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">Tracks</h1>
        <p className="mt-0.5 text-xs text-zinc-500">
          Seeded tracks are shared. Add custom tracks for your own logging flow.
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Add Custom Track</h2>
        <div className="mt-3">
          <TrackForm />
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Your Custom Tracks</h2>
          <span className="text-xs text-zinc-500">{customTracks.length}</span>
        </div>

        {customTracks.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-500">No custom tracks yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {customTracks.map((track) => (
              <li key={track.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
                <p className="text-sm font-medium text-zinc-100">{track.name}</p>
                {track.location ? <p className="text-xs text-zinc-400">{track.location}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Seeded Tracks</h2>
          <span className="text-xs text-zinc-500">{seededTracks.length}</span>
        </div>

        <ul className="mt-3 space-y-2">
          {seededTracks.map((track) => (
            <li key={track.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-3">
              <p className="text-sm font-medium text-zinc-100">{track.name}</p>
              {track.location ? <p className="text-xs text-zinc-400">{track.location}</p> : null}
            </li>
          ))}
        </ul>
      </section>

      <Link href="/sessions/new" className="block text-center text-sm text-cyan-400 hover:text-cyan-300">
        Back to New Session
      </Link>
    </div>
  );
}
