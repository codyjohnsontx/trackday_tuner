'use client';

import { useEffect, useState } from 'react';
import { PreferenceToggle } from '@/components/settings/preference-toggle';
import { readTimeFormat, writeTimeFormat, type TimeFormat } from '@/lib/time-format';

const OPTIONS = [
  { value: '12h' as const, label: '12-hour' },
  { value: '24h' as const, label: '24-hour' },
];

export function TimeFormatSettings() {
  const [format, setFormat] = useState<TimeFormat>('12h');

  useEffect(() => {
    setFormat(readTimeFormat());
  }, []);

  return (
    <PreferenceToggle
      title="Time display"
      description="How session start times and other clock times appear across the app."
      label="Format"
      groupLabel="Time format"
      options={OPTIONS}
      value={format}
      onChange={(next) => {
        setFormat(next);
        writeTimeFormat(next);
      }}
    />
  );
}
