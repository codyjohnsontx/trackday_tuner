import Link from 'next/link';
import type { Session } from '@/types';

interface SessionCardProps {
  session: Session;
  vehicleNickname: string;
}

const conditionLabel: Record<string, string> = {
  sunny: 'Sunny',
  overcast: 'Overcast',
  rainy: 'Rainy',
  mixed: 'Mixed',
};

export function SessionCard({ session, vehicleNickname }: SessionCardProps) {
  // Append time to avoid timezone date shift
  const date = new Date(`${session.date}T00:00:00`);
  const formattedDate = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <li>
      <Link
        href={`/sessions/${session.id}`}
        className="block rounded-2xl border border-zinc-800 bg-zinc-900/60 p-4 transition hover:border-zinc-700"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-semibold text-zinc-100">
              {session.track_name ?? 'Unknown Track'}
            </p>
            <p className="mt-0.5 truncate text-sm text-zinc-400">
              {vehicleNickname} · {formattedDate}
            </p>
          </div>
          <span className="shrink-0 rounded-lg border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs font-semibold text-zinc-300">
            {conditionLabel[session.conditions] ?? session.conditions}
          </span>
        </div>
      </Link>
    </li>
  );
}
