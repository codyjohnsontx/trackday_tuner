'use client';

import { useTransition, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { createVehicle } from '@/lib/actions/vehicles';
import type { VehicleType } from '@/types';

export function VehicleForm() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [nickname, setNickname] = useState('');
  const [type, setType] = useState<VehicleType>('motorcycle');
  const [year, setYear] = useState('');
  const [make, setMake] = useState('');
  const [model, setModel] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage('');

    const parsedYear = year.trim() ? Number(year.trim()) : null;
    if (parsedYear !== null && (!Number.isInteger(parsedYear) || parsedYear < 1885 || parsedYear > 2100)) {
      setErrorMessage('Please enter a valid year.');
      return;
    }

    startTransition(async () => {
      const result = await createVehicle({
        nickname: nickname.trim(),
        type,
        year: parsedYear,
        make: make.trim() || null,
        model: model.trim() || null,
      });

      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      router.push('/garage');
      router.refresh();
    });
  }

  return (
    <form className="space-y-5" onSubmit={handleSubmit}>
      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Vehicle Type
          </span>
          <div className="grid grid-cols-2 gap-2 rounded-xl bg-zinc-950 p-1">
            <Button
              type="button"
              variant={type === 'motorcycle' ? 'primary' : 'secondary'}
              className="min-h-10"
              onClick={() => setType('motorcycle')}
            >
              Motorcycle
            </Button>
            <Button
              type="button"
              variant={type === 'car' ? 'primary' : 'secondary'}
              className="min-h-10"
              onClick={() => setType('car')}
            >
              Car
            </Button>
          </div>
        </div>

        <Input
          label="Nickname"
          type="text"
          placeholder="e.g. Track Weapon, R6 Cup Bike"
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          required
          autoComplete="off"
        />
      </div>

      <div className="space-y-3 rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
        <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Optional Details
        </span>
        <Input
          label="Year"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="e.g. 2023"
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
        <Input
          label="Make"
          type="text"
          placeholder="e.g. Yamaha, Honda, BMW"
          value={make}
          onChange={(e) => setMake(e.target.value)}
          autoComplete="off"
        />
        <Input
          label="Model"
          type="text"
          placeholder="e.g. R6, CBR600RR, M3"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          autoComplete="off"
        />
      </div>

      {errorMessage ? (
        <p className="mt-3 text-sm text-rose-300">{errorMessage}</p>
      ) : null}

      <Button
        type="submit"
        fullWidth
        disabled={isPending || !nickname.trim()}
      >
        {isPending ? 'Saving...' : 'Add Vehicle'}
      </Button>
    </form>
  );
}
