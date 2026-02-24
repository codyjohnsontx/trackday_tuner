import { roundForDisplay } from '@/lib/sag';

interface SagResultsProps {
  freeSagMm: number | null;
  riderSagMm: number | null;
  freeSagPct: number | null;
  riderSagPct: number | null;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-zinc-400">{label}</span>
      <span className="text-sm font-semibold text-zinc-100">{value}</span>
    </div>
  );
}

export function SagResults({ freeSagMm, riderSagMm, freeSagPct, riderSagPct }: SagResultsProps) {
  return (
    <div className="space-y-1 rounded-xl border border-zinc-800 bg-zinc-950 p-3">
      <Row label="Free/Static Sag" value={`${roundForDisplay(freeSagMm)} mm`} />
      <Row label="Rider/Race Sag" value={`${roundForDisplay(riderSagMm)} mm`} />
      {freeSagPct !== null ? <Row label="Free Sag (% of L0)" value={`${roundForDisplay(freeSagPct)}%`} /> : null}
      {riderSagPct !== null ? <Row label="Rider Sag (% of L0)" value={`${roundForDisplay(riderSagPct)}%`} /> : null}
    </div>
  );
}
