import Link from 'next/link';
import Image from 'next/image';
import { VehicleBaselineSetup } from '@/components/garage/vehicle-baseline-setup';
import { VehicleBaselineSummary } from '@/components/garage/vehicle-baseline-summary';
import { ServiceDueChip } from '@/components/service-book/due-badges';
import { HandoverStatus } from '@/components/service-book/handover-status';
import { SoldLine } from '@/components/garage/sold-line';
import type { ServiceBookHandoverRow } from '@/lib/service-book/handover';
import type { ServiceDueData } from '@/lib/service-book/reminders';
import type { Vehicle, VehicleBaseline } from '@/types';

interface VehicleCardProps {
  vehicle: Vehicle;
  baseline?: VehicleBaseline | null;
  baselineLocked?: boolean;
  demoMode?: boolean;
  /** The bike's service-book rows for the due chip; `null` when it has no book. */
  serviceDue?: ServiceDueData | null;
  /** The bike's pending handover link, if one is out (owner, TQ4). */
  handover?: ServiceBookHandoverRow | null;
}

export function VehicleCard({
  vehicle,
  baseline = null,
  baselineLocked = false,
  demoMode = false,
  serviceDue = null,
  handover = null,
}: VehicleCardProps) {
  const subtitle = [vehicle.year, vehicle.make, vehicle.model]
    .filter(Boolean)
    .join(' ');
  // Handed to a buyer (owner, TQ3): the seller's read-only copy, still in the
  // garage with Edit (rename, delete) and the book, out of the free vehicle
  // count, and with no due chip - that comes from getServiceDueBooks, which
  // leaves a sold bike out.
  const sold = vehicle.sold_at !== null;

  return (
    <li className="space-y-3 rounded-card bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {vehicle.photo_url ? (
            <Image
              src={vehicle.photo_url}
              alt={vehicle.nickname}
              width={48}
              height={48}
              className="h-12 w-12 shrink-0 rounded-plate object-cover"
            />
          ) : null}
          <div className="min-w-0">
            <p className="truncate font-semibold text-ink">{vehicle.nickname}</p>
            {subtitle ? (
              <p className="mt-0.5 truncate text-sm text-ink-dim">{subtitle}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-plate bg-surface-3 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-dim">
            {vehicle.type}
          </span>
          {demoMode ? (
            <span className="rounded-plate bg-surface-3 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">
              Sample
            </span>
          ) : (
            <Link
              href={`/garage/${vehicle.id}/edit`}
              className="flex min-h-11 items-center justify-center rounded-control bg-surface-3 px-3 py-1 text-xs font-semibold text-ink-dim transition hover:bg-surface-3/70 hover:text-ink focus-visible:ring-2 focus-visible:ring-signal/80"
            >
              Edit →
            </Link>
          )}
        </div>
      </div>
      {/* On its own line rather than in the chip group beside the name, which
          at phone width would squeeze the nickname to three letters. */}
      {sold ? <SoldLine soldAt={vehicle.sold_at!} /> : null}
      <Link
        href={`/garage/${vehicle.id}/book`}
        className="flex min-h-11 flex-col justify-center gap-1.5 rounded-row bg-surface-2 px-4 py-3 text-sm font-medium text-ink transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
      >
        <span className="flex items-center justify-between gap-3">
          <span>Service book</span>
          <span aria-hidden="true" className="text-ink-faint">→</span>
        </span>
        {/* Derived on the rider's device from the book's rows; absent when nothing
            is due. On its own line, because an item's name plus its state does not
            fit beside the label at phone width. */}
        <ServiceDueChip data={serviceDue} className="max-w-full self-start truncate" />
      </Link>
      {handover && !sold && !demoMode ? <HandoverStatus vehicleId={vehicle.id} handover={handover} linkToScreen /> : null}
      <div>
        <VehicleBaselineSummary baseline={baseline} locked={baselineLocked} />
        {/* The stored snapshot itself, not just the label of the session it came
            from - which is all any screen showed until this was here. Behind the
            same gate the summary beside it uses, so the two halves of one card
            cannot disagree about whether this rider may read the baseline. */}
        {baseline && !baselineLocked ? (
          <VehicleBaselineSetup baseline={baseline} vehicleType={vehicle.type} />
        ) : null}
      </div>
    </li>
  );
}
