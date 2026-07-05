import { UpgradeToProButton } from '@/components/billing/billing-buttons';
import { ClearVehicleBaselineButton } from '@/components/sessions/clear-vehicle-baseline-button';
import { SetVehicleBaselineButton } from '@/components/sessions/set-vehicle-baseline-button';
import { baselineSourceLabel } from '@/lib/baseline-format';
import type { Session, Tier, VehicleBaseline } from '@/types';

interface SessionBaselinePanelProps {
  session: Session;
  baseline: VehicleBaseline | null;
  tier: Tier;
  demoMode: boolean;
}

export function SessionBaselinePanel({ session, baseline, tier, demoMode }: SessionBaselinePanelProps) {
  const isCurrentBaseline = baseline?.source_session_id === session.id;
  const hasExistingBaseline = Boolean(baseline);

  if (tier !== 'pro') {
    return (
      <section className="rounded-2xl border border-cyan-400/25 bg-cyan-400/10 p-4">
        <h2 className="text-sm font-semibold text-zinc-100">Vehicle baselines are a Pro feature.</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-300">
          Set a known-good setup for each vehicle and compare future sessions against it.
        </p>
        <div className="mt-4">
          <UpgradeToProButton fullWidth />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Vehicle Baseline</h2>
          <p className="mt-1 text-sm leading-6 text-zinc-400">
            {isCurrentBaseline
              ? 'This session is the stored setup snapshot for this vehicle.'
              : 'Save this session as the known-good setup snapshot for this vehicle.'}
          </p>
        </div>
        {isCurrentBaseline ? (
          <span className="shrink-0 rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-cyan-200">
            Vehicle Baseline
          </span>
        ) : null}
      </div>

      {baseline && !isCurrentBaseline ? (
        <p className="mt-3 rounded-xl border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-300">
          Current baseline: <span className="font-medium text-zinc-100">{baselineSourceLabel(baseline)}</span>
        </p>
      ) : null}

      {demoMode ? <p className="mt-3 text-xs text-zinc-500">Demo mode is read-only.</p> : null}

      <div className="mt-4">
        {isCurrentBaseline ? (
          <ClearVehicleBaselineButton vehicleId={session.vehicle_id} disabled={demoMode} />
        ) : (
          <SetVehicleBaselineButton
            sessionId={session.id}
            hasExistingBaseline={hasExistingBaseline}
            isCurrentBaseline={isCurrentBaseline}
            disabled={demoMode}
          />
        )}
      </div>
    </section>
  );
}
