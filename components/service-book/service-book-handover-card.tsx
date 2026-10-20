import Link from 'next/link';
import { HandoverStatus } from '@/components/service-book/handover-status';
import { CardGroup, GroupRow } from '@/components/ui/surface';
import type { ServiceBookHandoverRow } from '@/lib/service-book/handover';

interface ServiceBookHandoverCardProps {
  vehicleId: string;
  /** The book's pending link, or the error reading it. */
  handover: { ok: true; data: ServiceBookHandoverRow | null } | { ok: false; error: string };
}

/**
 * The book page's way into the handover (owner, Q5: share AND transfer live
 * beside each other), under Sharing: one line on what a handover is, the link
 * to the screen, and the pending link's state with Cancel while one is out. A
 * card rather than a second header button, which at phone width wrapped the
 * page title.
 */
export function ServiceBookHandoverCard({ vehicleId, handover }: ServiceBookHandoverCardProps) {
  const pending = handover.ok ? handover.data : null;
  return (
    <CardGroup
      eyebrow="Selling it?"
      title={pending ? 'Handover pending' : 'Hand over to the buyer'}
      action={
        pending ? null : (
          <Link
            href={`/garage/${vehicleId}/book/handover`}
            className="flex min-h-11 items-center rounded-control bg-surface-3 px-3 text-xs font-semibold text-ink transition hover:bg-surface-3/70 focus-visible:ring-2 focus-visible:ring-signal/80"
          >
            Hand over to a buyer
          </Link>
        )
      }
    >
      {pending ? (
        <HandoverStatus vehicleId={vehicleId} handover={pending} linkToScreen />
      ) : (
        <GroupRow>
          <p className="text-sm text-ink-dim">
            The buyer gets this book and the bike&apos;s sessions in their own garage; you keep a read-only copy of everything up to the
            handover. Nothing changes until they accept.
          </p>
        </GroupRow>
      )}
      {!handover.ok ? (
        <GroupRow>
          <p className="text-sm text-slower" role="alert">
            {handover.error}
          </p>
        </GroupRow>
      ) : null}
    </CardGroup>
  );
}
