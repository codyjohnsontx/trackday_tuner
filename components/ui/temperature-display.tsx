'use client';

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  TEMPERATURE_UNIT_CHANGE_EVENT,
  TEMPERATURE_UNIT_STORAGE_KEY,
  convertTemperatureInput,
  formatTemperature,
  readTemperatureUnit,
  type TemperatureUnit,
} from '@/lib/temperature';
import { cn } from '@/lib/utils';

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

/**
 * Raw text sitting in a temperature field, re-expressed when the rider flips
 * their unit - in Settings, or in another tab - so the 68 in the box keeps
 * meaning the temperature they typed instead of becoming 68 of the other unit.
 * Drop-in for `useState`, so every field that asks for a temperature gets this.
 *
 * Which unit the text is written in comes from storage rather than from `unit`,
 * which starts at Celsius so the server and the first client render agree. The
 * preference it settles to on mount is one the field was already filled in, so
 * treating that settle as a flip converts a restored draft a second time.
 */
export function useTemperatureInput(
  initialValue = '',
): [string, Dispatch<SetStateAction<string>>] {
  const unit = useTemperatureUnit();
  const [value, setValue] = useState(initialValue);
  const expressedUnitRef = useRef<TemperatureUnit | null>(null);

  useEffect(() => {
    const stored = readTemperatureUnit();
    const expressed = expressedUnitRef.current;
    expressedUnitRef.current = stored;
    // `unit` is what re-runs this, so a flip is only a flip once the two agree.
    if (expressed === null || expressed === stored || unit !== stored) return;
    setValue((raw) => convertTemperatureInput(raw, expressed, stored));
  }, [unit]);

  return [value, setValue];
}

/** A stored Celsius reading, shown in whichever unit the rider reads in. */
export function TemperatureDisplay({
  celsius,
  className,
}: {
  celsius: number | null;
  className?: string;
}) {
  const unit = useTemperatureUnit();
  const classes = cn('text-sm font-medium text-ink', className);

  if (celsius === null || !Number.isFinite(celsius)) {
    return <span className={classes}>—</span>;
  }

  return <span className={classes}>{formatTemperature(celsius, unit)}</span>;
}
