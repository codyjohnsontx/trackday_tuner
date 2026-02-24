import { notFound } from 'next/navigation';
import { getSession } from '@/lib/actions/sessions';
import { getVehicles } from '@/lib/actions/vehicles';
import { TimeDisplay } from '@/components/ui/time-display';
import type { ExtraModules } from '@/types';

interface SessionDetailPageProps {
  params: Promise<{ id: string }>;
}

const conditionLabel: Record<string, string> = {
  sunny: 'Sunny',
  overcast: 'Overcast',
  rainy: 'Rainy',
  mixed: 'Mixed',
};

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-zinc-400">{label}</span>
      <span className="text-sm font-medium text-zinc-100">{value || '—'}</span>
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">
        {title}
      </h2>
      <div className="divide-y divide-zinc-800">{children}</div>
    </section>
  );
}

function hasValue(value: string | undefined): value is string {
  return Boolean(value && value.trim());
}

export default async function SessionDetailPage({ params }: SessionDetailPageProps) {
  const { id } = await params;
  const [session, vehicles] = await Promise.all([getSession(id), getVehicles()]);

  if (!session) notFound();

  const vehicle = vehicles.find((v) => v.id === session.vehicle_id);
  const vehicleNickname = vehicle?.nickname ?? 'Unknown Vehicle';

  const date = new Date(`${session.date}T00:00:00`);
  const formattedDate = date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const extraModules = (session.extra_modules ?? null) as ExtraModules | null;
  const suspensionDirection =
    session.suspension.front.direction === session.suspension.rear.direction
      ? session.suspension.front.direction
      : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">
          {session.track_name ?? 'Unknown Track'}
        </h1>
        <p className="mt-0.5 text-sm text-zinc-400">
          {formattedDate} · {vehicleNickname}
        </p>
      </div>

      <SectionCard title="Session Info">
        <DetailRow label="Track" value={session.track_name ?? '—'} />
        <DetailRow label="Vehicle" value={vehicleNickname} />
        <DetailRow label="Date" value={formattedDate} />
        <div className="flex items-center justify-between gap-3 py-1.5">
          <span className="text-sm text-zinc-400">Start Time</span>
          <TimeDisplay time={session.start_time} />
        </div>
        <DetailRow label="Conditions" value={conditionLabel[session.conditions] ?? session.conditions} />
      </SectionCard>

      <SectionCard title="Tires">
        <DetailRow label="Condition" value={session.tires.condition} />
        <DetailRow label="Front Brand" value={session.tires.front.brand} />
        <DetailRow label="Front Compound" value={session.tires.front.compound} />
        <DetailRow label="Front Pressure" value={session.tires.front.pressure} />
        <DetailRow label="Rear Brand" value={session.tires.rear.brand} />
        <DetailRow label="Rear Compound" value={session.tires.rear.compound} />
        <DetailRow label="Rear Pressure" value={session.tires.rear.pressure} />
      </SectionCard>

      <SectionCard title="Suspension">
        {suspensionDirection ? (
          <DetailRow
            label="Direction"
            value={suspensionDirection === 'in' ? 'Clicks in from open' : 'Clicks out from closed'}
          />
        ) : null}
        <DetailRow
          label="Front direction"
          value={session.suspension.front.direction === 'in' ? 'Clicks in from open' : 'Clicks out from closed'}
        />
        <DetailRow label="Front Preload" value={session.suspension.front.preload} />
        <DetailRow label="Front Compression" value={session.suspension.front.compression} />
        <DetailRow label="Front Rebound" value={session.suspension.front.rebound} />
        <DetailRow
          label="Rear direction"
          value={session.suspension.rear.direction === 'in' ? 'Clicks in from open' : 'Clicks out from closed'}
        />
        <DetailRow label="Rear Preload" value={session.suspension.rear.preload} />
        <DetailRow label="Rear Compression" value={session.suspension.rear.compression} />
        <DetailRow label="Rear Rebound" value={session.suspension.rear.rebound} />
      </SectionCard>

      {session.alignment !== null ? (
        <SectionCard title="Alignment">
          <DetailRow label="Front Camber" value={session.alignment.front_camber} />
          <DetailRow label="Rear Camber" value={session.alignment.rear_camber} />
          <DetailRow label="Front Toe" value={session.alignment.front_toe} />
          <DetailRow label="Rear Toe" value={session.alignment.rear_toe} />
          <DetailRow label="Caster" value={session.alignment.caster} />
        </SectionCard>
      ) : null}

      {extraModules?.geometry ? (
        <SectionCard title="Geometry">
          {hasValue(extraModules.geometry.sag_front) ? (
            <DetailRow label="Front Sag" value={extraModules.geometry.sag_front} />
          ) : null}
          {hasValue(extraModules.geometry.sag_rear) ? (
            <DetailRow label="Rear Sag" value={extraModules.geometry.sag_rear} />
          ) : null}
          {hasValue(extraModules.geometry.fork_height) ? (
            <DetailRow label="Fork Height" value={extraModules.geometry.fork_height} />
          ) : null}
          {hasValue(extraModules.geometry.rear_ride_height) ? (
            <DetailRow label="Rear Ride Height" value={extraModules.geometry.rear_ride_height} />
          ) : null}
          {hasValue(extraModules.geometry.notes) ? (
            <DetailRow label="Notes" value={extraModules.geometry.notes} />
          ) : null}
        </SectionCard>
      ) : null}

      {extraModules?.drivetrain ? (
        <SectionCard title="Drivetrain">
          {hasValue(extraModules.drivetrain.front_sprocket) ? (
            <DetailRow label="Front Sprocket" value={extraModules.drivetrain.front_sprocket} />
          ) : null}
          {hasValue(extraModules.drivetrain.rear_sprocket) ? (
            <DetailRow label="Rear Sprocket" value={extraModules.drivetrain.rear_sprocket} />
          ) : null}
          {hasValue(extraModules.drivetrain.chain_length) ? (
            <DetailRow label="Chain Length" value={extraModules.drivetrain.chain_length} />
          ) : null}
          {hasValue(extraModules.drivetrain.notes) ? (
            <DetailRow label="Notes" value={extraModules.drivetrain.notes} />
          ) : null}
        </SectionCard>
      ) : null}

      {extraModules?.aero ? (
        <SectionCard title="Aero">
          {hasValue(extraModules.aero.wing_angle) ? (
            <DetailRow label="Wing Angle" value={extraModules.aero.wing_angle} />
          ) : null}
          {hasValue(extraModules.aero.splitter_setting) ? (
            <DetailRow label="Splitter Setting" value={extraModules.aero.splitter_setting} />
          ) : null}
          {hasValue(extraModules.aero.rake) ? (
            <DetailRow label="Rake" value={extraModules.aero.rake} />
          ) : null}
          {hasValue(extraModules.aero.notes) ? (
            <DetailRow label="Notes" value={extraModules.aero.notes} />
          ) : null}
        </SectionCard>
      ) : null}

      {session.notes ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Notes
          </h2>
          <p className="text-sm text-zinc-200 whitespace-pre-wrap">{session.notes}</p>
        </section>
      ) : null}
    </div>
  );
}
