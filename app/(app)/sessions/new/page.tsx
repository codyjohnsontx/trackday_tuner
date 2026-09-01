import { redirect } from 'next/navigation';
import Link from 'next/link';
import { PlanLimitNotice } from '@/components/billing/plan-limit-notice';
import { DemoReadOnlyNotice } from '@/components/demo/read-only-notice';
import { getLatestSessionsByVehicle, getSessionCount } from '@/lib/actions/sessions';
import { getUserProfile, getVehicles } from '@/lib/actions/vehicles';
import { getTracks } from '@/lib/actions/tracks';
import { isDemoMode } from '@/lib/demo/mode';
import { resolveUserAccess } from '@/lib/access';
import { isAtFreePlanLimit } from '@/lib/plans';
import { SessionForm } from '@/components/sessions/session-form';
import { pageTitleClass } from '@/components/ui/page-header';

export default async function NewSessionPage() {
  const [vehicles, tracks, latestSessionsByVehicle, demoMode, profile, sessionCount] =
    await Promise.all([
      getVehicles(),
      getTracks(),
      getLatestSessionsByVehicle(),
      isDemoMode(),
      getUserProfile(),
      getSessionCount(),
    ]);

  if (demoMode) {
    return <DemoReadOnlyNotice backHref="/sessions" backLabel="Back to Sessions" />;
  }

  if (vehicles.length === 0) {
    redirect('/garage/new');
  }

  // createSession refuses past the free limit, so rendering the form here only
  // buys the rider a screenful of typing they cannot keep - and the refusal it
  // answers with lands thousands of pixels below the sticky Save button they
  // tapped. The same count the action enforces decides it, through the one
  // helper in lib/plans.ts.
  if (isAtFreePlanLimit('sessions', sessionCount, resolveUserAccess(profile).hasProAccess)) {
    return (
      <PlanLimitNotice
        resource="sessions"
        backHref="/sessions"
        backLabel="Back to Sessions"
        // Not "delete one to free a slot": this app has no delete control on a
        // session yet, and a hint naming something the rider cannot find is the
        // trap it exists to avoid.
        hint="Everything you have already logged stays readable."
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className={pageTitleClass}>New Session</h1>
        <div className="mt-0.5 flex items-center justify-between gap-3">
          <p className="text-xs text-ink-faint">Log your track day setup</p>
          <Link href="/tracks" className="text-xs font-medium text-signal hover:text-signal">
            Manage tracks
          </Link>
        </div>
      </div>
      <SessionForm vehicles={vehicles} tracks={tracks} latestSessionsByVehicle={latestSessionsByVehicle} />
    </div>
  );
}
