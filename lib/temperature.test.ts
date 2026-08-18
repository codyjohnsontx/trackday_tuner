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

describe('rounding at a decimal tie', () => {
  it('breaks a tie toward positive infinity, not away from zero', () => {
    // Math.round on the exponent-shifted decimal, so a tie goes up rather than
    // outward: -17.25 reads -17.2, where half-away-from-zero would say -17.3.
    // These pin the convention and nothing more - the multiply-then-round this
    // replaced agrees on every genuine tie, so they would pass against it too.
    expect(toDisplayTemperature(17.25, 'c')).toBe(17.3);
    expect(toDisplayTemperature(-17.25, 'c')).toBe(-17.2);
    expect(toDisplayTemperature(-0.15, 'c')).toBe(-0.1);
  });

  it('rounds a near-tie by where the double actually sits', () => {
    // This one does discriminate, and it is the reason the describe above can be
    // honest about not doing so. -35.25 C is not -31.45 F but
    // -31.450000000000003, just past the tie and therefore rounding away from
    // it; multiplying by ten pulls that double back onto exactly -314.5, which
    // then ties upward to the wrong decimal. Across every hundredth of a degree
    // from -40 to 160 F and -40 to 95 C the two roundings differ on exactly two
    // inputs, both negative near-ties like this. So no rider was seeing a wrong
    // number - the defect was a false comment, claiming a Number.EPSILON nudge
    // fixed something it is too small to move at this magnitude.
    expect(celsiusToFahrenheit(-35.25)).toBe(-31.450000000000003);
    expect(convertTemperatureInput('-35.25', 'c', 'f')).toBe('-31.5');
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

  it('keeps storage precision on the way into Celsius', () => {
    // Celsius is the stored unit. Rounding 92 F to 33.3 C here means the rider's
    // own number reads back as 91.9 F the next time they look at it.
    expect(convertTemperatureInput('92', 'f', 'c')).toBe('33.33');
    expect(toDisplayTemperature(Number(convertTemperatureInput('92', 'f', 'c')), 'f')).toBe(92);
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
