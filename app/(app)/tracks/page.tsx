import Link from 'next/link';
import { getTracks } from '@/lib/actions/tracks';
import { getUserProfile } from '@/lib/actions/vehicles';
import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { DemoBanner } from '@/components/demo/demo-banner';
import { isDemoMode } from '@/lib/demo/mode';
import { TrackListClient } from '@/components/tracks/track-list-client';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { resolveUserAccess } from '@/lib/access';

export default async function TracksPage() {
  const [tracks, profile, demoMode] = await Promise.all([getTracks(), getUserProfile(), isDemoMode()]);
  const customTracks = tracks.filter((track) => !track.is_seeded);
  const isFree = !resolveUserAccess(profile).hasProAccess;
  const atTrackLimit = isFree && customTracks.length >= 3;

  return (
    <div className="space-y-5">
      {demoMode ? <DemoBanner /> : null}

      <PageHeader
        title="Tracks"
        sub="Seeded tracks are shared. Add custom tracks for your own logging flow."
        action={
          atTrackLimit || demoMode ? null : (
            <Button asChild variant="primary" className="min-h-10 px-4 text-sm">
              <Link href="/tracks/new">+ New Track</Link>
            </Button>
          )
        }
      />

      {atTrackLimit && !demoMode ? (
        <section className="rounded-card bg-surface p-4 text-center">
          <p className="text-sm font-semibold text-ink">Track limit reached</p>
          <p className="mt-1 text-sm text-ink-dim">
            Free plan is limited to 3 tracks. Upgrade to Pro for unlimited tracks.
          </p>
          <div className="mt-4">
            <UpgradeToProButton fullWidth />
          </div>
        </section>
      ) : null}

      <TrackListClient tracks={tracks} demoMode={demoMode} />

      <Link
        href="/sessions/new"
        className="block text-center text-sm text-ink-dim transition hover:text-ink"
      >
        Back to New Session
      </Link>
    </div>
  );
}
