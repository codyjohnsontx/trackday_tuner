import { afterEach, describe, expect, it } from 'vitest';
import {
  celsiusToFahrenheit,
  convertTemperatureInput,
  displayTemperatureBound,
  fahrenheitToCelsius,
  formatTemperature,
  parseTemperatureUnit,
  readTemperatureUnit,
  toDisplayTemperature,
  toStoredCelsius,
  writeTemperatureUnit,
} from '@/lib/temperature';

describe('the rider unit preference', () => {
  it('defaults to Celsius for anything but an explicit f', () => {
    expect(parseTemperatureUnit(null)).toBe('c');
    expect(parseTemperatureUnit('')).toBe('c');
    expect(parseTemperatureUnit('fahrenheit')).toBe('c');
    expect(parseTemperatureUnit('f')).toBe('f');
  });
});

describe('converting what the rider typed into what gets stored', () => {
  it('stores a Fahrenheit ambient as the Celsius it actually is', () => {
    // The bug: 68 F went into the database as 68 C, which is 154 F.
    expect(toStoredCelsius(68, 'f')).toBe(20);
    expect(toStoredCelsius(88, 'f')).toBe(31.11);
  });

  it('leaves a Celsius reading exactly as typed', () => {
    expect(toStoredCelsius(24, 'c')).toBe(24);
    expect(toStoredCelsius(-7.5, 'c')).toBe(-7.5);
  });

  it('round-trips a typed Fahrenheit value back to the same number', () => {
    for (const fahrenheit of [0, 32, 68, 88, 92, 105, -20]) {
      expect(toDisplayTemperature(toStoredCelsius(fahrenheit, 'f'), 'f')).toBe(fahrenheit);
    }
  });

  it('does not report freezing point as minus zero', () => {
    // 0 F stores as -17.78 C, which converts back to -0.004.
    expect(Object.is(toDisplayTemperature(toStoredCelsius(0, 'f'), 'f'), 0)).toBe(true);
  });

  it('agrees with the textbook conversions', () => {
    expect(celsiusToFahrenheit(100)).toBe(212);
    expect(celsiusToFahrenheit(-40)).toBe(-40);
    expect(fahrenheitToCelsius(212)).toBe(100);
    expect(fahrenheitToCelsius(-40)).toBe(-40);
  });
});

describe('when Web Storage refuses the write', () => {
  const realLocalStorage = globalThis.localStorage;

  interface FakeStorage {
    getItem: () => string | null;
    setItem: (key: string, value: string) => void;
  }

  function installStorage(storage: FakeStorage) {
    const fakeWindow = { localStorage: storage, dispatchEvent: () => true };
    Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'localStorage', {
      value: storage,
      configurable: true,
      writable: true,
    });
  }

  function refusingStorage(stored: () => string | null): FakeStorage {
    return {
      getItem: stored,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
  }

  afterEach(() => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: realLocalStorage,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true, writable: true });
  });

  it('still answers with the unit the rider chose', () => {
    // Safari private mode, a full quota, storage disabled: setItem throws and the
    // choice would otherwise be visible in the label while every reader of the
    // preference still said Celsius - which stores a Fahrenheit number as Celsius.
    installStorage(refusingStorage(() => null));

    writeTemperatureUnit('f');

    expect(readTemperatureUnit()).toBe('f');
  });

  it('answers with it over a preference the rider saved before', () => {
    // The rider who has used the app before is the ordinary case, and their old
    // unit is still sitting in the key the refused write could not overwrite. A
    // store that answered anyway would revert the toggle they just moved.
    installStorage(refusingStorage(() => 'c'));

    writeTemperatureUnit('f');

    expect(readTemperatureUnit()).toBe('f');
  });

  it('stands down when the key holds a unit it was never refused against', () => {
    let stored: string | null = null;
    installStorage(refusingStorage(() => stored));

    writeTemperatureUnit('f');
    // Another tab wrote the key, which makes that the later choice of the two.
    stored = 'c';

    expect(readTemperatureUnit()).toBe('c');
  });

  it('lets the store answer again once a write succeeds', () => {
    let stored: string | null = 'c';
    let refuse = true;
    installStorage({
      getItem: () => stored,
      setItem: (_key, value) => {
        if (refuse) throw new Error('QuotaExceededError');
        stored = value;
      },
    });

    writeTemperatureUnit('f');
    refuse = false;
    writeTemperatureUnit('c');

    expect(readTemperatureUnit()).toBe('c');
  });
});

describe('showing a stored reading', () => {
  it('labels the unit it is showing', () => {
    expect(formatTemperature(24, 'c')).toBe('24°C');
    expect(formatTemperature(24, 'f')).toBe('75.2°F');
  });
});

describe('flipping the unit under a half-typed value', () => {
  it('re-expresses what is in the box', () => {
    expect(convertTemperatureInput('20', 'c', 'f')).toBe('68');
    expect(convertTemperatureInput('68', 'f', 'c')).toBe('20');
  });

  it('leaves text it cannot read alone rather than blanking it', () => {
    expect(convertTemperatureInput('', 'c', 'f')).toBe('');
    expect(convertTemperatureInput('-', 'c', 'f')).toBe('-');
    expect(convertTemperatureInput('  ', 'f', 'c')).toBe('  ');
  });

  it('is a no-op when the unit did not change', () => {
    expect(convertTemperatureInput('20.5', 'c', 'c')).toBe('20.5');
  });
});

describe('quoting the validation bounds', () => {
  it('states the bound in the unit the rider is typing in', () => {
    // 88 F was rejected outright because the field capped at 70, in Celsius.
    expect(displayTemperatureBound(70, 'f')).toBe(158);
    expect(displayTemperatureBound(-40, 'f')).toBe(-40);
    expect(displayTemperatureBound(95, 'f')).toBe(203);
    expect(displayTemperatureBound(70, 'c')).toBe(70);
  });
});
