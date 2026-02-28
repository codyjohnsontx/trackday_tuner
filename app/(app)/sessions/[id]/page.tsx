import { notFound } from 'next/navigation';
import { getPreviousSession, getSession } from '@/lib/actions/sessions';
import { getVehicles } from '@/lib/actions/vehicles';
import { TimeDisplay } from '@/components/ui/time-display';
import { SessionCompare, type CompareRow } from '@/components/sessions/session-compare';
import { resolveSessionEnabledModules } from '@/lib/session-modules';
import type { ExtraModules, Session } from '@/types';

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
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-500">{title}</h2>
      <div className="divide-y divide-zinc-800">{children}</div>
    </section>
  );
}

function hasValue(value: string | undefined): value is string {
  return Boolean(value && value.trim());
}

function formatDateLabel(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function asValue(value: string | null | undefined): string {
  return value ?? '';
}

function visibleValue(enabled: boolean, value: string | null | undefined): string {
  return enabled ? asValue(value) : '';
}

function buildCompareRows(
  current: Session,
  previous: Session,
  currentEnabledModules: ReturnType<typeof resolveSessionEnabledModules>,
  previousEnabledModules: ReturnType<typeof resolveSessionEnabledModules>,
): CompareRow[] {
  const rows: CompareRow[] = [
    { label: 'Conditions', current: current.conditions, previous: previous.conditions },
    { label: 'Start Time', current: asValue(current.start_time), previous: asValue(previous.start_time) },
  ];

  if (currentEnabledModules.tires || previousEnabledModules.tires) {
    rows.push(
      {
        label: 'Tires: Condition',
        current: currentEnabledModules.tires ? current.tires.condition : '',
        previous: previousEnabledModules.tires ? previous.tires.condition : '',
      },
      {
        label: 'Tires: Front Brand',
        current: visibleValue(currentEnabledModules.tires, current.tires.front.brand),
        previous: visibleValue(previousEnabledModules.tires, previous.tires.front.brand),
      },
      {
        label: 'Tires: Front Compound',
        current: visibleValue(currentEnabledModules.tires, current.tires.front.compound),
        previous: visibleValue(previousEnabledModules.tires, previous.tires.front.compound),
      },
      {
        label: 'Tires: Front Pressure',
        current: visibleValue(currentEnabledModules.tires, current.tires.front.pressure),
        previous: visibleValue(previousEnabledModules.tires, previous.tires.front.pressure),
      },
      {
        label: 'Tires: Rear Brand',
        current: visibleValue(currentEnabledModules.tires, current.tires.rear.brand),
        previous: visibleValue(previousEnabledModules.tires, previous.tires.rear.brand),
      },
      {
        label: 'Tires: Rear Compound',
        current: visibleValue(currentEnabledModules.tires, current.tires.rear.compound),
        previous: visibleValue(previousEnabledModules.tires, previous.tires.rear.compound),
      },
      {
        label: 'Tires: Rear Pressure',
        current: visibleValue(currentEnabledModules.tires, current.tires.rear.pressure),
        previous: visibleValue(previousEnabledModules.tires, previous.tires.rear.pressure),
      },
    );
  }

  if (currentEnabledModules.suspension || previousEnabledModules.suspension) {
    rows.push(
      {
        label: 'Suspension: Front Direction',
        current: visibleValue(currentEnabledModules.suspension, current.suspension.front.direction),
        previous: visibleValue(previousEnabledModules.suspension, previous.suspension.front.direction),
      },
      {
        label: 'Suspension: Front Preload',
        current: visibleValue(currentEnabledModules.suspension, current.suspension.front.preload),
        previous: visibleValue(previousEnabledModules.suspension, previous.suspension.front.preload),
      },
      {
        label: 'Suspension: Front Compression',
        current: visibleValue(currentEnabledModules.suspension, current.suspension.front.compression),
        previous: visibleValue(previousEnabledModules.suspension, previous.suspension.front.compression),
      },
      {
        label: 'Suspension: Front Rebound',
        current: visibleValue(currentEnabledModules.suspension, current.suspension.front.rebound),
        previous: visibleValue(previousEnabledModules.suspension, previous.suspension.front.rebound),
      },
      {
        label: 'Suspension: Rear Direction',
        current: visibleValue(currentEnabledModules.suspension, current.suspension.rear.direction),
        previous: visibleValue(previousEnabledModules.suspension, previous.suspension.rear.direction),
      },
      {
        label: 'Suspension: Rear Preload',
        current: visibleValue(currentEnabledModules.suspension, current.suspension.rear.preload),
        previous: visibleValue(previousEnabledModules.suspension, previous.suspension.rear.preload),
      },
      {
        label: 'Suspension: Rear Compression',
        current: visibleValue(currentEnabledModules.suspension, current.suspension.rear.compression),
        previous: visibleValue(previousEnabledModules.suspension, previous.suspension.rear.compression),
      },
      {
        label: 'Suspension: Rear Rebound',
        current: visibleValue(currentEnabledModules.suspension, current.suspension.rear.rebound),
        previous: visibleValue(previousEnabledModules.suspension, previous.suspension.rear.rebound),
      },
    );
  }

  if (currentEnabledModules.alignment || previousEnabledModules.alignment) {
    rows.push(
      {
        label: 'Alignment: Front Camber',
        current: visibleValue(currentEnabledModules.alignment, current.alignment?.front_camber),
        previous: visibleValue(previousEnabledModules.alignment, previous.alignment?.front_camber),
      },
      {
        label: 'Alignment: Rear Camber',
        current: visibleValue(currentEnabledModules.alignment, current.alignment?.rear_camber),
        previous: visibleValue(previousEnabledModules.alignment, previous.alignment?.rear_camber),
      },
      {
        label: 'Alignment: Front Toe',
        current: visibleValue(currentEnabledModules.alignment, current.alignment?.front_toe),
        previous: visibleValue(previousEnabledModules.alignment, previous.alignment?.front_toe),
      },
      {
        label: 'Alignment: Rear Toe',
        current: visibleValue(currentEnabledModules.alignment, current.alignment?.rear_toe),
        previous: visibleValue(previousEnabledModules.alignment, previous.alignment?.rear_toe),
      },
      {
        label: 'Alignment: Caster',
        current: visibleValue(currentEnabledModules.alignment, current.alignment?.caster),
        previous: visibleValue(previousEnabledModules.alignment, previous.alignment?.caster),
      },
    );
  }

  if (currentEnabledModules.geometry || previousEnabledModules.geometry) {
    rows.push(
      {
        label: 'Geometry: Front Sag',
        current: visibleValue(currentEnabledModules.geometry, current.extra_modules?.geometry?.sag_front),
        previous: visibleValue(previousEnabledModules.geometry, previous.extra_modules?.geometry?.sag_front),
      },
      {
        label: 'Geometry: Rear Sag',
        current: visibleValue(currentEnabledModules.geometry, current.extra_modules?.geometry?.sag_rear),
        previous: visibleValue(previousEnabledModules.geometry, previous.extra_modules?.geometry?.sag_rear),
      },
      {
        label: 'Geometry: Fork Height',
        current: visibleValue(currentEnabledModules.geometry, current.extra_modules?.geometry?.fork_height),
        previous: visibleValue(previousEnabledModules.geometry, previous.extra_modules?.geometry?.fork_height),
      },
      {
        label: 'Geometry: Rear Ride Height',
        current: visibleValue(currentEnabledModules.geometry, current.extra_modules?.geometry?.rear_ride_height),
        previous: visibleValue(previousEnabledModules.geometry, previous.extra_modules?.geometry?.rear_ride_height),
      },
      {
        label: 'Geometry: Notes',
        current: visibleValue(currentEnabledModules.geometry, current.extra_modules?.geometry?.notes),
        previous: visibleValue(previousEnabledModules.geometry, previous.extra_modules?.geometry?.notes),
      },
    );
  }

  if (currentEnabledModules.drivetrain || previousEnabledModules.drivetrain) {
    rows.push(
      {
        label: 'Drivetrain: Front Sprocket',
        current: visibleValue(currentEnabledModules.drivetrain, current.extra_modules?.drivetrain?.front_sprocket),
        previous: visibleValue(previousEnabledModules.drivetrain, previous.extra_modules?.drivetrain?.front_sprocket),
      },
      {
        label: 'Drivetrain: Rear Sprocket',
        current: visibleValue(currentEnabledModules.drivetrain, current.extra_modules?.drivetrain?.rear_sprocket),
        previous: visibleValue(previousEnabledModules.drivetrain, previous.extra_modules?.drivetrain?.rear_sprocket),
      },
      {
        label: 'Drivetrain: Chain Length',
        current: visibleValue(currentEnabledModules.drivetrain, current.extra_modules?.drivetrain?.chain_length),
        previous: visibleValue(previousEnabledModules.drivetrain, previous.extra_modules?.drivetrain?.chain_length),
      },
      {
        label: 'Drivetrain: Notes',
        current: visibleValue(currentEnabledModules.drivetrain, current.extra_modules?.drivetrain?.notes),
        previous: visibleValue(previousEnabledModules.drivetrain, previous.extra_modules?.drivetrain?.notes),
      },
    );
  }

  if (currentEnabledModules.aero || previousEnabledModules.aero) {
    rows.push(
      {
        label: 'Aero: Wing Angle',
        current: visibleValue(currentEnabledModules.aero, current.extra_modules?.aero?.wing_angle),
        previous: visibleValue(previousEnabledModules.aero, previous.extra_modules?.aero?.wing_angle),
      },
      {
        label: 'Aero: Splitter Setting',
        current: visibleValue(currentEnabledModules.aero, current.extra_modules?.aero?.splitter_setting),
        previous: visibleValue(previousEnabledModules.aero, previous.extra_modules?.aero?.splitter_setting),
      },
      {
        label: 'Aero: Rake',
        current: visibleValue(currentEnabledModules.aero, current.extra_modules?.aero?.rake),
        previous: visibleValue(previousEnabledModules.aero, previous.extra_modules?.aero?.rake),
      },
      {
        label: 'Aero: Notes',
        current: visibleValue(currentEnabledModules.aero, current.extra_modules?.aero?.notes),
        previous: visibleValue(previousEnabledModules.aero, previous.extra_modules?.aero?.notes),
      },
    );
  }

  if (currentEnabledModules.notes || previousEnabledModules.notes) {
    rows.push({
      label: 'Notes',
      current: visibleValue(currentEnabledModules.notes, current.notes),
      previous: visibleValue(previousEnabledModules.notes, previous.notes),
    });
  }

  return rows;
}

export default async function SessionDetailPage({ params }: SessionDetailPageProps) {
  const { id } = await params;
  const [session, vehicles] = await Promise.all([getSession(id), getVehicles()]);

  if (!session) notFound();

  const previousSession = await getPreviousSession(session);
  const vehicle = vehicles.find((v) => v.id === session.vehicle_id);
  const vehicleNickname = vehicle?.nickname ?? 'Unknown Vehicle';
  const vehicleType = vehicle?.type ?? 'motorcycle';
  const enabledModules = resolveSessionEnabledModules(session, vehicleType);
  const previousEnabledModules = previousSession
    ? resolveSessionEnabledModules(previousSession, vehicleType)
    : null;
  const compareRows =
    previousSession && previousEnabledModules
      ? buildCompareRows(session, previousSession, enabledModules, previousEnabledModules)
      : [];

  const formattedDate = formatDateLabel(session.date);

  const extraModules = (session.extra_modules ?? null) as ExtraModules | null;
  const suspensionDirection =
    session.suspension.front.direction === session.suspension.rear.direction
      ? session.suspension.front.direction
      : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-zinc-100">{session.track_name ?? 'Unknown Track'}</h1>
        <p className="mt-0.5 text-sm text-zinc-400">{formattedDate} · {vehicleNickname}</p>
      </div>

      {previousSession ? (
        <SessionCompare rows={compareRows} previousDateLabel={formatDateLabel(previousSession.date)} />
      ) : (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Compare with Previous Session</h2>
          <p className="mt-2 text-sm text-zinc-400">No earlier session found for this vehicle.</p>
        </section>
      )}

      <SectionCard title="Session Info">
        <DetailRow label="Track" value={session.track_name ?? '—'} />
        <DetailRow label="Vehicle" value={vehicleNickname} />
        <DetailRow label="Date" value={formattedDate} />
        {session.session_number ? (
          <DetailRow label="Session Number" value={session.session_number.toString()} />
        ) : null}
        <div className="flex items-center justify-between gap-3 py-1.5">
          <span className="text-sm text-zinc-400">Start Time</span>
          <TimeDisplay time={session.start_time} />
        </div>
        <DetailRow label="Conditions" value={conditionLabel[session.conditions] ?? session.conditions} />
      </SectionCard>

      {enabledModules.tires ? (
        <SectionCard title="Tires">
          <DetailRow label="Condition" value={session.tires.condition} />
          <DetailRow label="Front Brand" value={session.tires.front.brand} />
          <DetailRow label="Front Compound" value={session.tires.front.compound} />
          <DetailRow label="Front Pressure" value={session.tires.front.pressure} />
          <DetailRow label="Rear Brand" value={session.tires.rear.brand} />
          <DetailRow label="Rear Compound" value={session.tires.rear.compound} />
          <DetailRow label="Rear Pressure" value={session.tires.rear.pressure} />
        </SectionCard>
      ) : null}

      {enabledModules.suspension ? (
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
      ) : null}

      {enabledModules.alignment && session.alignment !== null ? (
        <SectionCard title="Alignment">
          <DetailRow label="Front Camber" value={session.alignment.front_camber} />
          <DetailRow label="Rear Camber" value={session.alignment.rear_camber} />
          <DetailRow label="Front Toe" value={session.alignment.front_toe} />
          <DetailRow label="Rear Toe" value={session.alignment.rear_toe} />
          <DetailRow label="Caster" value={session.alignment.caster} />
        </SectionCard>
      ) : null}

      {enabledModules.geometry && extraModules?.geometry ? (
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

      {enabledModules.drivetrain && extraModules?.drivetrain ? (
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

      {enabledModules.aero && extraModules?.aero ? (
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

      {enabledModules.notes && session.notes ? (
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">Notes</h2>
          <p className="text-sm text-zinc-200 whitespace-pre-wrap">{session.notes}</p>
        </section>
      ) : null}
    </div>
  );
}
