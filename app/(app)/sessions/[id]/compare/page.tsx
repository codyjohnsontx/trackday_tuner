import { notFound } from 'next/navigation';
import {
  getComparableSessions,
  getSession,
  getSessionEnvironments,
  getTelemetrySummaries,
} from '@/lib/actions/sessions';
import { getUserProfile, getVehicles } from '@/lib/actions/vehicles';
import { DemoBanner } from '@/components/demo/demo-banner';
import { SessionCompareContextFlags } from '@/components/sessions/session-compare-context-flags';
import { SessionCompareLapMetrics } from '@/components/sessions/session-compare-lap-metrics';
import { SessionComparePageHeader } from '@/components/sessions/session-compare-page-header';
import { SessionComparePicker, type SessionComparePickerOption } from '@/components/sessions/session-compare-picker';
import { SessionCompareSetupDeltas } from '@/components/sessions/session-compare-setup-deltas';
import { SessionCompareStrengthBanner } from '@/components/sessions/session-compare-strength-banner';
import { SessionCompareUpgradeCard } from '@/components/sessions/session-compare-upgrade-card';
import {
  buildSessionComparisonModel,
  extractLapMetrics,
  formatLapTime,
  isSessionBefore,
  sessionsMatchTrack,
} from '@/lib/session-compare';
import { isDemoMode } from '@/lib/demo/mode';
import type { Session, SessionEnvironment, TelemetrySummary } from '@/types';

interface SessionComparePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ baseline?: string | string[] }>;
}

const conditionLabel: Record<string, string> = {
  sunny: 'Sunny',
  overcast: 'Overcast',
  rainy: 'Rainy',
  mixed: 'Mixed',
};

function formatDateLabel(dateString: string): string {
  const date = new Date(`${dateString}T00:00:00`);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function sessionLabel(session: Session, currentSessionId: string): string {
  if (session.session_number) return `Session ${session.session_number}`;
  if (session.id === currentSessionId) return 'Current session';
  return 'Session';
}

function getBaselineParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function chooseDefaultBaseline(current: Session, candidates: Session[]): Session | null {
  const previousCandidates = candidates.filter((candidate) => isSessionBefore(candidate, current));
  return (
    previousCandidates.find((candidate) => sessionsMatchTrack(candidate, current)) ??
    previousCandidates[0] ??
    null
  );
}

function mapBySessionId<T extends { session_id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.session_id, row]));
}

function buildPickerOptions(
  current: Session,
  candidates: Session[],
  telemetryBySessionId: Map<string, TelemetrySummary>,
): SessionComparePickerOption[] {
  return candidates.map((candidate) => {
    const bestLapMs = extractLapMetrics(telemetryBySessionId.get(candidate.id)).bestLapMs;
    return {
      id: candidate.id,
      trackName: candidate.track_name ?? 'Unknown Track',
      dateLabel: formatDateLabel(candidate.date),
      sessionLabel: sessionLabel(candidate, current.id),
      conditionLabel: conditionLabel[candidate.conditions] ?? candidate.conditions,
      bestLapLabel: bestLapMs !== null ? formatLapTime(bestLapMs) : null,
      sameTrack: sessionsMatchTrack(candidate, current),
    };
  });
}

function EmptyBaselineState({ hasCandidates }: { hasCandidates: boolean }) {
  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-sm font-semibold text-zinc-100">No baseline selected</h2>
      <p className="mt-2 text-sm leading-6 text-zinc-400">
        {hasCandidates
          ? 'Choose a baseline session above to render the comparison.'
          : 'Log another session with this vehicle to unlock a session comparison.'}
      </p>
    </section>
  );
}

export default async function SessionComparePage({ params, searchParams }: SessionComparePageProps) {
  const [{ id }, resolvedSearchParams] = await Promise.all([params, searchParams]);
  const [session, profile, vehicles, demoMode] = await Promise.all([
    getSession(id),
    getUserProfile(),
    getVehicles(),
    isDemoMode(),
  ]);

  if (!session) notFound();

  const trackName = session.track_name ?? 'Unknown Track';
  const header = (
    <>
      {demoMode ? <DemoBanner /> : null}
      <SessionComparePageHeader
        sessionId={session.id}
        trackName={trackName}
        sessionLabel={sessionLabel(session, session.id)}
        dateLabel={formatDateLabel(session.date)}
      />
    </>
  );

  if ((profile?.tier ?? 'free') === 'free') {
    return (
      <div className="space-y-5">
        {header}
        <SessionCompareUpgradeCard sessionId={session.id} />
      </div>
    );
  }

  const candidates = await getComparableSessions(session);
  const telemetryRows = await getTelemetrySummaries([session.id, ...candidates.map((candidate) => candidate.id)]);
  const telemetryBySessionId = mapBySessionId(telemetryRows);
  const requestedBaselineId = getBaselineParam(resolvedSearchParams.baseline);
  const selectedBaseline =
    candidates.find((candidate) => candidate.id === requestedBaselineId) ??
    chooseDefaultBaseline(session, candidates);
  const pickerOptions = buildPickerOptions(session, candidates, telemetryBySessionId);

  if (!selectedBaseline) {
    return (
      <div className="space-y-5">
        {header}
        <SessionComparePicker options={pickerOptions} selectedId={null} />
        <EmptyBaselineState hasCandidates={candidates.length > 0} />
      </div>
    );
  }

  const environmentRows = await getSessionEnvironments([session.id, selectedBaseline.id]);
  const environmentBySessionId = mapBySessionId<SessionEnvironment>(environmentRows);
  const vehicle = vehicles.find((candidate) => candidate.id === session.vehicle_id);
  const model = buildSessionComparisonModel({
    currentSession: session,
    baselineSession: selectedBaseline,
    currentEnvironment: environmentBySessionId.get(session.id) ?? null,
    baselineEnvironment: environmentBySessionId.get(selectedBaseline.id) ?? null,
    currentTelemetry: telemetryBySessionId.get(session.id) ?? null,
    baselineTelemetry: telemetryBySessionId.get(selectedBaseline.id) ?? null,
    vehicleType: vehicle?.type ?? 'motorcycle',
  });

  return (
    <div className="space-y-5">
      {header}
      <SessionComparePicker options={pickerOptions} selectedId={selectedBaseline.id} />
      <SessionCompareStrengthBanner strength={model.strength} summary={model.summary} />
      <SessionCompareLapMetrics
        current={model.lapMetrics.current}
        baseline={model.lapMetrics.baseline}
        deltas={model.lapMetrics.deltas}
      />
      <SessionCompareContextFlags flags={model.flags} />
      <SessionCompareSetupDeltas rows={model.setupRows} />
    </div>
  );
}
