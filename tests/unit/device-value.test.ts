import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hydratedStore, preferenceSubscription, useHydrated } from '@/components/ui/device-value';

// The unit suite has no DOM, so the client half of `useSyncExternalStore` is
// checked through the store it is handed rather than through a mounted tree.

function HydratedProbe() {
  return createElement('span', null, useHydrated() ? 'device' : 'server');
}

describe('useHydrated', () => {
  it('renders without the device on the server, so hydration has nothing to disagree with', () => {
    expect(renderToStaticMarkup(createElement(HydratedProbe))).toBe('<span>server</span>');
  });

  it('answers false for the server and hydrating render and true on the client after', () => {
    expect(hydratedStore.getServerSnapshot()).toBe(false);
    expect(hydratedStore.getSnapshot()).toBe(true);
  });
});

describe('preferenceSubscription', () => {
  const KEY = 'tracktuner_test_preference';
  const EVENT = 'tracktuner:test-preference';

  function installWindow() {
    const target = new EventTarget();
    Object.defineProperty(globalThis, 'window', { value: target, configurable: true, writable: true });
    return target;
  }

  function storageEvent(key: string | null) {
    // Node has no StorageEvent; the subscription reads `key` and nothing else.
    return Object.assign(new Event('storage'), { key });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true, writable: true });
  });

  it('notifies when this tab flips the preference', () => {
    const target = installWindow();
    const onChange = vi.fn();
    preferenceSubscription(KEY, EVENT)(onChange);

    target.dispatchEvent(new CustomEvent(EVENT, { detail: 'f' }));

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('notifies when another tab writes its key, and only its key', () => {
    const target = installWindow();
    const onChange = vi.fn();
    preferenceSubscription(KEY, EVENT)(onChange);

    target.dispatchEvent(storageEvent('some_other_key'));
    expect(onChange).not.toHaveBeenCalled();

    target.dispatchEvent(storageEvent(KEY));
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('stops notifying once unsubscribed', () => {
    const target = installWindow();
    const onChange = vi.fn();
    const unsubscribe = preferenceSubscription(KEY, EVENT)(onChange);

    unsubscribe();
    target.dispatchEvent(new CustomEvent(EVENT, { detail: 'f' }));
    target.dispatchEvent(storageEvent(KEY));

    expect(onChange).not.toHaveBeenCalled();
  });
});
