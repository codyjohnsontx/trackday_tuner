'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { deleteSession } from '@/lib/actions/sessions';

interface SessionDeleteFormProps {
  sessionId: string;
  disabled?: boolean;
}

export function SessionDeleteForm({ sessionId, disabled = false }: SessionDeleteFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [errorMessage, setErrorMessage] = useState('');

  function handleDelete() {
    if (isPending || disabled) return;

    setErrorMessage('');
    startTransition(async () => {
      const result = await deleteSession(sessionId);
      if (!result.ok) {
        setErrorMessage(result.error);
        return;
      }

      router.push('/sessions');
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
        disabled={disabled || isPending}
      >
        {isPending ? 'Deleting…' : 'Hold to delete session'}
      </Button>
      {errorMessage ? (
        <p className="text-sm text-slower" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
