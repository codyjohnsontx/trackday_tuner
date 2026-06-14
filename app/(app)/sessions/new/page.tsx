import { redirect } from 'next/navigation';
import Link from 'next/link';
import { DemoReadOnlyNotice } from '@/components/demo/read-only-notice';
import { getLatestSessionsByVehicle } from '@/lib/actions/sessions';
import { getVehicles } from '@/lib/actions/vehicles';
import { getTracks } from '@/lib/actions/tracks';
import { isDemoMode } from '@/lib/demo/mode';
import { SessionForm } from '@/components/sessions/session-form';

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
        <h1 className="text-2xl font-bold text-zinc-100">New Session</h1>
        <div className="mt-0.5 flex items-center justify-between gap-3">
          <p className="text-xs text-zinc-500">Log your track day setup</p>
          <Link href="/tracks" className="text-xs font-medium text-cyan-400 hover:text-cyan-300">
            Manage tracks
          </Link>
        </div>
      </div>
      <SessionForm vehicles={vehicles} tracks={tracks} latestSessionsByVehicle={latestSessionsByVehicle} />
    </div>
  );
}
