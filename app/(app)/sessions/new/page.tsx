import { redirect } from 'next/navigation';
import Link from 'next/link';
import { DemoReadOnlyNotice } from '@/components/demo/read-only-notice';
import { getLatestSessionsByVehicle } from '@/lib/actions/sessions';
import { getVehicles } from '@/lib/actions/vehicles';
import { getTracks } from '@/lib/actions/tracks';
import { isDemoMode } from '@/lib/demo/mode';
import { SessionForm } from '@/components/sessions/session-form';
import { pageTitleClass } from '@/components/ui/page-header';

export default async function NewSessionPage() {
  const [vehicles, tracks, latestSessionsByVehicle, demoMode] = await Promise.all([
    getVehicles(),
    getTracks(),
    getLatestSessionsByVehicle(),
    isDemoMode(),
  ]);

  if (demoMode) {
    return <DemoReadOnlyNotice backHref="/sessions" backLabel="Back to Sessions" />;
  }

  if (vehicles.length === 0) {
    redirect('/garage/new');
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
