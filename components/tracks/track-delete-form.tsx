'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { deleteTrack } from '@/lib/actions/tracks';

interface TrackDeleteFormProps {
  trackId: string;
  redirectPath?: string;
}

export function TrackDeleteForm({ trackId, redirectPath = '/tracks' }: TrackDeleteFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState('');

  function handleDelete() {
    if (isPending) return;

    setErrorMessage('');
    startTransition(async () => {
      const result = await deleteTrack(trackId);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      router.push(redirectPath as never);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="destructive"
        fullWidth
        holdToConfirm
        holdingLabel="Keep holding…"
        onConfirm={handleDelete}
        loading={isPending}
        disabled={isPending}
      >
        {isPending ? 'Deleting…' : 'Hold to delete track'}
      </Button>
      {errorMessage ? <p className="text-sm text-rose-300">{errorMessage}</p> : null}
    </div>
  );
}
