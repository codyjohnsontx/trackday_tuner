'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/surface';
import { acceptServiceBookTransfer } from '@/lib/actions/service-book-transfer-accept';

interface HandoverAcceptProps {
  token: string;
}

/**
 * The one button on a handover link (owner, PQ2). Accepting copies the whole
 * history - a full free book is fifty storage objects plus photos - so the
 * button says so while it runs, and a refusal is shown where it was pressed
 * with the words the database's code earned. On success the buyer lands on
 * the new bike's book.
 */
export function HandoverAccept({ token }: HandoverAcceptProps) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  function accept() {
    setError('');
    startTransition(async () => {
      const result = await acceptServiceBookTransfer(token);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/garage/${result.data.vehicleId}/book`);
      router.refresh();
    });
  }

  return (
    <Card>
      <p className="text-sm text-ink-dim">
        Accepting adds this bike to your garage with everything above. It cannot be undone: once accepted, the seller&apos;s copy is marked
        sold and no longer changes.
      </p>
      {error ? (
        <p className="mt-2 text-sm text-slower" role="alert" data-testid="handover-accept-error">
          {error}
        </p>
      ) : null}
      <div className="mt-4">
        <Button type="button" fullWidth onClick={accept} loading={isPending} disabled={isPending} data-testid="handover-accept">
          {isPending ? 'Copying the history…' : 'Accept this bike'}
        </Button>
      </div>
    </Card>
  );
}
