'use client';

import { useEffect, useState } from 'react';
import { PreferenceToggle } from '@/components/settings/preference-toggle';
import { readTemperatureUnit, writeTemperatureUnit, type TemperatureUnit } from '@/lib/temperature';

const OPTIONS = [
  { value: 'c' as const, label: '°C' },
  { value: 'f' as const, label: '°F' },
];

export function TemperatureUnitSettings() {
  const [unit, setUnit] = useState<TemperatureUnit>('c');

  useEffect(() => {
    setUnit(readTemperatureUnit());
  }, []);

  return (
    <PreferenceToggle
      title="Temperature"
      description="The unit you enter and read ambient and track temperatures in. Readings are stored in Celsius either way, so changing this never rewrites what you have logged."
      label="Unit"
      groupLabel="Temperature unit"
      options={OPTIONS}
      value={unit}
      onChange={(next) => {
        setUnit(next);
        writeTemperatureUnit(next);
      }}
    />
  );
}
