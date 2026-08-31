import Link from 'next/link';
import { SetupSections } from '@/components/sessions/setup-sections';
import { baselineSourceLabel } from '@/lib/baseline-format';
import { baselineToComparableSession } from '@/lib/session-changes';
import { resolveSessionEnabledModules } from '@/lib/session-modules';
import { buildSetupView, isSetupViewEmpty } from '@/lib/setup-view';
import type { VehicleBaseline, VehicleType } from '@/types';

/**
 * The vehicle's stored baseline setup, as values a rider can read.
 *
 * `vehicle_baselines` has always stored the whole snapshot - tires, suspension,
 * alignment, extra modules and notes - and until this existed no screen in the
 * app rendered any of it. The garage card and the session detail panel both
 * showed the same thing: the track/date label of the session it was taken from,
 * plus a link to that session. So the answer to "what are my known-good clicks"
 * was one navigation away at best, and unreachable at worst -
 * `source_session_id` is `on delete set null`, so deleting that session leaves a
 * stored setup with no link at all.
 *
 * It says "snapshot" deliberately. Setting a baseline copies the session's
 * values; editing that session afterwards does not update them, so the two can
 * disagree and the numbers that matter are these, not whatever the linked
 * session reads today.
 *
 * A `<details>` rather than an always-open block: the garage lists every
 * vehicle, and a full setup per card would push the next vehicle off the phone.
 */

interface VehicleBaselineSetupProps {
  baseline: VehicleBaseline;
  vehicleType: VehicleType;
}

export function VehicleBaselineSetup({ baseline, vehicleType }: VehicleBaselineSetupProps) {
  const snapshot = baselineToComparableSession(baseline);
  const view = buildSetupView(snapshot, resolveSessionEnabledModules(snapshot, vehicleType));

  return (
    <details className="group mt-3 rounded-row bg-surface-2">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-3 py-2 text-sm font-medium text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80">
        Baseline setup
        <span aria-hidden className="text-ink-faint transition group-open:rotate-180">▾</span>
      </summary>
      <div className="space-y-2 px-3 pb-3">
        <p className="text-sm leading-6 text-ink-dim">
          The known-good setup saved for this vehicle, copied from{' '}
          {baseline.source_session_id ? (
            <Link
              href={`/sessions/${baseline.source_session_id}`}
              className="font-medium text-ink underline underline-offset-4 hover:text-signal focus-visible:rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
            >
              {baselineSourceLabel(baseline)}
            </Link>
          ) : (
            <span className="font-medium text-ink">{baselineSourceLabel(baseline)}</span>
          )}
          . Editing that session later does not change this snapshot.
        </p>

        {isSetupViewEmpty(view) ? (
          <p className="text-sm text-ink-dim">That session recorded no setup values.</p>
        ) : (
          <SetupSections view={view} variant="nested" />
        )}
      </div>
    </details>
  );
}
