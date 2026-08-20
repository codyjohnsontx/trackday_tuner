import { roundForDisplay } from '@/lib/sag';

interface SagResultsProps {
  freeSagMm: number | null;
  riderSagMm: number | null;
  freeSagPct: number | null;
  riderSagPct: number | null;
  /**
   * Whether a travel figure was typed at all, not whether it was usable. The
   * hint below asks the rider for one, so a rider who entered 0 must not be
   * told to add what is already on screen - the field's own error names what is
   * wrong with it.
   */
  travelEntered: boolean;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-ink-dim">{label}</span>
      <span className="text-sm font-semibold text-ink">{value}</span>
    </div>
  );
}

export function SagResults({
  freeSagMm,
  riderSagMm,
  freeSagPct,
  riderSagPct,
  travelEntered,
}: SagResultsProps) {
  const hasSag = freeSagMm !== null || riderSagMm !== null;

  return (
    <div className="space-y-1 rounded-row bg-surface-3 p-3">
      <Row label="Free/Static Sag" value={`${roundForDisplay(freeSagMm)} mm`} />
      <Row label="Rider/Race Sag" value={`${roundForDisplay(riderSagMm)} mm`} />
      {freeSagPct !== null ? <Row label="Free Sag (% of travel)" value={`${roundForDisplay(freeSagPct)}%`} /> : null}
      {riderSagPct !== null ? <Row label="Rider Sag (% of travel)" value={`${roundForDisplay(riderSagPct)}%`} /> : null}
      {!travelEntered && hasSag ? (
        <p className="pt-1 text-xs text-ink-faint">Add total travel above to see sag as a percentage.</p>
      ) : null}
    </div>
  );
}
