import { calcFreeSag, calcRiderSag, calcSagPct, parseMeasurement } from '@/lib/sag';
import { Input } from '@/components/ui/input';
import { SagResults } from '@/components/sag/sag-results';

export interface SagSectionValues {
  l0: string;
  l1: string;
  l2: string;
}

interface SagSectionProps {
  title: string;
  values: SagSectionValues;
  onChange: (next: SagSectionValues) => void;
}

export function SagSection({ title, values, onChange }: SagSectionProps) {
  const l0 = parseMeasurement(values.l0);
  const l1 = parseMeasurement(values.l1);
  const l2 = parseMeasurement(values.l2);

  const freeSagMm = calcFreeSag(l0, l1);
  const riderSagMm = calcRiderSag(l0, l2);
  const freeSagPct = calcSagPct(freeSagMm, l0);
  const riderSagPct = calcSagPct(riderSagMm, l0);

  const measurementWarning =
    l0 !== null && ((l1 !== null && l0 < l1) || (l2 !== null && l0 < l2))
      ? 'Check measurements: L0 should be the largest number.'
      : null;

  const negativeWarning =
    (freeSagMm !== null && freeSagMm < 0) || (riderSagMm !== null && riderSagMm < 0)
      ? 'Sag is negative. Recheck values.'
      : null;

  return (
    <section className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <h2 className="text-base font-semibold text-zinc-100">{title}</h2>

      <Input
        label="Fully Extended (L0)"
        type="number"
        inputMode="decimal"
        step="any"
        placeholder="mm"
        value={values.l0}
        onChange={(event) => onChange({ ...values, l0: event.target.value })}
      />

      <Input
        label="Bike Only (L1)"
        type="number"
        inputMode="decimal"
        step="any"
        placeholder="mm"
        value={values.l1}
        onChange={(event) => onChange({ ...values, l1: event.target.value })}
      />

      <Input
        label="Rider On Bike (L2)"
        type="number"
        inputMode="decimal"
        step="any"
        placeholder="mm"
        value={values.l2}
        onChange={(event) => onChange({ ...values, l2: event.target.value })}
      />

      {measurementWarning ? <p className="text-sm text-amber-300">{measurementWarning}</p> : null}
      {negativeWarning ? <p className="text-sm text-amber-300">{negativeWarning}</p> : null}

      <SagResults
        freeSagMm={freeSagMm}
        riderSagMm={riderSagMm}
        freeSagPct={freeSagPct}
        riderSagPct={riderSagPct}
      />
    </section>
  );
}
