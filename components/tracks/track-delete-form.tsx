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
    const confirmed = window.confirm('Delete this custom track? This cannot be undone.');
    if (!confirmed) return;

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
        variant="secondary"
        className="w-full border-rose-800 bg-rose-950/40 text-rose-200 hover:bg-rose-900/50"
        onClick={handleDelete}
        disabled={isPending}
      >
        {isPending ? 'Deleting...' : 'Delete Track'}
      </Button>
      {errorMessage ? <p className="text-sm text-rose-300">{errorMessage}</p> : null}
    </div>
  );
}
