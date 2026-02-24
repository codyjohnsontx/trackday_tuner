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
