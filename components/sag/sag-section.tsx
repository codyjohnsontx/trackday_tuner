import { calcFreeSag, calcRiderSag, calcSagPct, parseMeasurement } from '@/lib/sag';
import { Input } from '@/components/ui/input';
import { SagResults } from '@/components/sag/sag-results';

export interface SagSectionValues {
  l0: string;
  l1: string;
  l2: string;
  travel: string;
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
  const travel = parseMeasurement(values.travel);

  const freeSagMm = calcFreeSag(l0, l1);
  const riderSagMm = calcRiderSag(l0, l2);
  // Sag percentage is only meaningful against total suspension travel. L0 is a
  // distance between two arbitrary reference points, so dividing by it produces
  // a number that looks like the industry-standard figure and is not one.
  const freeSagPct = calcSagPct(freeSagMm, travel);
  const riderSagPct = calcSagPct(riderSagMm, travel);

  const measurementWarning =
    l0 !== null && ((l1 !== null && l0 < l1) || (l2 !== null && l0 < l2))
      ? 'Check measurements: L0 should be the largest number.'
      : null;

  const negativeWarning =
    (freeSagMm !== null && freeSagMm < 0) || (riderSagMm !== null && riderSagMm < 0)
      ? 'Sag is negative. Recheck values.'
      : null;

  // Travel is the divisor for both percentages, so zero or negative is not a
  // small travel figure - it is not a usable number at all, which is why
  // calcSagPct rejects it. Validating it here, before anything is compared
  // against it, keeps the section from announcing
  // "Rider sag exceeds total travel": true of any positive sag against zero,
  // and a problem the rider does not have instead of the one they do.
  const travelError =
    travel !== null && travel <= 0 ? 'Total travel must be greater than zero.' : null;

  const travelWarning =
    travel === null || travel <= 0
      ? null
      : riderSagMm !== null && riderSagMm > travel
        ? 'Rider sag exceeds total travel. Recheck values.'
        : freeSagMm !== null && freeSagMm > travel
          ? 'Free sag exceeds total travel. Recheck values.'
          : null;

  return (
    <section className="space-y-3 rounded-card bg-surface p-4">
      <h2 className="text-base font-semibold text-ink">{title}</h2>

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

      <Input
        label="Total Travel (optional)"
        type="number"
        inputMode="decimal"
        step="any"
        placeholder="mm"
        helperText="From the bike's spec sheet. Needed to show sag as a percentage."
        error={travelError ?? undefined}
        value={values.travel}
        onChange={(event) => onChange({ ...values, travel: event.target.value })}
      />

      {measurementWarning ? <p className="text-sm text-signal">{measurementWarning}</p> : null}
      {negativeWarning ? <p className="text-sm text-signal">{negativeWarning}</p> : null}
      {travelWarning ? <p className="text-sm text-signal">{travelWarning}</p> : null}

      <SagResults
        freeSagMm={freeSagMm}
        riderSagMm={riderSagMm}
        freeSagPct={freeSagPct}
        riderSagPct={riderSagPct}
        travelEntered={travel !== null}
      />
    </section>
  );
}
