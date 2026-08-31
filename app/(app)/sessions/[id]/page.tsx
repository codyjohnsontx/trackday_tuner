import { notFound } from 'next/navigation';
import Link from 'next/link';
import { BarChart3 } from 'lucide-react';
import { getVehicleBaseline } from '@/lib/actions/baselines';
import { getSessionChangeRecords } from '@/lib/actions/session-changes';
import { getComparableSessions, getPreviousSession, getSession, getSessionEnvironment, getSessionLaps } from '@/lib/actions/sessions';
import { getOutstandingRecommendations, getSessionOutcome, getVehicleOutcomeHistory } from '@/lib/actions/outcomes';
import { getUserProfile, getVehicles } from '@/lib/actions/vehicles';
import { DemoBanner } from '@/components/demo/demo-banner';
import { isDemoMode } from '@/lib/demo/mode';
import { Button } from '@/components/ui/button';
import { TemperatureDisplay } from '@/components/ui/temperature-display';
import { TimeDisplay } from '@/components/ui/time-display';
import { SessionCompare, type CompareRow } from '@/components/sessions/session-compare';
import { SetupSections } from '@/components/sessions/setup-sections';
import { SessionBaselinePanel } from '@/components/sessions/session-baseline-panel';
import { SessionChangesPanel } from '@/components/sessions/session-changes-panel';
import { TuningAdvicePanel } from '@/components/ai/tuning-advice-panel';
import { SessionLapsPanel } from '@/components/sessions/session-laps-panel';
import { SessionOutcomePanel } from '@/components/sessions/session-outcome-panel';
import { VehicleOutcomeHistory } from '@/components/sessions/vehicle-outcome-history';
import { effectiveTier } from '@/lib/access';
import { resolveChangeSets } from '@/lib/session-changes';
import { resolveSessionEnabledModules } from '@/lib/session-modules';
import { buildSetupView } from '@/lib/setup-view';
import { isSessionBefore } from '@/lib/session-compare';
import type { Session } from '@/types';
import { pageTitleClass } from '@/components/ui/page-header';

interface SessionDetailPageProps {
  params: Promise<{ id: string }>;
}

const conditionLabel: Record<string, string> = {
  sunny: 'Sunny',
  overcast: 'Overcast',
  rainy: 'Rainy',
  mixed: 'Mixed',
};

/**
 * A value that reads differently per device - a temperature, a clock time -
 * arrives as its own client component and carries its own text styling.
 */
