import Link from 'next/link';
import { getTracks } from '@/lib/actions/tracks';
import { getUserProfile } from '@/lib/actions/vehicles';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { TrackListClient } from '@/components/tracks/track-list-client';
import { Button } from '@/components/ui/button';
import { getFreePlanLimit, getFreePlanLimitMessage } from '@/lib/plans';

export default async function TracksPage() {
  const [tracks, profile] = await Promise.all([getTracks(), getUserProfile()]);
  const customTracks = tracks.filter((track) => !track.is_seeded);
  const isFree = !profile || profile.tier === 'free';
  const atTrackLimit = isFree && customTracks.length >= getFreePlanLimit('tracks');

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Tracks</h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            Built-in tracks are shared. Add your own for local circuits or private events.
          </p>
        </div>
        {atTrackLimit ? null : (
          <Link href="/tracks/new">
            <Button variant="primary" className="min-h-10 px-3 text-sm">
              + New Track
            </Button>
          </Link>
        )}
      </div>

      {atTrackLimit ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <p className="text-sm font-semibold text-zinc-200">Track limit reached</p>
          <p className="mt-1 text-sm text-zinc-400">
            {getFreePlanLimitMessage('tracks')}
          </p>
          <div className="mt-4">
            <UpgradeToProButton fullWidth />
          </div>
        </section>
      ) : null}

      <TrackListClient tracks={tracks} />

    </div>
  );
}
