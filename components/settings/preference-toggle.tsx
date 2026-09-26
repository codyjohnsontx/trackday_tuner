'use client';

import type { ReactNode } from 'react';
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
  /** `null` presses no option: the rider has not chosen yet. */
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  /** Anchor for links that land on this card, e.g. `question-history`. */
  id?: string;
  /** Rendered under the control, inside the same card. */
  children?: ReactNode;
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
  disabled = false,
  id,
  children,
}: PreferenceToggleProps<T>) {
  return (
    <Card id={id} className="scroll-mt-20 p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-ink-faint">{title}</h2>
      <p className="mt-2 text-sm text-ink-dim">{description}</p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm font-medium text-ink">{label}</span>
        {/* A segmented control is one widget: the buttons are segments of
            this track, not free-standing controls, so track and segments share
            the row rung and agree with each other. ChoiceRow is built the same
            way. Not a tone argument - `rounded-control` elements sit on
            `bg-surface-2` elsewhere; what picks the rung is what the element
            is in the layout. */}
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
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                'inline-flex min-h-11 items-center rounded-row px-4 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80 disabled:cursor-not-allowed disabled:opacity-60',
                value === option.value ? 'bg-ink text-canvas' : 'text-ink-dim hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      {children}
    </Card>
  );
}
