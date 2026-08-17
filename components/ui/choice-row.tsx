import { cn } from '@/lib/utils';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

interface ChoiceRowProps<T extends string> {
  /** Accessible name for the group, e.g. "Weather". */
  label: string;
  options: readonly ChoiceOption<T>[];
  /** `null` is the rider not having answered yet, and renders with nothing pressed. */
  value: T | null;
  onChange: (value: T) => void;
  className?: string;
}

/**
 * A row of mutually exclusive answers, one of which may be none of them.
 *
 * The rows this replaces each opened with an option already pressed - Sunny,
 * Scrubbed, Better - because their state was seeded with a default. A rider who
 * scrolled past filed a claim they never made, and every screen downstream read
 * it as one: the weather badge on the session list, the setup diff, the Race
 * Engineer prompt, and the learning record behind the recommendations. A default
 * is not an answer, so `null` is a value this component can render, and asking
 * for it back is the caller's job.
 *
 * The pressed state also has to survive not being seen: the old weather row
 * carried its selection in fill colour alone, which is nothing at all to a
 * screen reader.
 */
export function ChoiceRow<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: ChoiceRowProps<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('grid auto-cols-fr grid-flow-col gap-1 rounded-row bg-surface-2 p-1', className)}
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'min-h-11 min-w-11 rounded-row px-1 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80',
            value === option.value ? 'bg-ink text-canvas' : 'text-ink-dim hover:text-ink',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
