import { afterEach, describe, expect, it } from 'vitest';
import { readTimeFormat, writeTimeFormat } from '@/lib/time-format';

describe('when Web Storage refuses the time format write', () => {
  const realLocalStorage = globalThis.localStorage;

  interface FakeStorage {
    getItem: () => string | null;
    setItem: (key: string, value: string) => void;
  }

  function installStorage(storage: FakeStorage) {
    const fakeWindow = { localStorage: storage, dispatchEvent: () => true };
    Object.defineProperty(globalThis, 'window', { value: fakeWindow, configurable: true, writable: true });
    Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
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

  it('answers with the format the rider chose, over the one still in the key', () => {
    // Every clock reads the format through readTimeFormat, so a toggle that
    // moved and a read that did not would leave the screens on the old format.
    installStorage(refusingStorage(() => '12h'));

    writeTimeFormat('24h');

    expect(readTimeFormat()).toBe('24h');
  });

  it('stands down when another tab writes the key', () => {
    let stored: string | null = null;
    installStorage(refusingStorage(() => stored));

    writeTimeFormat('24h');
    stored = '12h';

    expect(readTimeFormat()).toBe('12h');
  });

  it('lets the store answer again once a write succeeds', () => {
    let stored: string | null = '12h';
    let refuse = true;
    installStorage({
      getItem: () => stored,
      setItem: (_key, value) => {
        if (refuse) throw new Error('QuotaExceededError');
        stored = value;
      },
    });

    writeTimeFormat('24h');
    refuse = false;
    writeTimeFormat('12h');

    expect(readTimeFormat()).toBe('12h');
  });
});
