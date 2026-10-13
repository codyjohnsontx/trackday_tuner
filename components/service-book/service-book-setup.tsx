'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/surface';
import { createServiceBook } from '@/lib/actions/service-book';
import { starterItemsFor } from '@/lib/service-book/starter-items';
import type { VehicleType } from '@/types/supabase';

interface ServiceBookSetupProps {
  vehicleId: string;
  nickname: string;
  vehicleType: VehicleType;
}

/**
 * A bike with no book yet. The book is created when the rider asks for it, not
 * on render: a page load must not write, and the starter items are theirs to
 * accept first.
 */
export function ServiceBookSetup({ vehicleId, nickname, vehicleType }: ServiceBookSetupProps) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const starters = starterItemsFor(vehicleType);

  function start() {
    setError('');
    startTransition(async () => {
      const result = await createServiceBook(vehicleId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <Card>
      <h2 className="text-lg font-semibold text-ink">Start the service book for {nickname}</h2>
      <p className="mt-2 text-sm text-ink-dim">
        It opens with the usual {vehicleType === 'car' ? 'car' : 'motorcycle'} items and no intervals - those are yours or the manual’s to set.
        Every entry records the day you log it apart from the date the work was done, and edits are kept as history.
      </p>
      <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Starter items">
        {starters.map((name) => (
          <li key={name} className="rounded-full bg-surface-2 px-2.5 py-1 text-xs text-ink-dim">
            {name}
          </li>
        ))}
      </ul>
      {error ? (
        <p className="mt-3 text-sm text-slower" role="alert">
          {error}
        </p>
      ) : null}
      <div className="mt-4">
        <Button type="button" onClick={start} loading={isPending}>
          Start service book
        </Button>
      </div>
    </Card>
  );
}
