import Link from 'next/link';
import { getTracks } from '@/lib/actions/tracks';
import { getUserProfile } from '@/lib/actions/vehicles';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { DemoBanner } from '@/components/demo/demo-banner';
import { isDemoMode } from '@/lib/demo/mode';
import { TrackListClient } from '@/components/tracks/track-list-client';
import { Button } from '@/components/ui/button';
import { resolveUserAccess } from '@/lib/access';

export default async function TracksPage() {
  const [tracks, profile, demoMode] = await Promise.all([getTracks(), getUserProfile(), isDemoMode()]);
  const customTracks = tracks.filter((track) => !track.is_seeded);
  const isFree = !resolveUserAccess(profile).hasProAccess;
  const atTrackLimit = isFree && customTracks.length >= 3;

  return (
    <div className="space-y-5">
      {demoMode ? <DemoBanner /> : null}

      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-zinc-100">Tracks</h1>
          <p className="mt-0.5 text-xs text-zinc-500">
            Seeded tracks are shared. Add custom tracks for your own logging flow.
          </p>
        </div>
        {atTrackLimit || demoMode ? null : (
          <Link href="/tracks/new">
            <Button variant="primary" className="min-h-10 px-3 text-sm">
              + New Track
            </Button>
          </Link>
        )}
      </div>

      {atTrackLimit && !demoMode ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 text-center">
          <p className="text-sm font-semibold text-zinc-200">Track limit reached</p>
          <p className="mt-1 text-sm text-zinc-400">
            Free plan is limited to 3 tracks. Upgrade to Pro for unlimited tracks.
          </p>
          <div className="mt-4">
            <UpgradeToProButton fullWidth />
          </div>
        </section>
      ) : null}

      <TrackListClient tracks={tracks} demoMode={demoMode} />

      <Link href="/sessions/new" className="block text-center text-sm text-cyan-400 hover:text-cyan-300">
        Back to New Session
      </Link>
    </div>
  );
}
