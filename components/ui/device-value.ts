'use client';

import { useSyncExternalStore } from 'react';

/**
 * Values only the rider's device knows - today's date in their calendar, their
 * time zone, a localStorage preference, a draft - cannot be rendered by the
 * server, so the server render and the hydrating client render both go without
 * them and the device's answer arrives in the render straight after. These are
 * the two ways this app reads one, both through `useSyncExternalStore`, which is
 * what keeps those two first renders identical without an effect that sets state.
 */

function subscribeToNothing(): () => void {
  return () => {};
}

export const hydratedStore = {
  subscribe: subscribeToNothing,
  getSnapshot: (): boolean => true,
  getServerSnapshot: (): boolean => false,
};

/**
 * False on the server and on the render that hydrates, true from then on (and
 * from the first render of a component mounted later by client navigation). A
 * value read off the device is read only once this is true.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    hydratedStore.subscribe,
    hydratedStore.getSnapshot,
    hydratedStore.getServerSnapshot,
  );
}

/**
 * A subscription to a localStorage preference: the change event this tab
 * dispatches when the rider flips it, and the `storage` event another tab's
 * write raises on this one. Created once per preference at module scope, so
 * `useSyncExternalStore` keeps one subscription per component.
 */
export function preferenceSubscription(storageKey: string, changeEvent: string) {
  return (onChange: () => void): (() => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === storageKey) onChange();
    };
    window.addEventListener(changeEvent, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(changeEvent, onChange);
      window.removeEventListener('storage', onStorage);
    };
  };
}
