'use client';

import { Card } from '@/components/ui/surface';
import { cn } from '@/lib/utils';

interface PreferenceToggleProps<T extends string> {
  /** Card heading, e.g. "Time display". */
  title: string;
  description: string;
  /** Label beside the control, e.g. "Format". */
  label: string;
  /** Accessible name for the button group. */
  groupLabel: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}

/**
 * One display preference, as a card with a segmented control. Shared by every
 * setting on this screen so a second preference cannot drift from the first.
 */
export function PreferenceToggle<T extends string>({
  title,
  description,
  label,
  groupLabel,
  options,
  value,
  onChange,
}: PreferenceToggleProps<T>) {
  return (
    <Card className="p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</h2>
      <p className="mt-2 text-sm text-ink-dim">{description}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink">{label}</span>
        {/* The segmented control sits on `bg-surface-2` inside a `bg-surface`
            card, which is the tone pairing the row rung of the radius ladder
            names, so both the track and its buttons take that rung rather than
            the control one. ChoiceRow is built the same way. */}
        <div
          role="group"
          aria-label={groupLabel}
          className="flex gap-1 rounded-row bg-surface-2 p-1 text-xs"
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={value === option.value}
              onClick={() => onChange(option.value)}
              className={cn(
                'inline-flex min-h-11 items-center rounded-row px-4 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80',
                value === option.value ? 'bg-ink text-canvas' : 'text-ink-dim hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}
