'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { deleteVehicle } from '@/lib/actions/vehicles';
import {
  describeVehicleDeletion,
  nicknameConfirmationMatches,
  type VehicleDeletionCounts,
} from '@/lib/vehicle-delete';

interface VehicleDeleteFormProps {
  vehicleId: string;
  nickname: string;
  counts: VehicleDeletionCounts;
}

/**
 * The delete for a whole bike. It takes every session logged on it, so it is
 * the one destructive action here gated on typing rather than a hold: the rider
 * has to read the name - and the counts beside it - to get the button at all.
 */
export function VehicleDeleteForm({ vehicleId, nickname, counts }: VehicleDeleteFormProps) {
  const router = useRouter();
  const [typed, setTyped] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [isPending, startTransition] = useTransition();
  const confirmed = nicknameConfirmationMatches(typed, nickname);

  function handleDelete() {
    if (!confirmed || isPending) return;

    setErrorMessage('');
    startTransition(async () => {
      const result = await deleteVehicle(vehicleId, counts.sessionCount);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      router.push('/garage');
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-sm leading-6 text-ink">{describeVehicleDeletion(nickname, counts)}</p>
      <Input
        label={`Type ${nickname} to confirm`}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        disabled={isPending}
      />
      <Button
        type="button"
        variant="destructive"
        fullWidth
        onClick={handleDelete}
        loading={isPending}
        disabled={!confirmed || isPending}
      >
        {isPending ? 'Deleting…' : 'Delete vehicle'}
      </Button>
      {errorMessage ? (
        <p className="text-sm text-slower" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
