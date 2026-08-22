/**
 * The static disclaimer that sits above every AI answer.
 *
 * It is shared rather than per-panel because it is the one piece of safety copy
 * that does not depend on what the model returned, so a panel can only be
 * missing it by omission - which is how the day plan came to show safety copy
 * when an answer was withheld and none at all when a rider was handed real
 * setup changes with magnitudes on them.
 */
export function SafetyBanner() {
  return (
    <div className="rounded-row border border-signal/30 bg-signal/12 px-3 py-2 text-xs text-signal">
      Informational only. You are responsible for vehicle safety and on-track conduct. Make one change at a time.
    </div>
  );
}
