'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { useRiderClock } from '@/components/service-book/rider-clock';
import { cancelServiceBookHandover } from '@/lib/actions/service-book-transfers';
import { describeHandoverState, type ServiceBookHandoverRow } from '@/lib/service-book/handover';
import { cn } from '@/lib/utils';

interface HandoverStatusProps {
  vehicleId: string;
  handover: ServiceBookHandoverRow;
  /** Whether to link the handover screen beside the line; the screen itself does not. */
  linkToScreen?: boolean;
  className?: string;
}

/**
 * The one line a pending handover adds to the garage card, the book and the
 * handover screen: how long the link has left, or that it has run out, with
 * Cancel (owner, TQ4: one link per bike, cancel to reissue). The seller's
 * screens change in no other way while a link is out - the bike is theirs
 * until the buyer accepts.
 *
 * Expiry is read against the rider's clock, after mount, so a server render
 * carries no day count; and a cancelled link leaves the screen from this
 * component's own state ahead of the server's next render.
 */
export function HandoverStatus({ vehicleId, handover, linkToScreen = false, className }: HandoverStatusProps) {
  const router = useRouter();
  const clock = useRiderClock();
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  if (cancelled || !clock) return null;
  const state = describeHandoverState(handover, new Date());
  if (!state) return null;

  function cancel() {
    setError('');
    startTransition(async () => {
      const result = await cancelServiceBookHandover(vehicleId, handover.id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setCancelled(true);
      router.refresh();
    });
  }

  return (
    <div className={cn('rounded-row bg-surface-2 p-4', className)} data-testid="handover-status" data-state={state.kind}>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className={cn('text-sm font-medium', state.kind === 'expired' ? 'text-ink-dim' : 'text-signal')}>{state.text}</p>
          <p className="mt-0.5 break-words text-xs text-ink-faint">
            For {handover.to_email_normalized}
            {linkToScreen ? (
              <>
                {' · '}
                <Link href={`/garage/${vehicleId}/book/handover`} className="text-ink-dim hover:text-ink">
                  Details
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <Button type="button" variant="destructive" size="sm" onClick={cancel} disabled={isPending} aria-label="Cancel this handover">
          Cancel
        </Button>
      </div>
      {error ? (
        <p className="mt-2 text-sm text-slower" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
