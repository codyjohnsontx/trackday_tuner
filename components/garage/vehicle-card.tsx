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
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold text-zinc-100">{vehicle.nickname}</p>
          {subtitle ? (
            <p className="mt-0.5 truncate text-sm text-zinc-400">{subtitle}</p>
          ) : null}
        </div>
        <span className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-zinc-300">
          {vehicle.type}
        </span>
      </div>
    </li>
  );
}
