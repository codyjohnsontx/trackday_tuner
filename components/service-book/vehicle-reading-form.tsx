'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { addVehicleReading } from '@/lib/actions/service-book';
import { todayLocalDate } from '@/lib/local-date';
import { parseNumberText } from '@/lib/service-book/format';
import type { Tables } from '@/types/supabase';

interface VehicleReadingFormProps {
  vehicleId: string;
  book: Pick<Tables<'service_books'>, 'tracks_hours' | 'tracks_distance' | 'distance_unit'>;
}

/**
 * Logs a reading off the hour meter or odometer. Readings are the truth about
 * usage (owner, Q2), so this is the one write the usage panel offers. The date
 * is seeded from the rider's own calendar day after mount, never from the
 * server's clock.
 */
export function VehicleReadingForm({ vehicleId, book }: VehicleReadingFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState('');
  const [hours, setHours] = useState('');
  const [distance, setDistance] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (open && date === '') setDate(todayLocalDate());
  }, [open, date]);

  if (!open) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Log a reading
      </Button>
    );
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const parsedHours = parseNumberText(hours);
    const parsedDistance = parseNumberText(distance);
    if (!parsedHours.ok || !parsedDistance.ok) {
      setError('A reading has to be a number.');
      return;
    }
    const hoursValue = book.tracks_hours ? parsedHours.value : null;
    const distanceValue = book.tracks_distance ? parsedDistance.value : null;
    if (hoursValue === null && distanceValue === null) {
      setError(book.tracks_hours && book.tracks_distance ? 'Enter the hours, the mileage, or both.' : 'Enter the reading.');
      return;
    }
    startTransition(async () => {
      const result = await addVehicleReading(vehicleId, { reading_date: date, hours: hoursValue, distance: distanceValue });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setHours('');
      setDistance('');
      setDate('');
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-row bg-surface-2 p-4" aria-label="Log a reading">
      <div className="grid gap-3 sm:grid-cols-3">
        <Input label="Reading date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
        {book.tracks_hours ? (
          <Input label="Hours" type="number" inputMode="decimal" step="any" min={0} value={hours} onChange={(e) => setHours(e.target.value)} placeholder="41.5" />
        ) : null}
        {book.tracks_distance ? (
          <Input
            label={`Distance (${book.distance_unit})`}
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            value={distance}
            onChange={(e) => setDistance(e.target.value)}
            placeholder="1240"
          />
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-slower" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" loading={isPending}>
          Save reading
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
