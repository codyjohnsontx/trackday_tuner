'use client';

import { InputHTMLAttributes, useId } from 'react';
import { cva } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const inputVariants = cva(
  // Fields are surfaces, not outlines: the fill is what says "you can type
  // here". A ring appears only for the error and focus states, where a border
  // is carrying real information.
  'flex w-full rounded-row bg-surface-2 px-4 py-3 text-base text-ink placeholder:text-ink-faint transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal/80 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      error: {
        // The error ring has to survive focus, otherwise focusing an invalid
        // field swaps the only "this is wrong" cue for the ordinary accent.
        true: 'ring-2 ring-slower/70 focus-visible:ring-slower/70',
        false: '',
      },
    },
    defaultVariants: {
      error: false,
    },
  },
);

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  helperText?: string;
}

export function Input({ id, label, error, helperText, className, ...props }: InputProps) {
  // The id has to be unique per instance, not per label. Deriving it from the
  // label text meant the Sag calculator's Front and Rear sections - which ask
  // the same three questions - rendered three duplicated ids, so every `for`
  // resolved to the Front field: tapping a Rear label focused Front, and the
  // Rear inputs reached assistive tech with no accessible name at all.
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descId = error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined;
  const { 'aria-describedby': ariaDescribedBy, ...inputProps } = props;
  const finalDescId = [ariaDescribedBy, descId].filter(Boolean).join(' ') || undefined;

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="block text-sm font-medium text-ink-dim">
        {label}
      </label>
      <input
        id={inputId}
        aria-describedby={finalDescId}
        aria-invalid={error ? 'true' : undefined}
        className={cn(inputVariants({ error: Boolean(error) }), className)}
        {...inputProps}
      />
      {error && (
        <p id={`${inputId}-error`} className="text-xs text-slower">
          {error}
        </p>
      )}
      {!error && helperText && (
        <p id={`${inputId}-helper`} className="text-xs text-ink-faint">
          {helperText}
        </p>
      )}
    </div>
  );
}
