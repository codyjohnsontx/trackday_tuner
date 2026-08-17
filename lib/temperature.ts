/**
 * Temperature is stored in Celsius everywhere - the database columns, the AI
 * prompts, the CSV export - and this module is the only place it becomes a number
 * the rider reads or types.
 *
 * Before it existed the app only spoke Celsius. The session form labelled its
 * fields "(C)" and validated -40..70, and the Race Engineer's ambient field capped
 * at 70 too, so an American rider entering a summer ambient of 88 F could not
 * submit at all, while 68 F went in as 68 C - 154 F - and was then reasoned about
 * as a real reading by the prompt and the comparison page's context flags.
 *
 * The rider's unit is a display preference held on their device, alongside the
 * 12h/24h clock preference; conversion happens at the edge and Celsius stays the
 * single stored unit, so nothing downstream has to ask.
 */

export const TEMPERATURE_UNIT_STORAGE_KEY = 'tracktuner_temperature_unit';

export type TemperatureUnit = 'c' | 'f';

export const TEMPERATURE_UNIT_CHANGE_EVENT = 'tracktuner:temperature-unit';

export function parseTemperatureUnit(value: string | null): TemperatureUnit {
  return value === 'f' ? 'f' : 'c';
}

/**
 * What the rider chose when storage would not keep it - Safari private mode, a
 * full quota, storage disabled. Without this the label follows the new unit while
 * every reader of the stored preference still says Celsius, and the session form
 * stores a Fahrenheit number as if it were Celsius: the exact defect this module
 * exists to close, arriving through the failure path instead.
 */
let unitFallback: TemperatureUnit | null = null;
/**
 * What the store still held when that write was refused. A rider who had already
 * saved a preference leaves the old value sitting in the key, so without this the
 * store would answer for a choice it never accepted and the new unit would revert
 * on the next read - a toggle that moved on screen and changed nothing.
 */
let unitFallbackShadowed: string | null = null;

function readStoredUnit(): string | null {
  try {
    return localStorage.getItem(TEMPERATURE_UNIT_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function readTemperatureUnit(): TemperatureUnit {
  if (typeof window === 'undefined') return 'c';
  const stored = readStoredUnit();

  if (unitFallback !== null) {
    // The fallback outranks the value it was refused against, and only that one:
    // anything else in the key is a later choice - another tab writing it - and a
    // readable store is authoritative again.
    if (stored === unitFallbackShadowed) return unitFallback;
    unitFallback = null;
    unitFallbackShadowed = null;
  }

  return stored === null ? 'c' : parseTemperatureUnit(stored);
}

export function writeTemperatureUnit(unit: TemperatureUnit): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(TEMPERATURE_UNIT_STORAGE_KEY, unit);
    unitFallback = null;
    unitFallbackShadowed = null;
  } catch {
    // Storage refused it, so `unitFallback` is now the only record of the choice
    // and readTemperatureUnit() answers from there until a write succeeds.
    unitFallback = unit;
    unitFallbackShadowed = readStoredUnit();
  }
  window.dispatchEvent(
    new CustomEvent<TemperatureUnit>(TEMPERATURE_UNIT_CHANGE_EVENT, { detail: unit }),
  );
}

export function celsiusToFahrenheit(celsius: number): number {
  return celsius * 1.8 + 32;
}

export function fahrenheitToCelsius(fahrenheit: number): number {
  return (fahrenheit - 32) / 1.8;
}

export function temperatureUnitSuffix(unit: TemperatureUnit): string {
  return unit === 'f' ? '°F' : '°C';
}

function round(value: number, places: number): number {
  const factor = 10 ** places;
  // Number.EPSILON nudges values that land on a floating-point tie (33.35 is held
  // as 33.34999...) up to the decimal the rider actually typed.
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  // 0 F stores as -17.78 C and reads back as -0.004, which rounds to -0.
  // Freezing point is not a negative temperature.
  return rounded === 0 ? 0 : rounded;
}

/** A stored Celsius reading as the number shown in the rider's unit. */
export function toDisplayTemperature(celsius: number, unit: TemperatureUnit): number {
  return round(unit === 'f' ? celsiusToFahrenheit(celsius) : celsius, 1);
}

/**
 * A number the rider typed in their unit, as the Celsius value that gets stored.
 * Two decimals is what makes the round trip stable: 92 F stored as 33.33 C reads
 * back as 92.0 F, where one decimal would drift to 91.9 F.
 */
export function toStoredCelsius(value: number, unit: TemperatureUnit): number {
  return unit === 'f' ? round(fahrenheitToCelsius(value), 2) : value;
}

/** A stored Celsius reading as rider-facing text, e.g. `24°C` or `75.2°F`. */
export function formatTemperature(celsius: number, unit: TemperatureUnit): string {
  return `${toDisplayTemperature(celsius, unit)}${temperatureUnitSuffix(unit)}`;
}

/**
 * Re-express the raw text sitting in a number input when the rider flips the
 * unit. Blank or unparseable text (a lone "-") is handed back untouched rather
 * than blanked out mid-keystroke.
 */
export function convertTemperatureInput(
  raw: string,
  from: TemperatureUnit,
  to: TemperatureUnit,
): string {
  if (from === to) return raw;
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return raw;
  const celsius = from === 'f' ? fahrenheitToCelsius(parsed) : parsed;
  return String(round(to === 'f' ? celsiusToFahrenheit(celsius) : celsius, 1));
}

/**
 * A Celsius validation bound as the whole number to quote and enforce in the
 * rider's unit. Rounded outward so the bound itself stays reachable: -40 C is
 * -40 F exactly, and 70 C is 158 F.
 */
export function displayTemperatureBound(celsiusBound: number, unit: TemperatureUnit): number {
  return Math.round(toDisplayTemperature(celsiusBound, unit));
}
