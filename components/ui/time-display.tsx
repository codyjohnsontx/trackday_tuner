'use client';

import { useState, useEffect } from 'react';
import {
  TIME_FORMAT_CHANGE_EVENT,
  TIME_FORMAT_STORAGE_KEY,
  formatSessionClockTime,
  readTimeFormat,
  type TimeFormat,
} from '@/lib/time-format';

export function TimeDisplay({ time }: { time: string | null }) {
  const [format, setFormat] = useState<TimeFormat>('12h');

  useEffect(() => {
    setFormat(readTimeFormat());

    const onCustom = () => setFormat(readTimeFormat());
    const onStorage = (e: StorageEvent) => {
      if (e.key === TIME_FORMAT_STORAGE_KEY) setFormat(readTimeFormat());
    };

    window.addEventListener(TIME_FORMAT_CHANGE_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(TIME_FORMAT_CHANGE_EVENT, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  if (!time) {
    return <span className="text-sm font-medium text-zinc-100">—</span>;
  }

  return (
    <span className="text-sm font-medium text-zinc-100">{formatSessionClockTime(time, format)}</span>
  );
}
