'use client';

import { useEffect, useState } from 'react';
import {
  TEMPERATURE_UNIT_CHANGE_EVENT,
  TEMPERATURE_UNIT_STORAGE_KEY,
  formatTemperature,
  readTemperatureUnit,
  type TemperatureUnit,
} from '@/lib/temperature';

/**
 * The rider's temperature unit, kept in step with the Settings toggle and with
 * other tabs. Starts at Celsius so the server and the first client render agree;
 * the stored preference arrives on mount.
 */
export function useTemperatureUnit(): TemperatureUnit {
  const [unit, setUnit] = useState<TemperatureUnit>('c');

  useEffect(() => {
    setUnit(readTemperatureUnit());

    const onCustom = (event: Event) => setUnit((event as CustomEvent<TemperatureUnit>).detail);
    const onStorage = (event: StorageEvent) => {
      if (event.key === TEMPERATURE_UNIT_STORAGE_KEY) setUnit(readTemperatureUnit());
    };

    window.addEventListener(TEMPERATURE_UNIT_CHANGE_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(TEMPERATURE_UNIT_CHANGE_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  return unit;
}

/** A stored Celsius reading, shown in whichever unit the rider reads in. */
export function TemperatureDisplay({ celsius }: { celsius: number | null }) {
  const unit = useTemperatureUnit();

  if (celsius === null || !Number.isFinite(celsius)) {
    return <span className="text-sm font-medium text-ink">—</span>;
  }

  return <span className="text-sm font-medium text-ink">{formatTemperature(celsius, unit)}</span>;
}
