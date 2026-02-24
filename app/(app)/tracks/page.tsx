import Link from 'next/link';
import { getTracks } from '@/lib/actions/tracks';
import { TrackListClient } from '@/components/tracks/track-list-client';
import { Button } from '@/components/ui/button';

export default async function TracksPage() {
  const tracks = await getTracks();

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Tracks</h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            Seeded tracks are shared. Add custom tracks for your own logging flow.
          </p>
        </div>
        <Link href="/tracks/new">
          <Button variant="primary" className="min-h-10 px-3 text-sm">
            + New Track
          </Button>
        </Link>
      </div>

      <TrackListClient tracks={tracks} />

      <Link href="/sessions/new" className="block text-center text-sm text-cyan-400 hover:text-cyan-300">
        Back to New Session
      </Link>
    </div>
  );
}