function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-ink-dim">{label}</span>
      {typeof value === 'string' ? (
        <span className="text-sm font-medium text-ink">{value || '—'}</span>
      ) : (
        value
      )}
    </div>
  );
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-card bg-surface p-4">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</h2>
      <div className="divide-y divide-white/5">{children}</div>
    </section>
  );
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
        current: currentEnabledModules.tires ? current.tires.condition ?? '' : '',
        previous: previousEnabledModules.tires ? previous.tires.condition ?? '' : '',
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
  const [session, vehicles, profile, demoMode] = await Promise.all([
    getSession(id),
    getVehicles(),
    getUserProfile(),
    isDemoMode(),
  ]);

  if (!session) notFound();

  const [previousSession, environment, baseline, changeRecords, sessionLaps, comparableSessions, existingOutcome, outcomeHistory, recommendations] = await Promise.all([
    getPreviousSession(session),
    getSessionEnvironment(session.id),
    getVehicleBaseline(session.vehicle_id),
    getSessionChangeRecords(session.id),
    getSessionLaps(session.id),
    getComparableSessions(session),
    getSessionOutcome(session.id),
    getVehicleOutcomeHistory(session.vehicle_id),
    getOutstandingRecommendations({ vehicleId: session.vehicle_id, beforeSessionId: session.id }),
  ]);
  const tier = effectiveTier(profile);
  const vehicle = vehicles.find((v) => v.id === session.vehicle_id);
  const vehicleNickname = vehicle?.nickname ?? 'Unknown Vehicle';
  const vehicleType = vehicle?.type ?? 'motorcycle';
  const enabledModules = resolveSessionEnabledModules(session, vehicleType);
  const changeSets =
    tier === 'pro'
      ? resolveChangeSets(changeRecords, session, previousSession, baseline, vehicleType)
      : [];
  const previousEnabledModules = previousSession
    ? resolveSessionEnabledModules(previousSession, vehicleType)
    : null;
  const compareRows =
    previousSession && previousEnabledModules
      ? buildCompareRows(session, previousSession, enabledModules, previousEnabledModules)
      : [];

  const formattedDate = formatDateLabel(session.date);

  const setupView = buildSetupView(session, enabledModules);

  return (
    <div className="space-y-5">
      {demoMode ? <DemoBanner /> : null}

      <div>
        <h1 className={pageTitleClass}>{session.track_name ?? 'Unknown Track'}</h1>
        <p className="mt-0.5 text-sm text-ink-dim">{formattedDate} · {vehicleNickname}</p>
      </div>

      <div className="space-y-3">
        {previousSession ? (
          <SessionCompare rows={compareRows} previousDateLabel={formatDateLabel(previousSession.date)} />
        ) : (
          <section className="rounded-card bg-surface p-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Compare with Previous Session</h2>
            <p className="mt-2 text-sm text-ink-dim">No earlier session found for this vehicle.</p>
          </section>
        )}
        <Button asChild variant="secondary" fullWidth>
          <Link href={`/sessions/${session.id}/compare`}>
            <BarChart3 className="mr-2 h-4 w-4" aria-hidden="true" />
            Compare Sessions
          </Link>
        </Button>
        <SessionBaselinePanel session={session} baseline={baseline} tier={tier} demoMode={demoMode} />
        <SessionChangesPanel changeSets={changeSets} tier={tier} />
      </div>

      {tier === 'pro' ? (
        <SessionOutcomePanel
          session={session}
          references={comparableSessions.filter((candidate) => isSessionBefore(candidate, session))}
          recommendations={recommendations}
          existing={existingOutcome}
          disabled={demoMode}
        />
      ) : null}

      <VehicleOutcomeHistory outcomes={outcomeHistory} />

      <TuningAdvicePanel sessionId={session.id} vehicleId={session.vehicle_id} tier={tier} demoMode={demoMode} />

      <SessionLapsPanel sessionId={session.id} vehicleId={session.vehicle_id} initialLaps={sessionLaps} demoMode={demoMode} />

      <SectionCard title="Session Info">
        <DetailRow label="Track" value={session.track_name ?? '—'} />
        <DetailRow label="Vehicle" value={vehicleNickname} />
        <DetailRow label="Date" value={formattedDate} />
        {session.session_number ? (
          <DetailRow label="Session Number" value={session.session_number.toString()} />
        ) : null}
        <DetailRow label="Start Time" value={<TimeDisplay time={session.start_time} />} />
        <DetailRow label="Conditions" value={conditionLabel[session.conditions] ?? session.conditions} />
      </SectionCard>

      {environment ? (
        <SectionCard title="Environment">
          {environment.ambient_temperature_c != null ? (
            <DetailRow
              label="Ambient Temp"
              value={<TemperatureDisplay celsius={environment.ambient_temperature_c} />}
            />
          ) : null}
          {environment.track_temperature_c != null ? (
            <DetailRow
              label="Track Temp"
              value={<TemperatureDisplay celsius={environment.track_temperature_c} />}
            />
          ) : null}
          {environment.humidity_percent != null ? (
            <DetailRow label="Humidity" value={`${environment.humidity_percent}%`} />
          ) : null}
          <DetailRow label="Weather" value={environment.weather_condition ?? ''} />
          <DetailRow label="Surface" value={environment.surface_condition ?? ''} />
          <DetailRow label="Source" value={environment.source} />
        </SectionCard>
      ) : null}

      <SetupSections view={setupView} />

    </div>
  );
}
