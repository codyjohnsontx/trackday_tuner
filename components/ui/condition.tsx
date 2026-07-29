import { Cloud, CloudRain, CloudSun, Sun } from 'lucide-react';
import type { ComponentType } from 'react';
import type { SessionCondition } from '@/types';
import { cn } from '@/lib/utils';

interface ConditionStyle {
  label: string;
  Icon: ComponentType<{ className?: string }>;
  tone: string;
}

// Weather is data, so it is carried by icon shape rather than colour: a sun and
// a rain cloud are told apart faster than two tints anyway, and tinting them
// would spend the accent — or a second palette — on something that is not a
// state you can act on.
const PLATE_TONE = 'bg-surface-3 text-ink-dim';

const CONDITIONS: Record<string, ConditionStyle> = {
  sunny: { label: 'Sunny', Icon: Sun, tone: PLATE_TONE },
  overcast: { label: 'Overcast', Icon: Cloud, tone: PLATE_TONE },
  rainy: { label: 'Rainy', Icon: CloudRain, tone: PLATE_TONE },
  mixed: { label: 'Mixed', Icon: CloudSun, tone: PLATE_TONE },
};

const FALLBACK: ConditionStyle = {
  label: 'Unknown',
  Icon: Cloud,
  tone: PLATE_TONE,
};

export function conditionStyle(condition: SessionCondition | string): ConditionStyle {
  return CONDITIONS[condition] ?? { ...FALLBACK, label: String(condition) };
}

interface DataPlateProps {
  /**
   * The headline value, e.g. a session number. Kept to three characters.
   * Omit it and the plate falls back to carrying the weather on its own,
   * which is the honest thing to show when a session was never numbered.
   */
  value?: string | null;
  condition: SessionCondition | string;
  /**
   * Ring colour for the corner badge, which has to match whatever surface the
   * plate is sitting on for the badge to read as punched out of the row.
   */
  ringClass?: string;
  className?: string;
}

/**
 * The square at the trailing edge of a row. The reference design puts artwork
 * here; a setup log has no artwork worth showing, so the slot carries the two
 * things you actually scan a session list for — which run it was, and what the
 * weather was doing. The condition rides the corner as a badge the way a
 * premium marker would.
 */
export function DataPlate({
  value,
  condition,
  ringClass = 'ring-surface-2',
  className,
}: DataPlateProps) {
  const { label, Icon, tone } = conditionStyle(condition);

  if (!value) {
    return (
      <div
        className={cn(
          'flex h-14 w-14 shrink-0 items-center justify-center rounded-plate',
          tone,
          className,
        )}
        title={label}
      >
        <Icon className="h-6 w-6" />
        <span className="sr-only">{label}</span>
      </div>
    );
  }

  // The plate itself stays neutral. A column of tinted squares out-shouts the
  // track names they belong to, and weather reads faster from the badge's icon
  // shape than from a fill colour anyway.
  return (
    <div className={cn('relative shrink-0', className)}>
      <div className="flex h-14 w-14 items-center justify-center rounded-plate bg-surface-3 text-lg font-semibold text-ink">
        {value}
      </div>
      <span
        className={cn(
          'absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full ring-4',
          ringClass,
          tone,
        )}
        title={label}
      >
        <Icon className="h-3.5 w-3.5" />
        <span className="sr-only">{label}</span>
      </span>
    </div>
  );
}
