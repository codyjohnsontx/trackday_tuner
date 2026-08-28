import Link from 'next/link';
import Image from 'next/image';
import { VehicleBaselineSummary } from '@/components/garage/vehicle-baseline-summary';
import type { Vehicle, VehicleBaseline } from '@/types';

interface VehicleCardProps {
  vehicle: Vehicle;
  baseline?: VehicleBaseline | null;
  baselineLocked?: boolean;
  demoMode?: boolean;
}

export function VehicleCard({
  vehicle,
  baseline = null,
  baselineLocked = false,
  demoMode = false,
}: VehicleCardProps) {
  const subtitle = [vehicle.year, vehicle.make, vehicle.model]
    .filter(Boolean)
    .join(' ');

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
      <VehicleBaselineSummary baseline={baseline} locked={baselineLocked} />
    </li>
  );
}
