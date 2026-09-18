import { cn } from '@/lib/utils';

interface TrackLimitNoticeProps {
  id?: string;
  title: string;
  message: string;
  className?: string;
}

/**
 * The free-plan track cap, said where the circuit the rider typed is.
 *
 * Shared by the session form, before the save, and the session page, after it,
 * so the two read the same sentence from `describeSessionTrackGap`
 * (lib/session-track.ts). Styled like the trackless notice beside it on the
 * session page: a caution on a nested row, not a refusal - the session saves.
 */
export function TrackLimitNotice({ id, title, message, className }: TrackLimitNoticeProps) {
  return (
    <div id={id} role="note" className={cn('rounded-row bg-surface-2 p-3 text-sm', className)}>
      <p className="font-semibold text-signal">{title}</p>
      <p className="mt-1 text-ink-dim">{message}</p>
    </div>
  );
}
