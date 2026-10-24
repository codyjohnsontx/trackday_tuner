'use client';

import { PreferenceToggle } from '@/components/settings/preference-toggle';
import { useTemperatureUnit } from '@/components/ui/temperature-display';
import { writeTemperatureUnit } from '@/lib/temperature';

const OPTIONS = [
  { value: 'c' as const, label: '°C' },
  { value: 'f' as const, label: '°F' },
];

export function TemperatureUnitSettings() {
  const unit = useTemperatureUnit();

  return (
    <PreferenceToggle
      title="Temperature"
      description="The unit you enter and read ambient and track temperatures in. Readings are stored in Celsius either way, so changing this never rewrites what you have logged."
      label="Unit"
      groupLabel="Temperature unit"
      options={OPTIONS}
      value={unit}
      onChange={writeTemperatureUnit}
    />
  );
}
