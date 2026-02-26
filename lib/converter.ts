export type ConverterCategory =
  | 'pressure'
  | 'temperature'
  | 'torque'
  | 'mass'
  | 'volume'
  | 'spring_rate'
  | 'length'
  | 'speed';

export interface ConverterPair {
  category: ConverterCategory;
  fromUnit: string;
  toUnit: string;
}

export interface ConverterCategoryConfig {
  id: ConverterCategory;
  label: string;
  units: string[];
}

export const converterCategories: ConverterCategoryConfig[] = [
  { id: 'pressure', label: 'Pressure', units: ['psi', 'bar', 'kPa'] },
  { id: 'temperature', label: 'Temperature', units: ['F', 'C'] },
  { id: 'torque', label: 'Torque', units: ['Nm', 'ft-lb'] },
  { id: 'mass', label: 'Mass', units: ['lb', 'kg'] },
  { id: 'volume', label: 'Volume', units: ['gal', 'qt', 'pt', 'L', 'oz', 'ml'] },
  { id: 'spring_rate', label: 'Spring Rate', units: ['N/mm', 'kgf/mm', 'lb/in'] },
  { id: 'length', label: 'Length', units: ['mm', 'cm', 'in'] },
  { id: 'speed', label: 'Speed', units: ['mph', 'km/h', 'm/s'] },
];

export const corePresetPairs: ConverterPair[] = [
  { category: 'pressure', fromUnit: 'psi', toUnit: 'bar' },
  { category: 'temperature', fromUnit: 'F', toUnit: 'C' },
  { category: 'torque', fromUnit: 'Nm', toUnit: 'ft-lb' },
  { category: 'spring_rate', fromUnit: 'N/mm', toUnit: 'lb/in' },
  { category: 'length', fromUnit: 'mm', toUnit: 'in' },
  { category: 'speed', fromUnit: 'mph', toUnit: 'km/h' },
];

export function convertValue(
  category: ConverterCategory,
  fromUnit: string,
  toUnit: string,
  value: number | null,
): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  if (fromUnit === toUnit) return value;

  switch (category) {
    case 'pressure':
      return convertPressure(fromUnit, toUnit, value);
    case 'temperature':
      return convertTemperature(fromUnit, toUnit, value);
    case 'torque':
      return convertTorque(fromUnit, toUnit, value);
    case 'mass':
      return convertMass(fromUnit, toUnit, value);
    case 'volume':
      return convertVolume(fromUnit, toUnit, value);
    case 'spring_rate':
      return convertSpringRate(fromUnit, toUnit, value);
    case 'length':
      return convertLength(fromUnit, toUnit, value);
    case 'speed':
      return convertSpeed(fromUnit, toUnit, value);
    default:
      return null;
  }
}

export function parseConverterInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

export function formatConverterResult(value: number | null): string {
  if (value === null) return '—';
  const rounded = Number(value.toFixed(3));
  return rounded.toString();
}

function convertPressure(from: string, to: string, value: number): number | null {
  const toKpaMap: Record<string, number> = {
    psi: 6.89475729,
    bar: 100,
    kPa: 1,
  };
  const fromKpaMap: Record<string, number> = {
    psi: 1 / 6.89475729,
    bar: 1 / 100,
    kPa: 1,
  };

  const toKpa = toKpaMap[from];
  const fromKpa = fromKpaMap[to];
  if (!toKpa || !fromKpa) return null;
  return value * toKpa * fromKpa;
}

function convertTemperature(from: string, to: string, value: number): number | null {
  if (from === 'F' && to === 'C') return ((value - 32) * 5) / 9;
  if (from === 'C' && to === 'F') return (value * 9) / 5 + 32;
  return null;
}

function convertTorque(from: string, to: string, value: number): number | null {
  if (from === 'Nm' && to === 'ft-lb') return value * 0.737562149;
  if (from === 'ft-lb' && to === 'Nm') return value * 1.35581795;
  return null;
}

function convertMass(from: string, to: string, value: number): number | null {
  if (from === 'kg' && to === 'lb') return value * 2.20462262;
  if (from === 'lb' && to === 'kg') return value * 0.45359237;
  return null;
}

function convertVolume(from: string, to: string, value: number): number | null {
  const toMlMap: Record<string, number> = {
    gal: 3785.41178,
    qt: 946.352946,
    pt: 473.176473,
    L: 1000,
    oz: 29.5735296,
    ml: 1,
  };

  const toMl = toMlMap[from];
  const fromMl = toMlMap[to];
  if (!toMl || !fromMl) return null;

  return (value * toMl) / fromMl;
}

function convertSpringRate(from: string, to: string, value: number): number | null {
  const toNPerMmMap: Record<string, number> = {
    'N/mm': 1,
    'kgf/mm': 9.80665,
    'lb/in': 0.175126835,
  };

  const toNPerMm = toNPerMmMap[from];
  const fromNPerMm = toNPerMmMap[to];
  if (!toNPerMm || !fromNPerMm) return null;

  return (value * toNPerMm) / fromNPerMm;
}

function convertLength(from: string, to: string, value: number): number | null {
  const toMmMap: Record<string, number> = {
    mm: 1,
    cm: 10,
    in: 25.4,
  };

  const toMm = toMmMap[from];
  const fromMm = toMmMap[to];
  if (!toMm || !fromMm) return null;

  return (value * toMm) / fromMm;
}

function convertSpeed(from: string, to: string, value: number): number | null {
  const toMetersPerSecondMap: Record<string, number> = {
    mph: 0.44704,
    'km/h': 0.2777777778,
    'm/s': 1,
  };

  const toMetersPerSecond = toMetersPerSecondMap[from];
  const fromMetersPerSecond = toMetersPerSecondMap[to];
  if (!toMetersPerSecond || !fromMetersPerSecond) return null;

  return (value * toMetersPerSecond) / fromMetersPerSecond;
}
