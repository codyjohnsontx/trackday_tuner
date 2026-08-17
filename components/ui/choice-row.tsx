import { cn } from '@/lib/utils';

export interface ChoiceOption<T extends string> {
  value: T;
  label: string;
}

interface ChoiceRowBaseProps<T extends string> {
  /** Accessible name for the group, e.g. "Weather". */
  label: string;
  options: readonly ChoiceOption<T>[];
  /** `null` is the rider not having answered yet, and renders with nothing pressed. */
  value: T | null;
  className?: string;
}

type ChoiceRowProps<T extends string> = ChoiceRowBaseProps<T> &
  (
    | { clearable?: false; onChange: (value: T) => void }
    | { clearable: true; onChange: (value: T | null) => void }
  );

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
 * Getting back to unanswered is `clearable`, and it is opt-in because the three
 * rows using this component do not agree on whether that is a legal state. A
 * mis-tapped answer on an optional row is the same fabricated claim as a
 * pre-pressed default, so tire condition - which stores `null` inside the tires
 * JSON - clears on a second tap. Weather and the outcome verdict are refused at
 * save time until they hold one, so an empty row there is a dead end a rider can
 * reach but not save from, and both stay unclearable. The type follows: only a
 * clearable row hands `null` to `onChange`.
 *
 * The pressed state also has to survive not being seen: the old weather row
 * carried its selection in fill colour alone, which is nothing at all to a
 * screen reader.
 */
export function ChoiceRow<T extends string>(props: ChoiceRowProps<T>) {
  const { label, options, value, className } = props;

  function choose(option: T) {
    if (props.clearable) {
      props.onChange(value === option ? null : option);
      return;
    }
    props.onChange(option);
  }

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
          onClick={() => choose(option.value)}
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
