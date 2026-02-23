import { redirect } from 'next/navigation';
import Link from 'next/link';
import { getVehicles } from '@/lib/actions/vehicles';
import { getTracks } from '@/lib/actions/sessions';
import { SessionForm } from '@/components/sessions/session-form';

export default async function NewSessionPage() {
  const [vehicles, tracks] = await Promise.all([getVehicles(), getTracks()]);

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
      <SessionForm vehicles={vehicles} tracks={tracks} />
    </div>
  );
}
