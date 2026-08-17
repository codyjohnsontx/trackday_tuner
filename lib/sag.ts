export function calcFreeSag(l0: number | null, l1: number | null): number | null {
  if (l0 === null || l1 === null) return null;
  if (!Number.isFinite(l0) || !Number.isFinite(l1)) return null;
  return l0 - l1;
}

export function calcRiderSag(l0: number | null, l2: number | null): number | null {
  if (l0 === null || l2 === null) return null;
  if (!Number.isFinite(l0) || !Number.isFinite(l2)) return null;
  return l0 - l2;
}

export function calcSagPct(sagMm: number | null, travelMm: number | null): number | null {
  if (sagMm === null || travelMm === null) return null;
  if (!Number.isFinite(sagMm) || !Number.isFinite(travelMm) || travelMm <= 0) return null;
  return (sagMm / travelMm) * 100;
}

export function parseMeasurement(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function roundForDisplay(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(1);
}

/** The measurements a saved sag entry carries, per axle. */
export interface SagEntryMeasurements {
  front_l0: number | null;
  front_l1: number | null;
  front_l2: number | null;
  rear_l0: number | null;
  rear_l1: number | null;
  rear_l2: number | null;
}

export interface SagAxleSummary {
  axle: 'Front' | 'Rear';
  freeSagMm: number | null;
  riderSagMm: number | null;
}

/**
 * What a saved entry actually says, for the history list.
 *
 * The list used to print a label and a timestamp and nothing else, so an entry
 * saved without a label read "Untitled Entry" and a column of them was
 * indistinguishable - the rider had to load each one, destroying whatever was on
 * screen, to find out which was which. An axle with no usable measurement is left
 * out rather than shown as a row of dashes.
 */
export function summarizeSagEntry(entry: SagEntryMeasurements): SagAxleSummary[] {
  const axles: [SagAxleSummary['axle'], number | null, number | null, number | null][] = [
    ['Front', entry.front_l0, entry.front_l1, entry.front_l2],
    ['Rear', entry.rear_l0, entry.rear_l1, entry.rear_l2],
  ];

  return axles.flatMap(([axle, l0, l1, l2]) => {
    const freeSagMm = calcFreeSag(l0, l1);
    const riderSagMm = calcRiderSag(l0, l2);
    if (freeSagMm === null && riderSagMm === null) return [];
    return [{ axle, freeSagMm, riderSagMm }];
  });
}
