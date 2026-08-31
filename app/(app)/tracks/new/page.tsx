import Link from 'next/link';
import { PlanLimitNotice } from '@/components/billing/plan-limit-notice';
import { DemoReadOnlyNotice } from '@/components/demo/read-only-notice';
import { TrackForm } from '@/components/tracks/track-form';
import { isDemoMode } from '@/lib/demo/mode';
import { getTracks } from '@/lib/actions/tracks';
import { getUserProfile } from '@/lib/actions/vehicles';
import { resolveUserAccess } from '@/lib/access';
import { isAtFreePlanLimit } from '@/lib/plans';
import { pageTitleClass } from '@/components/ui/page-header';
import { cn } from '@/lib/utils';

export default async function NewTrackPage() {
  const [demoMode, tracks, profile] = await Promise.all([
    isDemoMode(),
    getTracks(),
    getUserProfile(),
  ]);

  if (demoMode) {
    return <DemoReadOnlyNotice backHref="/tracks" backLabel="Back to Tracks" />;
  }

  // The limit counts the rider's own tracks; the seeded ones are shared, which
  // is the same split /tracks and resolveSessionTrack already count on.
  const customTrackCount = tracks.filter((track) => !track.is_seeded).length;

  if (isAtFreePlanLimit('tracks', customTrackCount, resolveUserAccess(profile).hasProAccess)) {
    return (
      <PlanLimitNotice
        resource="tracks"
        backHref="/tracks"
        backLabel="Back to Tracks"
        hint="Seeded tracks stay available, and you can still type any circuit name when logging a session."
      />
    );
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
