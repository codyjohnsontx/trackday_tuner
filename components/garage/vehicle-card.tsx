import Link from 'next/link';
import Image from 'next/image';
import type { Vehicle } from '@/types';

interface VehicleCardProps {
  vehicle: Vehicle;
}

export function VehicleCard({ vehicle }: VehicleCardProps) {
  const subtitle = [vehicle.year, vehicle.make, vehicle.model]
    .filter(Boolean)
    .join(' ');

  return (
    <li className="rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          {vehicle.photo_url ? (
            <Image
              src={vehicle.photo_url}
              alt={vehicle.nickname}
              width={48}
              height={48}
              className="h-12 w-12 shrink-0 rounded-lg object-cover"
              unoptimized
            />
          ) : null}
          <div className="min-w-0">
            <p className="truncate font-semibold text-zinc-100">{vehicle.nickname}</p>
            {subtitle ? (
              <p className="mt-0.5 truncate text-sm text-zinc-400">{subtitle}</p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-300">
            {vehicle.type}
          </span>
          <Link
            href={`/garage/${vehicle.id}/edit`}
            className="flex items-center justify-center rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs font-semibold text-zinc-300 hover:border-zinc-500 hover:text-zinc-100"
          >
            Edit →
          </Link>
        </div>
      </div>
    </li>
  );
}
