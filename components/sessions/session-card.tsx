import Link from 'next/link';
import type { Session } from '@/types';
import { DataPlate } from '@/components/ui/condition';
import { Eyebrow } from '@/components/ui/surface';

interface SessionCardProps {
  session: Session;
  vehicleNickname: string;
}

function formatTime12h(t: string): string {
  const [h, m] = t.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`;
}

/**
 * A session row. Renders the link only — callers own the list semantics, so it
 * drops into a `CardGroup` and a bare `ul` alike.
 *
 * The date leads instead of the track: across a day at the circuit every row
 * shares a track name, and what you are hunting for is which run it was. The
 * plate on the right carries that number and the weather in one glance.
 */
export function SessionCard({ session, vehicleNickname }: SessionCardProps) {
  // Append time to avoid timezone date shift
  const date = new Date(`${session.date}T00:00:00`);
  const formattedDate = date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

  return (
    <Link
      href={`/sessions/${session.id}`}
      className="flex items-center gap-4 rounded-row bg-surface-2 p-4 transition hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80"
    >
      <div className="min-w-0 flex-1">
        <Eyebrow>
          {formattedDate}
          {session.start_time ? ` · ${formatTime12h(session.start_time)}` : ''}
        </Eyebrow>
        <p className="mt-1.5 truncate font-semibold text-ink">
          {session.track_name ?? 'Unknown Track'}
        </p>
        <p className="mt-0.5 truncate text-sm text-ink-dim">{vehicleNickname}</p>
      </div>
      <DataPlate
        value={session.session_number ? `S${session.session_number}` : null}
        condition={session.conditions}
      />
    </Link>
  );
}
