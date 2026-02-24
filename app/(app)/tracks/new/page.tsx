import Link from 'next/link';
import { TrackForm } from '@/components/tracks/track-form';

export default function NewTrackPage() {
  return (
    <div className="space-y-5">
      <div>
        <Link href="/tracks" className="text-sm text-zinc-400 hover:text-zinc-200">
          ← Tracks
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-zinc-100">Add Track</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Create a custom track you can use in session logging.
        </p>
      </div>

      <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <TrackForm onSuccessPath="/tracks" />
      </section>
    </div>
  );
}
