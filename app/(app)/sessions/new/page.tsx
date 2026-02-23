import { redirect } from 'next/navigation';
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
        <p className="mt-0.5 text-xs text-zinc-500">Log your track day setup</p>
      </div>
      <SessionForm vehicles={vehicles} tracks={tracks} />
    </div>
  );
}
